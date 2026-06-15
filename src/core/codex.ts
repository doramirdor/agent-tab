// Parse a Codex rollout JSONL into token usage.
//
// Codex writes a per-session rollout at $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl.
// Each line is { timestamp, type, payload }. Token usage lives in lines with
// type="event_msg", payload.type="token_count": payload.info.total_token_usage is the
// cumulative TokenUsage for the session, with fields input_tokens, cached_input_tokens,
// output_tokens, reasoning_output_tokens, total_tokens.
//
// NOTE: unlike Claude, Codex/OpenAI `input_tokens` INCLUDES cached tokens, and
// `output_tokens` INCLUDES reasoning tokens. We normalize to our schema where
// inputTokens is the full-price (non-cached) input and cacheReadTokens is the cached
// portion, so the shared pricing math applies unchanged.
//
// The Codex docs warn this transcript format is not a stable interface — version-guard.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ModelUsage, TranscriptSummary } from "./types";

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

function num(x: unknown): number {
  return typeof x === "number" && isFinite(x) ? x : 0;
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
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

export function parseCodexRollout(rolloutPath: string, modelHint?: string): TranscriptSummary {
  const summary = emptySummary();
  let raw: string;
  try {
    raw = fs.readFileSync(rolloutPath, "utf8");
  } catch {
    return summary;
  }
  summary.found = true;
  summary.path = rolloutPath;

  let model = modelHint || "";
  let lastTotal: CodexTokenUsage | null = null;
  let tokenEvents = 0;

  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = obj.type;
    const payload = (obj.payload as Record<string, unknown> | undefined) || undefined;
    if (!payload) continue;

    if (type === "turn_context" && typeof payload.model === "string") {
      model = payload.model;
    } else if (type === "session_meta" && typeof payload.model === "string" && !model) {
      model = payload.model;
    } else if (type === "event_msg" && payload.type === "token_count") {
      const info = payload.info as Record<string, unknown> | undefined;
      const total = (info && (info.total_token_usage as CodexTokenUsage)) || undefined;
      if (total) {
        lastTotal = total; // cumulative — keep the last one
        tokenEvents += 1;
      }
    }
  }

  if (!lastTotal) {
    // Rollout existed but had no token_count yet.
    summary.requests = 0;
    return summary;
  }

  const inputTotal = num(lastTotal.input_tokens);
  const cached = num(lastTotal.cached_input_tokens);
  const nonCachedInput = Math.max(0, inputTotal - cached);
  const output = num(lastTotal.output_tokens);

  const bucket: ModelUsage = {
    model: model || "unknown",
    inputTokens: nonCachedInput,
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    requests: tokenEvents,
  };

  summary.inputTokens = nonCachedInput;
  summary.outputTokens = output;
  summary.cacheReadTokens = cached;
  summary.requests = tokenEvents;
  summary.byModel = [bucket];
  summary.models = [bucket.model];
  return summary;
}

/** Find a Codex rollout file for a session id under $CODEX_HOME/sessions. */
export function findCodexRollout(sessionId: string): string | null {
  const sessionsDir = path.join(codexHome(), "sessions");
  const files: { path: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          files.push({ path: full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(sessionsDir, 0);
  if (files.length === 0) return null;

  // 1. Filename containing the session id.
  if (sessionId) {
    const byName = files.find((f) => f.path.includes(sessionId));
    if (byName) return byName.path;
  }
  // 2. Newest files whose session_meta id matches.
  files.sort((a, b) => b.mtime - a.mtime);
  if (sessionId) {
    for (const f of files.slice(0, 50)) {
      try {
        const head = fs.readFileSync(f.path, "utf8").split("\n", 1)[0];
        const obj = JSON.parse(head) as Record<string, unknown>;
        const payload = obj.payload as Record<string, unknown> | undefined;
        if (payload && payload.id === sessionId) return f.path;
      } catch {
        /* ignore */
      }
    }
  }
  // 3. Newest overall.
  return files[0].path;
}
