// Bloat score: 0 (lean) .. 100 (egregiously wasteful).
//
// The score is a transparent, capped weighted sum. Each component has a hard ceiling
// so no single dimension can dominate, and the weights sum to 100. The goal is a
// number that's fun and roughly calibrated — not a precise metric.

import type { DerivedEvents } from "./events";
import type { FileStats } from "./types";

export interface ScoreInput {
  files: FileStats;
  derived: DerivedEvents;
  promptChars: number;
}

export interface ScoreBreakdown {
  total: number;
  components: { label: string; points: number; max: number }[];
}

function clampAdd(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

export function bloatScore(input: ScoreInput): ScoreBreakdown {
  const { files, derived, promptChars } = input;

  // Sum of (count - 1) over files read more than once = "wasted" re-reads.
  const repeatedReadWaste = derived.readCounts.reduce(
    (s, r) => s + Math.max(0, r.count - 1),
    0,
  );
  const repeatedCmdWaste = derived.bashCounts.reduce(
    (s, b) => s + Math.max(0, b.count - 1),
    0,
  );

  // Big-diff-for-small-prompt factor.
  const promptWeight = (() => {
    if (promptChars >= 200 || files.linesAdded < 80) return 0;
    const shortness = (200 - promptChars) / 200; // 0..1
    const bigness = Math.min(1, files.linesAdded / 500); // 0..1
    return 10 * shortness * bigness;
  })();

  const components = [
    { label: "files touched", points: clampAdd(files.filesTouched * 1.2, 18), max: 18 },
    { label: "lines added", points: clampAdd(files.linesAdded / 45, 14), max: 14 },
    { label: "repeated reads", points: clampAdd(repeatedReadWaste * 4, 20), max: 20 },
    {
      label: "retries / failures",
      points: clampAdd(derived.failures * 4 + repeatedCmdWaste * 2, 16),
      max: 16,
    },
    {
      label: "dependency changes",
      points: clampAdd(files.dependencyFilesChanged.length * 5, 10),
      max: 10,
    },
    {
      label: "generated-file changes",
      points: clampAdd(files.generatedFilesChanged.length * 4, 12),
      max: 12,
    },
    { label: "prompt vs diff", points: clampAdd(promptWeight, 10), max: 10 },
  ];

  const total = Math.round(components.reduce((s, c) => s + c.points, 0));
  return { total: Math.max(0, Math.min(100, total)), components };
}
