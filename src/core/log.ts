// Opt-in debug logging. Hooks are intentionally silent (they must not write to
// stdout — Claude Code/Codex can inject hook stdout into the model), which makes
// "why didn't my hook fire?" hard to debug. Set BARTAB_DEBUG=1 to append
// diagnostics to <project>/.bartab/bartab.log. Never throws.

import * as fs from "fs";
import * as path from "path";
import { bartabDir } from "./paths";

export function debugEnabled(): boolean {
  const v = process.env.BARTAB_DEBUG;
  return Boolean(v) && v !== "0" && v !== "false";
}

export function debug(msg: string, cwd?: string): void {
  if (!debugEnabled()) return;
  try {
    const dir = bartabDir(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "bartab.log"),
      `[${new Date().toISOString()}] ${msg}\n`,
    );
  } catch {
    // Logging must never interfere with the agent.
  }
}
