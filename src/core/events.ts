// Derive structured collections from the raw event stream.

import type { AgentEvent, FileChange, FileStats } from "./types";
import { isDependencyFile, isGenerated } from "./git";

export interface ReadCount {
  path: string;
  count: number;
}
export interface BashCount {
  cmd: string;
  count: number;
  failures: number;
}

export interface EditCount {
  path: string;
  count: number;
}

export interface DerivedEvents {
  readCounts: ReadCount[];
  bashCounts: BashCount[];
  editCounts: EditCount[];
  toolUsage: Map<string, number>;
  toolCalls: number;
  commandsRun: number;
  failures: number;
  largeOutputs: number;
  /** Largest tool response in bytes seen. */
  maxResponseBytes: number;
  /** Largest single Read response in bytes, and the file it came from. */
  maxReadBytes: number;
  maxReadPath: string | null;
}

/** Normalize a bash command so "npm test " and "npm  test" collapse together. */
export function normalizeCmd(cmd: string): string {
  return (cmd || "").replace(/\s+/g, " ").trim();
}

const LARGE_OUTPUT_BYTES = 50_000;

export function deriveEvents(events: AgentEvent[]): DerivedEvents {
  const reads = new Map<string, number>();
  const bash = new Map<string, { count: number; failures: number }>();
  const edits = new Map<string, number>();
  const toolUsage = new Map<string, number>();
  let toolCalls = 0;
  let commandsRun = 0;
  let failures = 0;
  let largeOutputs = 0;
  let maxResponseBytes = 0;
  let maxReadBytes = 0;
  let maxReadPath: string | null = null;

  for (const ev of events) {
    if (ev.event !== "post_tool") continue;
    const tool = ev.tool_name || "unknown";
    toolUsage.set(tool, (toolUsage.get(tool) || 0) + 1);
    toolCalls += 1;
    if (ev.is_error) failures += 1;
    if (typeof ev.response_bytes === "number") {
      maxResponseBytes = Math.max(maxResponseBytes, ev.response_bytes);
      if (ev.response_bytes >= LARGE_OUTPUT_BYTES) largeOutputs += 1;
    }

    const input = ev.tool_input || {};
    if (tool === "Read") {
      const p = typeof input.file_path === "string" ? input.file_path : null;
      if (p) reads.set(p, (reads.get(p) || 0) + 1);
      if (typeof ev.response_bytes === "number" && ev.response_bytes > maxReadBytes) {
        maxReadBytes = ev.response_bytes;
        maxReadPath = p;
      }
    } else if (tool === "Edit" || tool === "MultiEdit") {
      const p = typeof input.file_path === "string" ? input.file_path : null;
      if (p) edits.set(p, (edits.get(p) || 0) + 1);
    }
    if (tool === "Bash") {
      const cmd = typeof input.command === "string" ? normalizeCmd(input.command) : null;
      if (cmd) {
        commandsRun += 1;
        const b = bash.get(cmd) || { count: 0, failures: 0 };
        b.count += 1;
        if (ev.is_error) b.failures += 1;
        bash.set(cmd, b);
      }
    }
  }

  const readCounts: ReadCount[] = [...reads.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);
  const bashCounts: BashCount[] = [...bash.entries()]
    .map(([cmd, v]) => ({ cmd, count: v.count, failures: v.failures }))
    .sort((a, b) => b.count - a.count);
  const editCounts: EditCount[] = [...edits.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);

  return {
    readCounts,
    bashCounts,
    editCounts,
    toolUsage,
    toolCalls,
    commandsRun,
    failures,
    largeOutputs,
    maxResponseBytes,
    maxReadBytes,
    maxReadPath,
  };
}

/**
 * Build FileStats purely from Write/Edit/MultiEdit tool events. Used when the project
 * isn't a git repo (or git stats are unavailable). Line counts are approximate.
 */
export function fileStatsFromEvents(events: AgentEvent[]): FileStats {
  // path -> aggregated change
  const map = new Map<string, FileChange & { created: boolean }>();

  const bump = (
    p: string,
    added: number,
    removed: number,
    created: boolean,
  ): void => {
    const existing = map.get(p);
    if (existing) {
      existing.added += added;
      existing.removed += removed;
      existing.created = existing.created || created;
    } else {
      map.set(p, {
        filePath: p,
        added,
        removed,
        changeType: created ? "added" : "modified",
        created,
      });
    }
  };

  for (const ev of events) {
    if (ev.event !== "post_tool") continue;
    const tool = ev.tool_name || "";
    const input = ev.tool_input || {};
    const p = typeof input.file_path === "string" ? input.file_path : null;
    if (!p) continue;

    if (tool === "Write") {
      const lines = numOr(input._content_lines, 0);
      bump(p, lines, 0, true);
    } else if (tool === "Edit") {
      const added = numOr(input._new_lines, 0);
      const removed = numOr(input._old_lines, 0);
      bump(p, added, removed, false);
    } else if (tool === "MultiEdit") {
      const added = numOr(input._added_lines, 0);
      const removed = numOr(input._removed_lines, 0);
      bump(p, added, removed, false);
    } else if (tool === "NotebookEdit") {
      bump(p, numOr(input._new_lines, 1), 0, false);
    }
  }

  const changes: FileChange[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  let newFiles = 0;
  for (const ch of map.values()) {
    linesAdded += ch.added;
    linesRemoved += ch.removed;
    if (ch.created) newFiles += 1;
    changes.push({
      filePath: ch.filePath,
      added: ch.added,
      removed: ch.removed,
      changeType: ch.changeType,
    });
  }

  return {
    source: map.size > 0 ? "events" : "none",
    filesTouched: changes.length,
    linesAdded,
    linesRemoved,
    newFiles,
    deletedFiles: 0,
    changes,
    dependencyFilesChanged: changes
      .filter((ch) => isDependencyFile(ch.filePath))
      .map((ch) => ch.filePath),
    generatedFilesChanged: changes
      .filter((ch) => isGenerated(ch.filePath))
      .map((ch) => ch.filePath),
  };
}

function numOr(x: unknown, fallback: number): number {
  return typeof x === "number" && isFinite(x) ? x : fallback;
}
