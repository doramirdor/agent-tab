// `agent-tab report` — analyze a session and print a receipt.

import * as fs from "fs";
import { analyze, loadEvents } from "../core/analyze";
import { dbPath, latestSessionId, runsDir, sessionJsonlPath } from "../core/paths";
import { renderReceipt } from "../core/receipt";
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
    process.stderr.write(
      c.yellow("No runs found yet.\n") +
        c.dim(
          `Run  npx agent-tab install  then use Claude Code in this project.\n` +
            `(looked in ${runsDir()})\n`,
        ),
    );
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

  if (!opts.noSave) {
    saveRun(dbPath(), report);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  }

  process.stdout.write(renderReceipt(report) + "\n");
  return 0;
}

function printHistory(json: boolean): number {
  const rows = listRuns(dbPath(), 10);
  if (json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }
  if (rows.length === 0) {
    process.stdout.write(c.dim("No saved runs yet. Run  agent-tab report  first.\n"));
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
