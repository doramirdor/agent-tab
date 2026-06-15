// `agent-tab summary` — a local aggregate of recent runs (your weekly agent bill).

import { dbPath } from "../core/paths";
import { sqliteAvailable, summarize } from "../core/storage";
import { c, fmtInt, fmtTokens, fmtUsd } from "../core/util";

export function runSummary(argv: string[]): number {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const json = argv.includes("--json");
  const all = argv.includes("--all");
  const days = all ? 0 : parseInt(get("--days") || "7", 10) || 7;

  if (!sqliteAvailable()) {
    process.stderr.write(
      c.yellow("History storage is unavailable (node:sqlite not found).\n") +
        c.dim("Summaries need Node >= 22.5. Single-run receipts still work.\n"),
    );
    return 1;
  }

  const s = summarize(dbPath(), days);
  if (!s || s.runs === 0) {
    process.stdout.write(
      c.dim(
        all
          ? "No saved runs yet. Run  agent-tab report  after a session.\n"
          : `No runs in the last ${days} days. Try  agent-tab summary --all\n`,
      ),
    );
    return 0;
  }

  if (json) {
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    return 0;
  }

  const period = all ? "all time" : `last ${days} days`;
  const L: string[] = [];
  L.push("");
  L.push(c.bold(c.cyan("  Agent Tab") + c.dim(`  ·  bill (${period})`)));
  L.push("");
  L.push(`  ${c.bold(fmtUsd(s.totalCostUsd))} ${c.dim("estimated across " + s.runs + " run" + (s.runs === 1 ? "" : "s"))}`);
  L.push(`  ${c.bold(fmtTokens(s.totalInputTokens))} in ${c.dim("·")} ${c.bold(fmtTokens(s.totalOutputTokens))} out ${c.dim("tokens")}`);
  L.push(`  ${c.bold(fmtInt(s.totalFiles))} ${c.dim("files touched")} ${c.dim("·")} ${c.green("+" + fmtInt(s.totalLinesAdded))} ${c.dim("lines")}`);
  L.push(`  ${c.dim("avg bloat")} ${c.bold(String(Math.round(s.avgBloat)))}${c.dim("/100")}`);
  L.push("");
  if (s.worst) {
    L.push(`  ${c.dim("Priciest run:")} ${c.bold(fmtUsd(s.worst.cost))} ${c.dim("(bloat " + s.worst.bloat + ")")} ${c.gray(s.worst.id.slice(0, 8))}`);
  }
  if (s.topFindings.length) {
    L.push("");
    L.push(c.dim("  Most common waste:"));
    for (const f of s.topFindings) {
      L.push(`   ${c.yellow("•")} ${f.type.replace(/_/g, " ")} ${c.dim("×" + f.count)}`);
    }
  }
  L.push("");
  L.push(c.dim("  agent-tab fix  bakes the recurring ones into your agent rules"));
  L.push("");
  process.stdout.write(L.join("\n"));
  return 0;
}
