// Waste detectors. Each looks at the derived event/usage/file data and returns
// findings. Rules are intentionally simple — simple rules already produce useful,
// memeable receipts.

import type { DerivedEvents } from "./events";
import { isGenerated, isLockfile, isManifest } from "./git";
import type { FileStats, Finding, TranscriptSummary } from "./types";
import { oneLine } from "./util";

export interface DetectorContext {
  derived: DerivedEvents;
  files: FileStats;
  tokens: TranscriptSummary;
  firstPrompt: string;
  promptChars: number;
  /** Absolute repo path, used to relativize file paths for display. */
  repoPath?: string;
}

type Detector = (ctx: DetectorContext) => Finding | null;

const REPEAT_READ_THRESHOLD = 3;
const REPEAT_CMD_THRESHOLD = 3;
const HUGE_OUTPUT_BYTES = 200_000;

function base(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

/** Make a path repo-relative for display when possible. */
function rel(p: string, ctx: DetectorContext): string {
  if (ctx.repoPath && p.startsWith(ctx.repoPath)) {
    return p.slice(ctx.repoPath.length).replace(/^\/+/, "") || p;
  }
  return p;
}

// 1. The same file read many times.
const repeatedReads: Detector = (ctx) => {
  const top = ctx.derived.readCounts.find((r) => r.count >= REPEAT_READ_THRESHOLD);
  if (!top) return null;
  const name = base(top.path);
  const display = rel(top.path, ctx);
  return {
    type: "repeated_reads",
    severity: top.count >= 5 ? "high" : "medium",
    title: `Re-read ${name} ${top.count} times`,
    explanation: `The agent read ${display} ${top.count} times in one run. Repeated reads of the same file burn input tokens re-loading context it already had.`,
    suggestedFix: `Tell the agent to read ${name} once and keep it in context, or add it to your ignore rules if it's noise.`,
    count: top.count,
    evidence: display,
  };
};

// 2. Lockfiles read at all (almost always wasteful for an agent).
const lockfileReads: Detector = (ctx) => {
  const lock = ctx.derived.readCounts.filter((r) => isLockfile(r.path));
  if (lock.length === 0) return null;
  const total = lock.reduce((s, r) => s + r.count, 0);
  const worst = lock[0];
  return {
    type: "lockfile_reads",
    severity: total >= 3 ? "high" : "medium",
    title: `Read lockfiles ${total} time${total === 1 ? "" : "s"}`,
    explanation: `Lockfiles like ${base(
      worst.path,
    )} are huge and rarely useful to read directly — they can be tens of thousands of tokens each.`,
    suggestedFix:
      "Add lockfiles to your agent ignore rules. Use package.json (or the manifest) for dependency questions.",
    count: total,
    evidence: lock.map((r) => `${base(r.path)} ×${r.count}`).join(", "),
  };
};

// 3. node_modules / vendor / generated dirs read.
const generatedReads: Detector = (ctx) => {
  const gen = ctx.derived.readCounts.filter((r) => isGenerated(r.path));
  if (gen.length === 0) return null;
  const total = gen.reduce((s, r) => s + r.count, 0);
  return {
    type: "generated_reads",
    severity: total >= 4 ? "high" : "low",
    title: `Read generated/vendored files ${total} times`,
    explanation:
      "Reading inside node_modules, dist, build, or other generated directories rarely helps and pulls in large, low-signal content.",
    suggestedFix:
      "Tell the agent to never read generated/vendored directories; work from source instead.",
    count: total,
    evidence: gen
      .slice(0, 3)
      .map((r) => `${rel(r.path, ctx)} ×${r.count}`)
      .join(", "),
  };
};

// 4. Same command run many times (and the test-loop variant).
const repeatedCommands: Detector = (ctx) => {
  const top = ctx.derived.bashCounts.find((b) => b.count >= REPEAT_CMD_THRESHOLD);
  if (!top) return null;
  const isFailingLoop = top.failures >= 2;
  return {
    type: isFailingLoop ? "failed_command_loop" : "repeated_commands",
    severity: top.count >= 5 || isFailingLoop ? "high" : "medium",
    title: isFailingLoop
      ? `Ran a failing command ${top.count} times (${top.failures} failures)`
      : `Ran the same command ${top.count} times`,
    explanation: isFailingLoop
      ? `\`${oneLine(top.cmd, 60)}\` failed repeatedly and was retried ${top.count} times. Retry loops on the same failure waste tokens and money without making progress.`
      : `\`${oneLine(top.cmd, 60)}\` was executed ${top.count} times. Re-running the same command often means the agent lost track of earlier output.`,
    suggestedFix: isFailingLoop
      ? "Add a rule: if the same command fails twice for the same reason, stop and explain the blocker instead of retrying."
      : "Add a rule: don't re-run a command whose output you already have; reuse the previous result.",
    count: top.count,
    evidence: oneLine(top.cmd, 80),
  };
};

// 5. Dependency changes (manifest/lockfile touched).
const dependencyChanges: Detector = (ctx) => {
  const dep = ctx.files.dependencyFilesChanged;
  if (dep.length === 0) return null;
  const addedManifest = dep.some(isManifest);
  return {
    type: "dependency_changes",
    severity: addedManifest ? "medium" : "low",
    title: `Changed dependency files (${dep.map(base).join(", ")})`,
    explanation:
      "Dependency manifests/lockfiles were modified during this run. New dependencies add surface area and aren't always necessary.",
    suggestedFix:
      "Add a rule: do not add or upgrade dependencies without asking first; prefer the standard library or existing deps.",
    count: dep.length,
    evidence: dep.join(", "),
  };
};

// 6. Generated/build artifacts edited.
const generatedChanges: Detector = (ctx) => {
  const gen = ctx.files.generatedFilesChanged;
  if (gen.length === 0) return null;
  return {
    type: "generated_changes",
    severity: gen.length >= 3 ? "high" : "medium",
    title: `Edited ${gen.length} generated/build file${gen.length === 1 ? "" : "s"}`,
    explanation:
      "Editing generated or build output (dist, build, .min.js, etc.) is usually a mistake — the changes get overwritten on the next build.",
    suggestedFix:
      "Add a rule: never edit generated/build output directly; change the source and rebuild.",
    count: gen.length,
    evidence: gen.slice(0, 3).join(", "),
  };
};

// 7. Big diff for a tiny prompt.
const bigDiffSmallPrompt: Detector = (ctx) => {
  const { linesAdded, filesTouched } = ctx.files;
  if (ctx.promptChars >= 200) return null;
  if (linesAdded < 150 && filesTouched < 10) return null;
  return {
    type: "big_diff_small_prompt",
    severity: linesAdded >= 400 || filesTouched >= 15 ? "high" : "medium",
    title: `Large change (${linesAdded} lines, ${filesTouched} files) for a short prompt`,
    explanation: `The request was short (${ctx.promptChars} chars) but the agent produced a large diff. That mismatch often means scope creep — extra files, abstractions, or "while I'm here" changes.`,
    suggestedFix:
      "Add a rule: only make changes directly requested. Don't add helpers, abstractions, or speculative error handling.",
    count: filesTouched,
    evidence: oneLine(ctx.firstPrompt, 80),
  };
};

// 8a. A single file read fully into context.
const HUGE_READ_BYTES = 100_000;
const hugeFileRead: Detector = (ctx) => {
  if (ctx.derived.maxReadBytes < HUGE_READ_BYTES) return null;
  const kb = Math.round(ctx.derived.maxReadBytes / 1024);
  const name = ctx.derived.maxReadPath ? base(ctx.derived.maxReadPath) : "a file";
  return {
    type: "huge_file_read",
    severity: kb >= 300 ? "high" : "medium",
    title: `Read ${name} fully into context (${kb} KB)`,
    explanation: `A single Read pulled ~${kb} KB into context at once. Large files are expensive to load whole and crowd out useful context.`,
    suggestedFix:
      "Use offset/limit to read only the relevant lines, or grep for what you need before reading.",
    count: ctx.derived.maxReadBytes,
    evidence: ctx.derived.maxReadPath ? rel(ctx.derived.maxReadPath, ctx) : undefined,
  };
};

// 8b. Huge output from a non-Read tool.
const hugeToolOutput: Detector = (ctx) => {
  if (ctx.derived.maxResponseBytes < HUGE_OUTPUT_BYTES) return null;
  // Avoid double-reporting the file-read case (covered by hugeFileRead).
  if (ctx.derived.maxResponseBytes <= ctx.derived.maxReadBytes) return null;
  return {
    type: "huge_tool_output",
    severity: "medium",
    title: `A single tool returned ${Math.round(
      ctx.derived.maxResponseBytes / 1024,
    )} KB`,
    explanation:
      "A tool call returned a very large output that was loaded straight into context. Large outputs are expensive and crowd out useful context.",
    suggestedFix:
      "Pipe long command output through head/grep, and avoid commands that dump entire files or directories.",
    count: ctx.derived.maxResponseBytes,
  };
};

// 10. Same file edited many times (churn).
const editChurn: Detector = (ctx) => {
  const top = ctx.derived.editCounts.find((e) => e.count >= 4);
  if (!top) return null;
  return {
    type: "edit_churn",
    severity: top.count >= 7 ? "high" : "medium",
    title: `Edited ${base(top.path)} ${top.count} times`,
    explanation: `The agent edited ${rel(top.path, ctx)} ${top.count} times in one run. Lots of small edits to one file usually means it was thrashing instead of planning the change.`,
    suggestedFix:
      "Plan the full change before editing; make fewer, larger edits instead of many incremental tweaks.",
    count: top.count,
    evidence: rel(top.path, ctx),
  };
};

// 11. Too much output generated.
const outputHeavy: Detector = (ctx) => {
  const out = ctx.tokens.outputTokens;
  if (out < 30_000) return null;
  return {
    type: "output_heavy",
    severity: out >= 80_000 ? "high" : "medium",
    title: `Generated ${Math.round(out / 1000)}k output tokens`,
    explanation:
      "This run produced a large amount of model output. Output tokens are the most expensive kind, and high output often means verbose explanations or regenerating large files wholesale.",
    suggestedFix:
      "Ask for concise responses and targeted edits; avoid rewriting whole files when a small edit will do.",
    count: out,
  };
};

// 9. Many new files created.
const fileSprawl: Detector = (ctx) => {
  if (ctx.files.newFiles < 6) return null;
  return {
    type: "file_sprawl",
    severity: ctx.files.newFiles >= 12 ? "high" : "medium",
    title: `Created ${ctx.files.newFiles} new files`,
    explanation:
      "A run that creates many new files often indicates over-engineering or duplicated abstractions instead of editing what already exists.",
    suggestedFix:
      "Add a rule: prefer editing existing files over creating new ones; search before creating a new component or helper.",
    count: ctx.files.newFiles,
  };
};

const DETECTORS: Detector[] = [
  repeatedReads,
  lockfileReads,
  generatedReads,
  repeatedCommands,
  dependencyChanges,
  generatedChanges,
  bigDiffSmallPrompt,
  hugeFileRead,
  hugeToolOutput,
  editChurn,
  outputHeavy,
  fileSprawl,
];

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function runDetectors(ctx: DetectorContext): Finding[] {
  const findings: Finding[] = [];
  for (const d of DETECTORS) {
    try {
      const f = d(ctx);
      if (f) findings.push(f);
    } catch {
      // A detector must never break the report.
    }
  }
  findings.sort((a, b) => {
    const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (s !== 0) return s;
    return (b.count || 0) - (a.count || 0);
  });
  return findings;
}
