// Resolve where agent-tab stores its data for a given working directory.

import * as fs from "fs";
import * as path from "path";
import { repoRoot } from "./git";

/** Anchor the .agent-tab dir at the git root when available, else the cwd. */
export function projectRoot(cwd: string = process.cwd()): string {
  return repoRoot(cwd) || cwd;
}

export function agentTabDir(cwd: string = process.cwd()): string {
  return path.join(projectRoot(cwd), ".agent-tab");
}

export function runsDir(cwd: string = process.cwd()): string {
  return path.join(agentTabDir(cwd), "runs");
}

export function receiptsDir(cwd: string = process.cwd()): string {
  return path.join(agentTabDir(cwd), "receipts");
}

export function dbPath(cwd: string = process.cwd()): string {
  return path.join(agentTabDir(cwd), "agent-tab.db");
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
