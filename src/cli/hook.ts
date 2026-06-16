// `bartab hook` — the collector. Reads a Claude Code hook payload from stdin and
// appends a normalized event line to the session's JSONL.
//
// Contract: this must NEVER block Claude Code. Every path is wrapped and we always
// exit 0. Heavy work (git snapshots) only runs on lifecycle boundaries.

import * as fs from "fs";
import { snapshot } from "../core/git";
import { debug } from "../core/log";
import { runsDir, sessionJsonlPath } from "../core/paths";
import { recordProject } from "../core/registry";
import type { AgentEvent } from "../core/types";
import { countLines } from "../core/util";

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve(data);
    };
    try {
      if (process.stdin.isTTY) return done();
    } catch {
      /* ignore */
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
    // Safety net: never hang the agent.
    setTimeout(done, 4000).unref?.();
  });
}

const EVENT_MAP: Record<string, AgentEvent["event"]> = {
  SessionStart: "session_start",
  UserPromptSubmit: "user_prompt",
  PreToolUse: "pre_tool",
  PostToolUse: "post_tool",
  Stop: "stop",
  SubagentStop: "stop",
  SessionEnd: "session_end",
};

function summarizeToolInput(
  tool: string | undefined,
  input: unknown,
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const str = (k: string): string | undefined =>
    typeof src[k] === "string" ? (src[k] as string) : undefined;

  switch (tool) {
    case "Write": {
      out.file_path = str("file_path");
      const content = str("content") || "";
      out._content_lines = countLines(content);
      out._content_bytes = content.length;
      break;
    }
    case "Edit": {
      out.file_path = str("file_path");
      out._old_lines = countLines(str("old_string"));
      out._new_lines = countLines(str("new_string"));
      out.replace_all = Boolean(src.replace_all);
      break;
    }
    case "MultiEdit": {
      out.file_path = str("file_path");
      const edits = Array.isArray(src.edits) ? src.edits : [];
      out._edits = edits.length;
      let added = 0;
      let removed = 0;
      for (const e of edits) {
        if (e && typeof e === "object") {
          const eo = e as Record<string, unknown>;
          added += countLines(typeof eo.new_string === "string" ? eo.new_string : "");
          removed += countLines(typeof eo.old_string === "string" ? eo.old_string : "");
        }
      }
      out._added_lines = added;
      out._removed_lines = removed;
      break;
    }
    case "Read":
      out.file_path = str("file_path");
      if (typeof src.offset === "number") out.offset = src.offset;
      if (typeof src.limit === "number") out.limit = src.limit;
      break;
    case "Bash":
      out.command = str("command");
      if (str("description")) out.description = str("description");
      break;
    case "Glob":
    case "Grep":
      if (str("pattern")) out.pattern = str("pattern");
      if (str("path")) out.path = str("path");
      if (str("glob")) out.glob = str("glob");
      break;
    default: {
      // Keep small scalar fields; drop large strings.
      for (const [k, v] of Object.entries(src)) {
        if (typeof v === "number" || typeof v === "boolean") out[k] = v;
        else if (typeof v === "string" && v.length <= 200) out[k] = v;
        else if (typeof v === "string") out[`_${k}_bytes`] = v.length;
      }
    }
  }
  return out;
}

function detectError(toolResponse: unknown): boolean {
  if (!toolResponse) return false;
  if (typeof toolResponse === "object") {
    const o = toolResponse as Record<string, unknown>;
    if (o.is_error === true) return true;
    if (typeof o.error === "string" && o.error) return true;
    if (typeof o.stderr === "string" && o.stderr && o.exit_code && o.exit_code !== 0)
      return true;
    if (typeof o.interrupted === "boolean" && o.interrupted) return true;
  }
  if (typeof toolResponse === "string") {
    if (/^\s*Error[:\s]/i.test(toolResponse)) return true;
  }
  return false;
}

export async function runHook(argv: string[]): Promise<number> {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return 0;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      debug("hook: ignored non-JSON stdin");
      return 0; // never block on bad input
    }

    const hookEventName =
      (typeof payload.hook_event_name === "string" && payload.hook_event_name) ||
      argEventOverride(argv) ||
      "";
    const sessionId =
      (typeof payload.session_id === "string" && payload.session_id) || "unknown";
    const cwd = (typeof payload.cwd === "string" && payload.cwd) || process.cwd();
    const event = EVENT_MAP[hookEventName] || "other";
    const toolName =
      typeof payload.tool_name === "string" ? payload.tool_name : undefined;

    const ev: AgentEvent = {
      v: 1,
      ts: new Date().toISOString(),
      event,
      hook_event_name: hookEventName || undefined,
      tool: argFlag(argv, "--tool") || "claude-code",
      session_id: sessionId,
      cwd,
    };
    if (typeof payload.transcript_path === "string")
      ev.transcript_path = payload.transcript_path;
    // Codex exposes the model on every hook payload; Claude only on SessionStart.
    if (typeof payload.model === "string") ev.model = payload.model;

    if (event === "user_prompt" && typeof payload.prompt === "string") {
      ev.prompt = payload.prompt.slice(0, 4000);
    }
    if (event === "pre_tool" || event === "post_tool") {
      ev.tool_name = toolName;
      ev.tool_input = summarizeToolInput(toolName, payload.tool_input);
    }
    if (event === "post_tool") {
      ev.is_error = detectError(payload.tool_response);
      try {
        ev.response_bytes = JSON.stringify(payload.tool_response ?? "").length;
      } catch {
        /* ignore */
      }
    }
    if (event === "session_start" && typeof payload.source === "string")
      ev.source = payload.source;
    if (event === "session_end" && typeof payload.reason === "string")
      ev.reason = payload.reason;

    // Git snapshots + registry only on lifecycle boundaries (keeps per-tool hooks fast).
    if (event === "session_start" || event === "stop" || event === "session_end") {
      try {
        ev.git = snapshot(cwd);
      } catch {
        ev.git = null;
      }
      recordProject(cwd);
    }

    // Append the line.
    try {
      fs.mkdirSync(runsDir(cwd), { recursive: true });
      const file = sessionJsonlPath(sessionId, cwd);
      fs.appendFileSync(file, JSON.stringify(ev) + "\n");
      debug(
        `hook: ${ev.event} (${hookEventName || "?"}) tool=${ev.tool} ${ev.tool_name || ""} -> ${file}`,
        cwd,
      );
    } catch (err) {
      debug(`hook: write failed: ${(err && (err as Error).message) || err}`, cwd);
      /* ignore write errors — must not block */
    }
    return 0;
  } catch (err) {
    debug(`hook: fatal: ${(err && (err as Error).stack) || err}`);
    return 0;
  }
}

function argEventOverride(argv: string[]): string | undefined {
  return argFlag(argv, "--event");
}

function argFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return undefined;
}
