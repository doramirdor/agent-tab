// Parse a Claude Code transcript JSONL into accurate token usage.
//
// IMPORTANT gotcha (verified against real transcripts): a single assistant API
// response is written as MULTIPLE lines — one per content block (thinking / text /
// tool_use) — and every one of those lines carries the SAME `message.usage` and the
// SAME `requestId`. Summing usage across all assistant lines overcounts by the number
// of content blocks per turn. We therefore dedupe by requestId (falling back to the
// message id, then the line uuid) and count each API request's usage exactly once.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ModelUsage, TranscriptSummary } from "./types";

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

function num(x: unknown): number {
  return typeof x === "number" && isFinite(x) ? x : 0;
}

function emptySummary(): TranscriptSummary {
  return {
    found: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    requests: 0,
    byModel: [],
    models: [],
    userPrompts: [],
  };
}

/** Extract plain text from a transcript user message's content (string or blocks). */
function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

export function parseTranscript(transcriptPath: string): TranscriptSummary {
  const summary = emptySummary();
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return summary;
  }
  summary.found = true;
  summary.path = transcriptPath;

  const seen = new Set<string>();
  const models = new Map<string, ModelUsage>();

  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = obj.type;
    const message = (obj.message as Record<string, unknown> | undefined) || undefined;

    if (type === "user" && message) {
      const text = userText(message.content);
      // Skip tool-result-only user turns (no human text) and meta noise.
      if (text && !obj.isMeta) summary.userPrompts.push(text);
      continue;
    }

    if (type !== "assistant" || !message) continue;

    const usage = message.usage as RawUsage | undefined;
    if (!usage) continue;

    // Dedupe one usage record per API request.
    const key =
      (typeof obj.requestId === "string" && obj.requestId) ||
      (typeof message.id === "string" && (message.id as string)) ||
      (typeof obj.uuid === "string" && (obj.uuid as string)) ||
      trimmed;
    if (seen.has(key)) continue;
    seen.add(key);

    const model = (typeof message.model === "string" && message.model) || "unknown";
    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const cacheRead = num(usage.cache_read_input_tokens);
    const cw5m = num(usage.cache_creation?.ephemeral_5m_input_tokens);
    const cw1h = num(usage.cache_creation?.ephemeral_1h_input_tokens);
    // Fall back to the flat cache_creation_input_tokens (treated as 5m) when the
    // tiered breakdown is absent.
    const cacheCreationFlat = num(usage.cache_creation_input_tokens);
    const breakdownSum = cw5m + cw1h;
    const finalCw5m = breakdownSum > 0 ? cw5m : cacheCreationFlat;
    const finalCw1h = breakdownSum > 0 ? cw1h : 0;

    let bucket = models.get(model);
    if (!bucket) {
      bucket = {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        requests: 0,
      };
      models.set(model, bucket);
    }
    bucket.inputTokens += input;
    bucket.outputTokens += output;
    bucket.cacheReadTokens += cacheRead;
    bucket.cacheWrite5mTokens += finalCw5m;
    bucket.cacheWrite1hTokens += finalCw1h;
    bucket.requests += 1;

    summary.inputTokens += input;
    summary.outputTokens += output;
    summary.cacheReadTokens += cacheRead;
    summary.cacheWrite5mTokens += finalCw5m;
    summary.cacheWrite1hTokens += finalCw1h;
    summary.requests += 1;
  }

  summary.byModel = [...models.values()].sort((a, b) => b.outputTokens - a.outputTokens);
  summary.models = summary.byModel.map((m) => m.model);
  return summary;
}

/**
 * Locate a transcript for a session id by scanning ~/.claude/projects/*. Used as a
 * fallback when the hook payload's transcript_path wasn't captured.
 */
export function findTranscriptForSession(sessionId: string): string | null {
  if (!sessionId) return null;
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  let projects: string[];
  try {
    projects = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const proj of projects) {
    const candidate = path.join(projectsDir, proj, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
