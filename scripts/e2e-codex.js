#!/usr/bin/env node
// End-to-end test for the Codex integration: synthetic Codex hook payloads + a fake
// rollout file with token_count lines, driven through the compiled binary.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BIN = path.resolve(__dirname, "..", "bin", "bartab.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bartab-codex-"));
const SID = "codex-session-0001";
const rollout = path.join(tmp, "rollout.jsonl");

function git(...args) {
  return spawnSync("git", args, { cwd: tmp, encoding: "utf8" });
}
function hook(payload) {
  const r = spawnSync("node", [BIN, "hook", "--tool", "codex"], {
    cwd: tmp,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, BARTAB_HOME: path.join(tmp, ".atab") },
  });
  if (r.status !== 0) throw new Error("hook nonzero: " + r.stderr);
}
function cli(args) {
  return spawnSync("node", [BIN, ...args], {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", BARTAB_HOME: path.join(tmp, ".atab") },
  });
}

git("init", "-q");
git("config", "user.email", "t@t.com");
git("config", "user.name", "t");
fs.writeFileSync(path.join(tmp, "main.py"), "print('hi')\n");
git("add", "-A");
git("commit", "-q", "-m", "init");

// --- fake Codex rollout: session_meta, turn_context (model), two cumulative token_count lines ---
const line = (type, payload) => JSON.stringify({ timestamp: "2026-06-14T00:00:00Z", type, payload });
const tc = (input, cached, output, reasoning, total) => ({
  type: "token_count",
  info: {
    total_token_usage: {
      input_tokens: input,
      cached_input_tokens: cached,
      output_tokens: output,
      reasoning_output_tokens: reasoning,
      total_tokens: total,
    },
    last_token_usage: { input_tokens: input, output_tokens: output },
    model_context_window: 272000,
  },
});
fs.writeFileSync(
  rollout,
  [
    line("session_meta", { id: SID, model_provider: "openai" }),
    line("turn_context", { model: "gpt-5-codex" }),
    line("event_msg", tc(5000, 2000, 1500, 500, 6500)),
    line("event_msg", tc(12000, 6000, 4000, 1000, 16000)),
  ].join("\n") + "\n",
);

// --- drive Codex hooks (note: model present on every payload, transcript_path = rollout) ---
const common = { session_id: SID, cwd: tmp, transcript_path: rollout, model: "gpt-5-codex" };
hook({ ...common, hook_event_name: "SessionStart", source: "startup" });
hook({ ...common, hook_event_name: "UserPromptSubmit", prompt: "refactor the parser" });
hook({ ...common, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "pytest" }, tool_response: { exit_code: 0 } });
// mutate the tree so git delta is real
fs.writeFileSync(path.join(tmp, "main.py"), "print('hi')\n# refactored\n".repeat(20));
hook({ ...common, hook_event_name: "Stop" });

console.log("===== codex report =====");
process.stdout.write(cli(["report"]).stdout);

const j = JSON.parse(cli(["report", "--json", "--no-save"]).stdout);
const checks = [];
const expect = (name, got, want) => {
  const ok = got === want;
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got=${got} want=${want}`);
};
console.log("\n===== assertions =====");
expect("tool detected", j.tool, "codex");
expect("model", j.models[0], "gpt-5-codex");
// last cumulative token_count: input 12000 (incl 6000 cached) => nonCached 6000, cacheRead 6000, output 4000
expect("input tokens (non-cached)", j.tokens.inputTokens, 6000);
expect("cache read tokens", j.tokens.cacheReadTokens, 6000);
expect("output tokens", j.tokens.outputTokens, 4000);
expect("requests (token_count lines)", j.tokens.requests, 2);
// cost: 6000*1.25 + 4000*10 + 6000*1.25*0.1 = 48250 / 1e6
const wantCost = (6000 * 1.25 + 4000 * 10 + 6000 * 1.25 * 0.1) / 1e6;
expect("cost usd", Number(j.cost.usd.toFixed(5)), Number(wantCost.toFixed(5)));
expect("cost flagged approximate", j.cost.hasUnknownModel, true);
expect("file source git", j.files.source, "git");

console.log("\n===== install --codex --print (no SessionEnd, --tool codex) =====");
const out = cli(["install", "--codex", "--print"]).stdout;
const settings = JSON.parse(out.split("\n").filter((l) => !l.startsWith("(")).join("\n"));
const events = Object.keys(settings.hooks);
expect("codex has Stop", events.includes("Stop"), true);
expect("codex has no SessionEnd", events.includes("SessionEnd"), false);
const cmd = settings.hooks.PostToolUse[0].hooks[0].command;
expect("codex command tags --tool codex", cmd.includes("--tool codex"), true);
expect("codex matcher is regex .*", settings.hooks.PostToolUse[0].matcher, ".*");

fs.rmSync(tmp, { recursive: true, force: true });
const allPass = checks.every(Boolean);
console.log(allPass ? "\nCODEX E2E PASSED ✓" : "\nCODEX E2E FAILED ✗");
process.exit(allPass ? 0 : 1);
