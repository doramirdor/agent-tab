// `bartab report` — analyze a session and print a receipt.

import * as fs from "fs";
import { analyze, loadEvents } from "../core/analyze";
import { dbPath, latestSessionId, projectRoot, runsDir, sessionJsonlPath } from "../core/paths";
import { renderReceipt } from "../core/receipt";
import { listProjects } from "../core/registry";
import { listRuns, saveRun } from "../core/storage";
import type { RunReport } from "../core/types";
import { c, fmtUsd } from "../core/util";

interface ReportOpts {
  session?: string;
  transcript?: string;
  json: boolean;
  history: boolean;
  noSave: boolean;
}

function parseOpts(argv: string[]): ReportOpts {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // Allow a bare session id as the first positional arg.
  const positional = argv.find((a) => !a.startsWith("-"));
  return {
    session: get("--session") || positional,
    transcript: get("--transcript"),
    json: argv.includes("--json"),
    history: argv.includes("--history") || argv.includes("--all"),
    noSave: argv.includes("--no-save"),
  };
}

export function runReport(argv: string[]): number {
  const opts = parseOpts(argv);

  if (opts.history) return printHistory(opts.json);

  const sessionId = opts.session || latestSessionId();
  if (!sessionId) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ error: "no runs in this project" }) + "\n");
      return 1;
    }
    process.stderr.write(
      c.yellow("No bartab runs in this project.\n") +
        c.dim(`(looked in ${runsDir()})\n`),
    );
    printWhereData();
    return 1;
  }

  const jsonlPath = sessionJsonlPath(sessionId);
  if (!fs.existsSync(jsonlPath)) {
    process.stderr.write(c.red(`No event log for session ${sessionId}\n`));
    return 1;
  }

  const events = loadEvents(jsonlPath);
  const report = analyze(events, {
    sessionId,
    transcriptPath: opts.transcript,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  // If we auto-picked an unusable session (no transcript, no activity), the user is
  // almost certainly in the wrong directory — guide them instead of showing zeros.
  if (!opts.session && isEmptyRun(report)) {
    process.stdout.write(
      c.yellow("\n  Nothing to report in this project yet.\n") +
        c.dim(
          `  The latest session here (${sessionId.slice(0, 8)}) has no token data —\n` +
            `  report reads ./.bartab/runs under the current project.\n`,
        ),
    );
    printWhereData();
    return 0;
  }

  if (!opts.noSave) saveRun(dbPath(), report);
  process.stdout.write(renderReceipt(report) + "\n");
  return 0;
}

function isEmptyRun(r: RunReport): boolean {
  return (
    !r.tokens.found &&
    r.toolCalls === 0 &&
    r.commandsRun === 0 &&
    r.files.filesTouched === 0
  );
}

function printWhereData(): void {
  const here = projectRoot();
  const projects = listProjects().filter((p) => p.path !== here);
  if (projects.length === 0) return;
  const L: string[] = [];
  L.push("");
  L.push(c.dim("  Your recent bartab projects:"));
  for (const p of projects.slice(0, 8)) {
    L.push(`   ${c.cyan(p.path)}`);
  }
  L.push("");
  L.push(c.dim("  cd into one and run  bartab report  (it's per-project)."));
  L.push("");
  process.stdout.write(L.join("\n"));
}

function printHistory(json: boolean): number {
  const rows = listRuns(dbPath(), 10);
  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  if (rows.length === 0) {
    process.stdout.write(c.dim("No saved runs yet. Run  bartab report  first.\n"));
    return 0;
  }
  const L: string[] = [];
  L.push("");
  L.push(c.bold("  Recent runs"));
  L.push("");
  L.push(
    c.dim("  " + pad("when", 18) + pad("cost", 9) + pad("bloat", 7) + pad("files", 7) + "model"),
  );
  for (const r of rows) {
    const when = (r.started_at || "").replace("T", " ").slice(0, 16) || "—";
    const cost = fmtUsd(r.estimated_cost_usd || 0);
    const bloat = String(r.bloat_score ?? "—");
    const files = String(r.files_touched ?? "—");
    const model = (r.model || "").split(",")[0] || "—";
    L.push("  " + pad(when, 18) + pad(cost, 9) + pad(bloat, 7) + pad(files, 7) + c.dim(model));
  }
  L.push("");
  process.stdout.write(L.join("\n"));
  return 0;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length);
}

export type { RunReport };
