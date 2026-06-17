// Opt-in debug logging. Hooks are intentionally silent (they must not write to
// stdout — Claude Code/Codex can inject hook stdout into the model), which makes
// "why didn't my hook fire?" hard to debug. Set OPENBAR_DEBUG=1 to append
// diagnostics to <project>/.openbar/openbar.log. Never throws.

import * as fs from "fs";
import * as path from "path";
import { openbarDir } from "./paths";

export function debugEnabled(): boolean {
  const v = process.env.OPENBAR_DEBUG;
  return Boolean(v) && v !== "0" && v !== "false";
}

export function debug(msg: string, cwd?: string): void {
  if (!debugEnabled()) return;
  try {
    const dir = openbarDir(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "openbar.log"),
      `[${new Date().toISOString()}] ${msg}\n`,
    );
  } catch {
    // Logging must never interfere with the agent.
  }
}
