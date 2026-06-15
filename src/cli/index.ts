// agent-tab CLI dispatch.

import { runFix } from "./fix";
import { runHook } from "./hook";
import { runInstall, runUninstall } from "./install";
import { runReport } from "./report";
import { runShare } from "./share";
import { runSummary } from "./summary";
import { sqliteAvailable } from "../core/storage";
import { c } from "../core/util";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json") as { version: string };

function help(): void {
  const t = `
${c.bold(c.cyan("Agent Tab"))} ${c.dim("— a spending tab for your coding agent")}

${c.bold("Usage")}
  agent-tab <command> [options]

${c.bold("Commands")}
  ${c.green("install")}      Add hooks to Claude Code (or Codex with --codex)
  ${c.green("report")}       Print a receipt for the latest run
  ${c.green("summary")}      Aggregate recent runs (your weekly agent bill)
  ${c.green("share")}        Render a shareable card (SVG / PNG / HTML)
  ${c.green("fix")}          Write detected waste as rules into CLAUDE.md / AGENTS.md
  ${c.green("uninstall")}    Remove agent-tab hooks
  ${c.green("hook")}         (internal) collect a hook event from stdin

${c.bold("Examples")}
  npx agent-tab install
  npx agent-tab install --codex
  npx agent-tab report
  npx agent-tab summary
  npx agent-tab share --png
  npx agent-tab fix --all

${c.bold("Options")}
  install  --codex --global --local --print
  report   [session] --json --history --transcript <path> --no-save
  summary  --days <n> --all --json
  share    [session] --png --html --out <file>
  fix      [session] --all --target <file> --print

${c.dim(`v${pkg.version}  ·  history storage: ${sqliteAvailable() ? "on (node:sqlite)" : "off (node:sqlite unavailable)"}`)}
`;
  process.stdout.write(t + "\n");
}

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case "install":
      return runInstall(rest);
    case "uninstall":
      return runUninstall(rest);
    case "hook":
      return runHook(rest);
    case "report":
      return runReport(rest);
    case "summary":
      return runSummary(rest);
    case "share":
      return runShare(rest);
    case "fix":
      return runFix(rest);
    case "version":
    case "--version":
    case "-v":
      process.stdout.write(pkg.version + "\n");
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      help();
      return 0;
    default:
      process.stderr.write(c.red(`Unknown command: ${cmd}\n`));
      help();
      return 1;
  }
}
