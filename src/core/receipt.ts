// Render a RunReport as a terminal receipt.

import type { Finding, RunReport } from "./types";
import { c, fmtInt, fmtTokens, fmtUsd, toolLabel, wrapText } from "./util";

/** Wrap width that respects the terminal, clamped to a readable range. */
function wrapWidth(): number {
  const cols = (process.stdout && process.stdout.columns) || 80;
  return Math.max(48, Math.min(cols - 4, 100));
}

function severityTag(f: Finding): string {
  if (f.severity === "high") return c.red("●");
  if (f.severity === "medium") return c.yellow("●");
  return c.gray("●");
}

function scoreColor(score: number, s: string): string {
  if (score >= 75) return c.red(s);
  if (score >= 45) return c.yellow(s);
  return c.green(s);
}

export function renderReceipt(r: RunReport): string {
  const L: string[] = [];
  const totalInput =
    r.tokens.inputTokens + r.tokens.cacheReadTokens + r.tokens.cacheWrite5mTokens + r.tokens.cacheWrite1hTokens;

  L.push("");
  L.push(c.bold(c.cyan("  BarTab") + c.dim("  ·  " + toolLabel(r.tool))));
  L.push("");

  // Headline cost.
  const costStr = fmtUsd(r.cost.usd);
  L.push(`  ${c.bold(scoreColor(r.bloatScore, costStr))} ${c.dim("estimated run cost")}`);

  // Token + activity lines.
  L.push(`  ${c.bold(fmtTokens(totalInput))} ${c.dim("input tokens")}` + dimModel(r));
  L.push(`  ${c.bold(fmtTokens(r.tokens.outputTokens))} ${c.dim("output tokens")}`);
  if (r.tokens.cacheReadTokens > 0) {
    L.push(
      `  ${c.gray(fmtTokens(r.tokens.cacheReadTokens) + " cache reads · " + fmtTokens(r.tokens.cacheWrite5mTokens + r.tokens.cacheWrite1hTokens) + " cache writes")}`,
    );
  }
  L.push(`  ${c.bold(String(r.files.filesTouched))} ${c.dim("files touched")}` + fileDetail(r));
  L.push(`  ${c.bold(String(r.commandsRun))} ${c.dim("commands run")}`);
  L.push(`  ${c.bold(String(r.retries))} ${c.dim(r.retries === 1 ? "retry" : "retries")}`);
  L.push("");

  // Bloat score.
  L.push(
    `  ${c.dim("Bloat score:")} ${c.bold(scoreColor(r.bloatScore, String(r.bloatScore)))}${c.dim("/100")} ${bloatBar(r.bloatScore)}`,
  );
  L.push("");

  // Headline only for genuinely actionable (high/medium) findings — don't cry
  // "biggest waste" on a clean run. Low-severity items become quiet notes.
  const actionable = r.findings.filter(
    (f) => f.severity === "high" || f.severity === "medium",
  );
  const notes = r.findings.filter((f) => f.severity === "low");
  const headline = actionable[0];

  if (headline) {
    const w = wrapWidth();
    L.push(`  ${c.bold("Biggest waste:")}`);
    for (const ln of wrapText(headline.title, w)) L.push(`  ${c.yellow(ln)}`);
    for (const ln of wrapText(headline.explanation, w)) L.push(`  ${c.dim(ln)}`);
    L.push("");
    L.push(`  ${c.bold("Fix:")}`);
    for (const ln of wrapText(headline.suggestedFix, w)) L.push(`  ${c.green(ln)}`);
    L.push("");
    const rest = [...actionable.slice(1), ...notes];
    if (rest.length) {
      L.push(c.dim("  Other findings:"));
      for (const f of rest.slice(0, 5)) L.push(`   ${severityTag(f)} ${f.title}`);
      L.push("");
    }
    L.push(c.dim(`  run bartab fix  to turn the biggest wastes into agent rules`));
  } else {
    L.push(`  ${c.green("Clean run — no obvious waste detected.")}`);
    if (notes.length) {
      L.push("");
      L.push(c.dim("  Notes:"));
      for (const f of notes.slice(0, 4)) L.push(`   ${c.gray("·")} ${c.dim(f.title)}`);
    }
    L.push("");
  }

  if (r.cost.hasUnknownModel) {
    L.push(c.gray("  (cost uses approximate pricing for one or more models)"));
  }
  if (!r.tokens.found) {
    L.push(
      c.gray("  (transcript not found — token/cost numbers unavailable for this run)"),
    );
  }
  L.push("");

  return L.join("\n");
}

function dimModel(r: RunReport): string {
  if (r.models.length === 0) return "";
  const label = r.models.length === 1 ? r.models[0] : `${r.models[0]} +${r.models.length - 1}`;
  return c.gray("  (" + label + ")");
}

function fileDetail(r: RunReport): string {
  const bits: string[] = [];
  if (r.files.linesAdded) bits.push(c.green("+" + fmtInt(r.files.linesAdded)));
  if (r.files.linesRemoved) bits.push(c.red("-" + fmtInt(r.files.linesRemoved)));
  if (r.files.newFiles) bits.push(c.dim(r.files.newFiles + " new"));
  return bits.length ? "  " + bits.join(" ") : "";
}

function bloatBar(score: number): string {
  const width = 20;
  const filled = Math.round((score / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return scoreColor(score, bar);
}

/** Plain-text (no ANSI) receipt, for piping/sharing. */
export function renderReceiptPlain(r: RunReport): string {
  const prev = process.env.BARTAB_NO_COLOR;
  process.env.BARTAB_NO_COLOR = "1";
  try {
    return renderReceipt(r);
  } finally {
    if (prev === undefined) delete process.env.BARTAB_NO_COLOR;
    else process.env.BARTAB_NO_COLOR = prev;
  }
}
