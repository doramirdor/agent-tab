// Opt-in debug logging. Hooks are intentionally silent (they must not write to
// stdout — Claude Code/Codex can inject hook stdout into the model), which makes
// "why didn't my hook fire?" hard to debug. Set AGENT_TAB_DEBUG=1 to append
// diagnostics to <project>/.agent-tab/agent-tab.log. Never throws.

import * as fs from "fs";
import * as path from "path";
import { agentTabDir } from "./paths";

export function debugEnabled(): boolean {
  const v = process.env.AGENT_TAB_DEBUG;
  return Boolean(v) && v !== "0" && v !== "false";
}

export function debug(msg: string, cwd?: string): void {
  if (!debugEnabled()) return;
  try {
    const dir = agentTabDir(cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "agent-tab.log"),
      `[${new Date().toISOString()}] ${msg}\n`,
    );
  } catch {
    // Logging must never interfere with the agent.
  }
}
