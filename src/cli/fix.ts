// `openbar fix` — turn detected waste into agent rules (CLAUDE.md / AGENTS.md).

import * as fs from "fs";
import * as path from "path";
import { analyze, loadEvents } from "../core/analyze";
import {
  projectRoot,
  recentSessionIds,
  sessionJsonlPath,
} from "../core/paths";
import type { RunReport, Severity } from "../core/types";
import { c } from "../core/util";

const START = "<!-- openbar:start -->";
const END = "<!-- openbar:end -->";

// Canonical, crisp rule per finding type. Falls back to the finding's suggestedFix.
const CANONICAL: Record<string, string> = {
  lockfile_reads:
    "Do not read lockfiles (package-lock.json, yarn.lock, pnpm-lock.yaml, etc.) unless explicitly asked. Use the manifest (e.g. package.json) for dependency questions.",
  repeated_reads:
    "Read a file once and keep it in context. Do not re-read the same file multiple times within a run.",
  generated_reads:
    "Never read inside generated or vendored directories (node_modules, dist, build, vendor). Work from source.",
  repeated_commands:
    "Do not re-run a command whose output you already have; reuse the previous result.",
  failed_command_loop:
    "If the same command fails twice for the same reason, stop and explain the blocker instead of retrying.",
  dependency_changes:
    "Do not add or upgrade dependencies without asking first. Prefer the standard library or existing dependencies.",
  generated_changes:
    "Never edit generated or build output directly (dist, build, *.min.js). Change the source and rebuild.",
  big_diff_small_prompt:
    "Only make changes directly requested. Do not add helpers, abstractions, or speculative error handling.",
  huge_file_read:
    "Read only the lines you need (use offset/limit) or grep first. Do not read large files fully into context.",
  huge_tool_output:
    "Pipe long command output through head/grep. Avoid commands that dump entire files or directories.",
  edit_churn:
    "Plan the full change before editing. Make fewer, larger edits instead of many incremental tweaks.",
  output_heavy:
    "Be concise and make targeted edits. Do not rewrite whole files when a small edit will do.",
  file_sprawl:
    "Prefer editing existing files over creating new ones. Search for an existing component/helper before creating one.",
};

const DEFAULTS = [
  "Before creating a new component or utility, search for an existing one first.",
  "Prefer editing existing files over creating new abstractions.",
];

interface FixOpts {
  session?: string;
  targets: string[];
  print: boolean;
  last: number;
}

function parseOpts(argv: string[]): FixOpts {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const targets: string[] = ["CLAUDE.md"];
  if (argv.includes("--agents") || argv.includes("--all")) targets.push("AGENTS.md");
  const customTarget = get("--target");
  if (customTarget) {
    targets.length = 0;
    targets.push(customTarget);
  }
  return {
    session: get("--session") || argv.find((a) => !a.startsWith("-")),
    targets,
    print: argv.includes("--print") || argv.includes("--dry-run"),
    last: Math.max(1, parseInt(get("--last") || "15", 10) || 15),
  };
}

const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

interface Aggregated {
  rules: string[];
  /** Finding types ranked by how many sessions they appear in. */
  topTypes: { type: string; sessions: number }[];
}

/**
 * Aggregate findings across several runs. A waste that recurs across sessions is a
 * stronger signal than the single latest run (which may be clean). Each finding type
 * is counted once per session; rules are emitted in order of recurrence (then severity).
 */
function aggregate(reports: RunReport[]): Aggregated {
  const byType = new Map<string, { sessions: number; sev: number; rule: string }>();
  for (const r of reports) {
    const seenInSession = new Set<string>();
    for (const f of r.findings) {
      if (seenInSession.has(f.type)) continue;
      seenInSession.add(f.type);
      const rule = CANONICAL[f.type] || f.suggestedFix;
      if (!rule) continue;
      const e = byType.get(f.type) || { sessions: 0, sev: 0, rule };
      e.sessions += 1;
      e.sev += SEV_RANK[f.severity] || 1;
      byType.set(f.type, e);
    }
  }
  const sorted = [...byType.entries()].sort(
    (a, b) => b[1].sessions - a[1].sessions || b[1].sev - a[1].sev,
  );

  const rules: string[] = [];
  const seen = new Set<string>();
  const topTypes: { type: string; sessions: number }[] = [];
  for (const [type, info] of sorted) {
    topTypes.push({ type, sessions: info.sessions });
    if (!seen.has(info.rule) && rules.length < 8) {
      seen.add(info.rule);
      rules.push(info.rule);
    }
  }
  for (const d of DEFAULTS) {
    if (rules.length >= 3) break;
    if (!seen.has(d)) {
      seen.add(d);
      rules.push(d);
    }
  }
  return { rules, topTypes };
}

function buildBlock(rules: string[], sourceNote: string): string {
  const lines: string[] = [];
  lines.push(START);
  lines.push("## Agent cost rules");
  lines.push("");
  lines.push(
    `<!-- Generated by openbar from ${sourceNote}. Re-run \`openbar fix\` to refresh. -->`,
  );
  lines.push("");
  for (const r of rules) lines.push(`- ${r}`);
  lines.push("");
  lines.push(END);
  return lines.join("\n");
}

function upsertBlock(existing: string, block: string): string {
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    return existing.slice(0, s) + block + existing.slice(e + END.length);
  }
  // Append.
  const sep = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n" : "";
  return existing + sep + block + "\n";
}

export function runFix(argv: string[]): number {
  const opts = parseOpts(argv);

  let rules: string[];
  let sourceNote: string;

  if (opts.session) {
    // Single session (explicit).
    const jsonlPath = sessionJsonlPath(opts.session);
    if (!fs.existsSync(jsonlPath)) {
      process.stderr.write(c.red(`No event log for session ${opts.session}\n`));
      return 1;
    }
    const report = analyze(loadEvents(jsonlPath), { sessionId: opts.session });
    rules = aggregate([report]).rules;
    sourceNote = `session ${opts.session.slice(0, 8)} (bloat ${report.bloatScore}/100)`;
  } else {
    // Default: aggregate across recent sessions, so recurring waste wins over a
    // single (possibly clean) latest run.
    const ids = recentSessionIds(opts.last);
    if (ids.length === 0) {
      process.stderr.write(
        c.yellow("No runs found in this project yet — nothing to fix.\n"),
      );
      return 1;
    }
    const reports: RunReport[] = [];
    for (const id of ids) {
      try {
        reports.push(analyze(loadEvents(sessionJsonlPath(id)), { sessionId: id }));
      } catch {
        /* skip an unreadable session */
      }
    }
    rules = aggregate(reports).rules;
    sourceNote = `${reports.length} recent session${reports.length === 1 ? "" : "s"}`;
  }

  const block = buildBlock(rules, sourceNote);

  if (opts.print) {
    process.stdout.write(block + "\n");
    return 0;
  }

  const root = projectRoot();
  for (const target of opts.targets) {
    const file = path.isAbsolute(target) ? target : path.join(root, target);
    let existing = "";
    try {
      existing = fs.readFileSync(file, "utf8");
    } catch {
      /* new file */
    }
    fs.writeFileSync(file, upsertBlock(existing, block));
    process.stdout.write(
      c.green(`  ✓ Wrote ${rules.length} rule(s) to ${c.cyan(file)} `) +
        c.dim(`(from ${sourceNote})\n`),
    );
  }
  process.stdout.write(
    c.dim("\n  These rules apply on the next run. Re-run anytime to refresh.\n"),
  );
  return 0;
}
