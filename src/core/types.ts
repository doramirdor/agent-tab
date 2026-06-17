// Shared types for the openbar core.

/** A normalized event line as written by the hook collector to the per-session JSONL. */
export interface AgentEvent {
  v: number;
  ts: string;
  /** Normalized lifecycle/category name. */
  event:
    | "session_start"
    | "user_prompt"
    | "pre_tool"
    | "post_tool"
    | "stop"
    | "session_end"
    | "other";
  /** Raw hook_event_name as received (for forward-compat / debugging). */
  hook_event_name?: string;
  /** Which agent produced this event: "claude-code" or "codex". */
  tool?: string;
  /** Model id, when the hook payload exposes it (Codex sends it on every event). */
  model?: string;
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  tool_name?: string;
  /** Trimmed tool input — large strings (file contents) are reduced to size metrics. */
  tool_input?: Record<string, unknown>;
  /** Best-effort flag: did this tool call fail? */
  is_error?: boolean;
  /** Size of the tool_response payload in bytes, when known. */
  response_bytes?: number;
  /** Truncated user prompt text (UserPromptSubmit). */
  prompt?: string;
  /** SessionStart `source`. */
  source?: string;
  /** SessionEnd `reason`. */
  reason?: string;
  /** Git snapshot captured at lifecycle boundaries. */
  git?: GitSnapshot | null;
}

export interface GitSnapshot {
  isRepo: boolean;
  head?: string | null;
  branch?: string | null;
  /** Tracked working-tree changes vs HEAD: path -> { added, removed }. */
  numstat?: Record<string, { added: number; removed: number }>;
  /** Untracked file paths (git status --porcelain '??'). */
  untracked?: string[];
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Cache write at the 5-minute ephemeral tier. */
  cacheWrite5mTokens: number;
  /** Cache write at the 1-hour ephemeral tier. */
  cacheWrite1hTokens: number;
  /** Number of distinct API requests attributed to this model. */
  requests: number;
}

export interface TranscriptSummary {
  found: boolean;
  path?: string;
  /** Aggregate across all models/turns. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  /** Distinct API requests (deduped by requestId/message id). */
  requests: number;
  /** Per-model breakdown for accurate pricing. */
  byModel: ModelUsage[];
  /** Models seen, primary (most output) first. */
  models: string[];
  /** User prompts pulled from the transcript (in order). */
  userPrompts: string[];
}

export interface FileChange {
  filePath: string;
  added: number;
  removed: number;
  changeType: "added" | "modified" | "deleted";
}

export interface FileStats {
  /** Where the numbers came from. */
  source: "git" | "events" | "none";
  filesTouched: number;
  linesAdded: number;
  linesRemoved: number;
  newFiles: number;
  deletedFiles: number;
  changes: FileChange[];
  /** Dependency manifests/lockfiles that changed. */
  dependencyFilesChanged: string[];
  /** Generated/build artifacts that changed. */
  generatedFilesChanged: string[];
}

export type Severity = "low" | "medium" | "high";

export interface Finding {
  type: string;
  severity: Severity;
  title: string;
  explanation: string;
  suggestedFix: string;
  /** A representative count (e.g. how many times something happened). */
  count?: number;
  /** Free-form supporting detail. */
  evidence?: string;
}

export interface CostBreakdown {
  usd: number;
  estimated: boolean;
  /** True when at least one model's price was not known exactly. */
  hasUnknownModel: boolean;
}

export interface RunReport {
  sessionId: string;
  tool: string;
  repoPath: string;
  startedAt?: string;
  endedAt?: string;
  models: string[];
  tokens: TranscriptSummary;
  cost: CostBreakdown;
  files: FileStats;
  commandsRun: number;
  retries: number;
  toolCalls: number;
  firstPrompt: string;
  promptChars: number;
  bloatScore: number;
  findings: Finding[];
}
