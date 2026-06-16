// Git snapshotting. Every call is wrapped so it can never throw into a hook.

import { spawnSync } from "child_process";
import type { FileChange, FileStats, GitSnapshot } from "./types";

function git(cwd: string, args: string[]): string | null {
  try {
    const res = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (res.status !== 0 || res.error) return null;
    return res.stdout;
  } catch {
    return null;
  }
}

export function repoRoot(cwd: string): string | null {
  const out = git(cwd, ["rev-parse", "--show-toplevel"]);
  return out ? out.trim() || null : null;
}

/** Capture a working-tree snapshot relative to HEAD. Never throws. */
export function snapshot(cwd: string): GitSnapshot {
  const root = repoRoot(cwd);
  if (!root) return { isRepo: false };

  const head = (git(root, ["rev-parse", "HEAD"]) || "").trim() || null;
  const branch = (git(root, ["rev-parse", "--abbrev-ref", "HEAD"]) || "").trim() || null;

  const numstat: Record<string, { added: number; removed: number }> = {};
  const numOut = git(root, ["diff", "--numstat", "HEAD"]) || "";
  for (const line of numOut.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
    const removed = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
    const file = parts.slice(2).join("\t");
    numstat[file] = { added, removed };
  }

  const untracked: string[] = [];
  const statusOut = git(root, ["status", "--porcelain", "--untracked-files=all"]) || "";
  for (const line of statusOut.split("\n")) {
    if (!line.startsWith("?? ")) continue;
    const p = line.slice(3);
    // Never attribute our own data dir to the agent's work.
    if (p === ".bartab/" || p.startsWith(".bartab/")) continue;
    untracked.push(p);
  }

  return { isRepo: true, head, branch, numstat, untracked };
}

const LOCKFILE_RE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|Cargo\.lock|poetry\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/i;
const MANIFEST_RE =
  /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle)$/i;
const GENERATED_RE =
  /(^|\/)(dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|node_modules|vendor|__pycache__|target|generated)\//i;
const GENERATED_EXT_RE = /\.(min\.js|min\.css|map|lock)$/i;

export function isLockfile(p: string): boolean {
  return LOCKFILE_RE.test(p);
}
export function isManifest(p: string): boolean {
  return MANIFEST_RE.test(p);
}
export function isDependencyFile(p: string): boolean {
  return isLockfile(p) || isManifest(p);
}
export function isGenerated(p: string): boolean {
  return GENERATED_RE.test(p) || GENERATED_EXT_RE.test(p);
}

/**
 * Diff two snapshots into per-session file stats. We subtract the baseline so a
 * repo that was already dirty when the session started doesn't inflate the numbers.
 */
export function statsFromSnapshots(
  start: GitSnapshot | null | undefined,
  end: GitSnapshot | null | undefined,
): FileStats | null {
  if (!end || !end.isRepo || !end.numstat) return null;
  const base = start && start.isRepo ? start : null;
  const baseNum = (base && base.numstat) || {};
  const baseUntracked = new Set((base && base.untracked) || []);

  const changes: FileChange[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;
  let newFiles = 0;

  for (const [file, cur] of Object.entries(end.numstat)) {
    const prev = baseNum[file] || { added: 0, removed: 0 };
    const added = Math.max(0, cur.added - prev.added);
    const removed = Math.max(0, cur.removed - prev.removed);
    if (added === 0 && removed === 0 && file in baseNum) continue; // unchanged since start
    linesAdded += added;
    linesRemoved += removed;
    changes.push({ filePath: file, added, removed, changeType: "modified" });
  }

  const endUntracked = end.untracked || [];
  for (const file of endUntracked) {
    if (baseUntracked.has(file)) continue; // already there at start
    newFiles += 1;
    changes.push({ filePath: file, added: 0, removed: 0, changeType: "added" });
  }

  const dependencyFilesChanged = changes
    .filter((ch) => isDependencyFile(ch.filePath))
    .map((ch) => ch.filePath);
  const generatedFilesChanged = changes
    .filter((ch) => isGenerated(ch.filePath))
    .map((ch) => ch.filePath);

  return {
    source: "git",
    filesTouched: changes.length,
    linesAdded,
    linesRemoved,
    newFiles,
    deletedFiles: 0,
    changes,
    dependencyFilesChanged,
    generatedFilesChanged,
  };
}
