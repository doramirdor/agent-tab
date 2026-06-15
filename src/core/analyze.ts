// Orchestration: turn a session's event stream + transcript into a RunReport.

import * as fs from "fs";
import { findCodexRollout, parseCodexRollout } from "./codex";
import { deriveEvents, fileStatsFromEvents } from "./events";
import { statsFromSnapshots } from "./git";
import { costForUsage } from "./pricing";
import { runDetectors } from "./detectors";
import { bloatScore } from "./scoring";
import { findTranscriptForSession, parseTranscript } from "./transcript";
import type { AgentEvent, FileStats, RunReport, TranscriptSummary } from "./types";
import { oneLine } from "./util";

export function loadEvents(jsonlPath: string): AgentEvent[] {
  let raw: string;
  try {
    raw = fs.readFileSync(jsonlPath, "utf8");
  } catch {
    return [];
  }
  const out: AgentEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as AgentEvent);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export interface AnalyzeOptions {
  sessionId: string;
  /** Override transcript path (otherwise taken from events or auto-discovered). */
  transcriptPath?: string;
}

export function analyze(events: AgentEvent[], opts: AnalyzeOptions): RunReport {
  const startEvent = events.find((e) => e.event === "session_start");
  const lastGitEvent = [...events]
    .reverse()
    .find((e) => (e.event === "stop" || e.event === "session_end") && e.git);

  const repoPath =
    startEvent?.cwd ||
    events.find((e) => e.cwd)?.cwd ||
    process.cwd();

  const tool = events.find((e) => e.tool)?.tool || "claude-code";
  const isCodex = tool === "codex";
  const modelHint = events.find((e) => e.model)?.model;

  // --- Token usage from the transcript/rollout (accurate) ---
  const transcriptPath =
    opts.transcriptPath ||
    startEvent?.transcript_path ||
    events.find((e) => e.transcript_path)?.transcript_path ||
    (isCodex
      ? findCodexRollout(opts.sessionId)
      : findTranscriptForSession(opts.sessionId)) ||
    undefined;

  let tokens: TranscriptSummary;
  if (isCodex) {
    tokens = transcriptPath
      ? parseCodexRollout(transcriptPath, modelHint)
      : parseCodexRollout("/nonexistent", modelHint);
  } else {
    tokens = parseTranscript(transcriptPath || "/nonexistent");
  }
  // Fall back to the model the hook reported if the transcript lacked it.
  if (tokens.models.length === 0 && modelHint) tokens.models = [modelHint];

  const cost = costForUsage(tokens.byModel);

  // --- File stats: prefer git delta, fall back to tool events ---
  const derived = deriveEvents(events);
  const gitStats = statsFromSnapshots(startEvent?.git, lastGitEvent?.git);
  const eventStats = fileStatsFromEvents(events);
  const files: FileStats = chooseFileStats(gitStats, eventStats);

  // --- Prompt ---
  const promptEvent = events.find((e) => e.event === "user_prompt" && e.prompt);
  const firstPrompt =
    promptEvent?.prompt || tokens.userPrompts[0] || "";
  const promptChars = firstPrompt.length;

  // --- Findings + score ---
  const findings = runDetectors({
    derived,
    files,
    tokens,
    firstPrompt,
    promptChars,
    repoPath,
  });
  const score = bloatScore({ files, derived, promptChars });

  return {
    sessionId: opts.sessionId,
    tool,
    repoPath,
    startedAt: events[0]?.ts,
    endedAt: events[events.length - 1]?.ts,
    models: tokens.models,
    tokens,
    cost: {
      usd: cost.usd,
      estimated: true,
      hasUnknownModel: cost.hasUnknownModel,
    },
    files,
    commandsRun: derived.commandsRun,
    retries: derived.failures,
    toolCalls: derived.toolCalls,
    firstPrompt: oneLine(firstPrompt, 200),
    promptChars,
    bloatScore: score.total,
    findings,
  };
}

function chooseFileStats(
  gitStats: FileStats | null,
  eventStats: FileStats,
): FileStats {
  // Git is authoritative for line counts when it found anything; otherwise fall back
  // to the event-derived stats (covers non-git projects).
  if (gitStats && gitStats.filesTouched > 0) return gitStats;
  if (eventStats.filesTouched > 0) return eventStats;
  return gitStats || eventStats;
}
