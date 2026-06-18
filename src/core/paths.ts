// Resolve where openbar stores its data for a given working directory.

import * as fs from "fs";
import * as path from "path";
import { repoRoot } from "./git";

/** Anchor the .openbar dir at the git root when available, else the cwd. */
export function projectRoot(cwd: string = process.cwd()): string {
  return repoRoot(cwd) || cwd;
}

export function openbarDir(cwd: string = process.cwd()): string {
  return path.join(projectRoot(cwd), ".openbar");
}

export function runsDir(cwd: string = process.cwd()): string {
  return path.join(openbarDir(cwd), "runs");
}

export function receiptsDir(cwd: string = process.cwd()): string {
  return path.join(openbarDir(cwd), "receipts");
}

export function dbPath(cwd: string = process.cwd()): string {
  return path.join(openbarDir(cwd), "openbar.db");
}

export function sessionJsonlPath(sessionId: string, cwd: string = process.cwd()): string {
  return path.join(runsDir(cwd), `${sessionId}.jsonl`);
}

/** Most-recently-modified session JSONL, or null. */
export function latestSessionId(cwd: string = process.cwd()): string | null {
  const dir = runsDir(cwd);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  let best: { id: string; mtime: number } | null = null;
  for (const f of files) {
    try {
      const st = fs.statSync(path.join(dir, f));
      const m = st.mtimeMs;
      if (!best || m > best.mtime) best = { id: f.replace(/\.jsonl$/, ""), mtime: m };
    } catch {
      /* ignore */
    }
  }
  return best ? best.id : null;
}

/** Session ids in this project, most-recently-modified first (up to `limit`). */
export function recentSessionIds(limit = 20, cwd: string = process.cwd()): string[] {
  const dir = runsDir(cwd);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const withTime = files
    .map((f) => {
      try {
        return { id: f.replace(/\.jsonl$/, ""), m: fs.statSync(path.join(dir, f)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { id: string; m: number } => x !== null)
    .sort((a, b) => b.m - a.m);
  return withTime.slice(0, limit).map((x) => x.id);
}
