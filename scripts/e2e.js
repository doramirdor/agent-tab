#!/usr/bin/env node
// End-to-end smoke test against the compiled binary. Spawns a fake Claude Code
// session (synthetic hook payloads + a realistic transcript) and runs the CLI.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BIN = path.resolve(__dirname, "..", "bin", "agent-tab.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tab-e2e-"));
const SID = "test-session-0001";
const transcript = path.join(tmp, ".transcript.jsonl");

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: tmp, encoding: "utf8", ...opts });
}
function git(...args) {
  return sh("git", args);
}
function hook(payload) {
  const r = spawnSync("node", [BIN, "hook"], {
    cwd: tmp,
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error("hook exited nonzero: " + r.stderr);
}
function cli(args) {
  return spawnSync("node", [BIN, ...args], {
    cwd: tmp,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
}

// --- 1. init a git repo with a baseline ---
git("init", "-q");
git("config", "user.email", "t@t.com");
git("config", "user.name", "t");
fs.writeFileSync(path.join(tmp, "Button.tsx"), "export const Button = () => null;\n");
git("add", "-A");
git("commit", "-q", "-m", "init");

// --- 2. realistic transcript: 2 API requests, each written as multiple content-block
//     lines that all share the same requestId + usage (the dedup gotcha). ---
const u = (rid, usage, blocks) =>
  blocks.map((b) =>
    JSON.stringify({
      type: "assistant",
      requestId: rid,
      isSidechain: false,
      message: { role: "assistant", model: "claude-opus-4-8", id: "msg_" + rid, usage, content: [b] },
    }),
  );
const t1 = { input_tokens: 10000, output_tokens: 2000, cache_read_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3000 } };
const t2 = { input_tokens: 2, output_tokens: 4000, cache_read_input_tokens: 24000, cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 0 } };
const lines = [
  JSON.stringify({ type: "user", message: { role: "user", content: "change button color" } }),
  ...u("req-1", t1, [{ type: "thinking" }, { type: "text" }, { type: "tool_use" }]),
  ...u("req-2", t2, [{ type: "text" }, { type: "tool_use" }]),
];
fs.writeFileSync(transcript, lines.join("\n") + "\n");

// --- 3. drive the hooks ---
const common = { session_id: SID, cwd: tmp, transcript_path: transcript };
hook({ ...common, hook_event_name: "SessionStart", source: "startup" });
hook({ ...common, hook_event_name: "UserPromptSubmit", prompt: "change button color" });

// read the lockfile 5x (waste)
for (let i = 0; i < 5; i++)
  hook({ ...common, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: tmp + "/package-lock.json" }, tool_response: "x".repeat(120000) });
// read source once
hook({ ...common, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: tmp + "/Button.tsx" }, tool_response: "export const Button..." });
// run failing test 4x (failed loop)
for (let i = 0; i < 4; i++)
  hook({ ...common, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm test" }, tool_response: { stdout: "", stderr: "1 failing", exit_code: 1 } });
// add a dependency (dependency change) + edit lockfile
hook({ ...common, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "npm install lodash" }, tool_response: { stdout: "added 1 package", exit_code: 0 } });
// write several new files (sprawl + big diff)
for (const f of ["theme.ts", "colors.ts", "Button.css", "ButtonStyles.ts", "tokens.ts", "palette.ts"])
  hook({ ...common, hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: tmp + "/" + f, content: "x\n".repeat(40) } });

// --- 4. actually mutate the working tree so the git delta is real ---
fs.writeFileSync(path.join(tmp, "Button.tsx"), "export const Button = () => null; // blue\n".repeat(30));
for (const f of ["theme.ts", "colors.ts", "Button.css", "ButtonStyles.ts", "tokens.ts", "palette.ts"])
  fs.writeFileSync(path.join(tmp, f), "x\n".repeat(40));
fs.writeFileSync(path.join(tmp, "package.json"), '{\n  "dependencies": { "lodash": "^4" }\n}\n');

hook({ ...common, hook_event_name: "Stop" });

// --- 5. run the CLI ---
console.log("\n===== report =====");
const rep = cli(["report"]);
process.stdout.write(rep.stdout);
if (rep.stderr) process.stderr.write(rep.stderr);

console.log("\n===== report --json (key numbers) =====");
const j = JSON.parse(cli(["report", "--json", "--no-save"]).stdout);
const t = j.tokens;
const checks = [];
const expect = (name, got, want) => {
  const ok = got === want;
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got=${got} want=${want}`);
};
expect("requests (deduped)", t.requests, 2);
expect("input tokens", t.inputTokens, 10002);
expect("output tokens", t.outputTokens, 6000);
expect("cache read", t.cacheReadTokens, 29000);
expect("cache write 1h", t.cacheWrite1hTokens, 3000);
expect("cache write 5m", t.cacheWrite5mTokens, 1000);
// cost: 10002*5 + 6000*25 + 29000*0.5 + 1000*6.25 + 3000*10 = 250760 / 1e6
const wantCost = (10002 * 5 + 6000 * 25 + 29000 * 5 * 0.1 + 1000 * 5 * 1.25 + 3000 * 5 * 2) / 1e6;
expect("cost usd (rounded 5dp)", Number(j.cost.usd.toFixed(5)), Number(wantCost.toFixed(5)));
expect("model", j.models[0], "claude-opus-4-8");
expect("commands run", j.commandsRun, 5);
expect("retries", j.retries, 4);
expect("file source", j.files.source, "git");
expect("has huge_file_read finding", j.findings.some((f) => f.type === "huge_file_read"), true);
console.log("bloat score:", j.bloatScore);
console.log("findings:", j.findings.map((f) => f.type).join(", "));
console.log("files: touched=%d added=%d new=%d (src=%s)", j.files.filesTouched, j.files.linesAdded, j.files.newFiles, j.files.source);
console.log("dep files:", j.files.dependencyFilesChanged.join(", ") || "(none)");

console.log("\n===== fix --print =====");
process.stdout.write(cli(["fix", "--print"]).stdout);

console.log("\n===== share =====");
process.stdout.write(cli(["share"]).stdout);
const svg = path.join(tmp, ".agent-tab", "receipts", SID + ".svg");
console.log("svg exists:", fs.existsSync(svg), "bytes:", fs.existsSync(svg) ? fs.statSync(svg).size : 0);

console.log("\n===== share --png =====");
process.stdout.write(cli(["share", "--png"]).stdout);
const png = path.join(tmp, ".agent-tab", "receipts", SID + ".png");
const pngOk = fs.existsSync(png) && fs.readFileSync(png).slice(1, 4).toString() === "PNG";
expect("png written with PNG magic bytes", pngOk, true);

console.log("\n===== summary --all =====");
process.stdout.write(cli(["summary", "--all"]).stdout);
const sum = JSON.parse(cli(["summary", "--all", "--json"]).stdout);
expect("summary counts the run", sum.runs, 1);
expect("summary total cost matches", Number(sum.totalCostUsd.toFixed(5)), 0.25076);

console.log("\n===== history =====");
process.stdout.write(cli(["report", "--history"]).stdout);

const allPass = checks.every(Boolean);
console.log("\nTMP:", tmp);
console.log(allPass ? "\nALL ASSERTIONS PASSED ✓" : "\nSOME ASSERTIONS FAILED ✗");
process.exit(allPass ? 0 : 1);
