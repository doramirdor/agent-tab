// Model pricing for cost estimation.
//
// Rates are USD per 1,000,000 tokens. Current-model rates are verified against the
// claude-api reference (cached 2026-05-26). Cache pricing follows Anthropic's
// standard multipliers relative to the base input rate:
//   - cache read      = 0.10x input
//   - cache write 5m  = 1.25x input
//   - cache write 1h  = 2.00x input
//
// We intentionally do NOT hardcode a single number per model into the receipt; the
// receipt always labels cost as "estimated" because (a) some legacy model rates are
// approximate and (b) we cannot perfectly attribute Batch/discount tiers.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ModelUsage } from "./types";

export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_5M_MULT = 1.25;
export const CACHE_WRITE_1H_MULT = 2.0;

export interface Rate {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** Whether this rate is exact (verified) vs. approximate. */
  exact: boolean;
}

// Keyed by a normalized model-id prefix. Longest-prefix match wins.
const RATES: Record<string, Rate> = {
  // Current (verified)
  "claude-fable-5": { input: 10, output: 50, exact: true },
  "claude-opus-4-8": { input: 5, output: 25, exact: true },
  "claude-opus-4-7": { input: 5, output: 25, exact: true },
  "claude-opus-4-6": { input: 5, output: 25, exact: true },
  "claude-sonnet-4-6": { input: 3, output: 15, exact: true },
  "claude-haiku-4-5": { input: 1, output: 5, exact: true },
  // Legacy still-active (approximate)
  "claude-opus-4-5": { input: 5, output: 25, exact: false },
  "claude-opus-4-1": { input: 15, output: 75, exact: false },
  "claude-opus-4": { input: 15, output: 75, exact: false },
  "claude-sonnet-4-5": { input: 3, output: 15, exact: false },
  "claude-sonnet-4": { input: 3, output: 15, exact: false },
  "claude-3-7-sonnet": { input: 3, output: 15, exact: false },
  "claude-3-5-haiku": { input: 0.8, output: 4, exact: false },
  "claude-3-haiku": { input: 0.25, output: 1.25, exact: false },

  // OpenAI / Codex models (approximate — update from openai.com/api/pricing).
  // All flagged exact:false so the receipt surfaces the "approximate pricing" note.
  "gpt-5-codex": { input: 1.25, output: 10, exact: false },
  "gpt-5-mini": { input: 0.25, output: 2, exact: false },
  "gpt-5-nano": { input: 0.05, output: 0.4, exact: false },
  "gpt-5": { input: 1.25, output: 10, exact: false },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, exact: false },
  "gpt-4.1": { input: 2, output: 8, exact: false },
  "o4-mini": { input: 1.1, output: 4.4, exact: false },
  "o3-mini": { input: 1.1, output: 4.4, exact: false },
  "o3": { input: 2, output: 8, exact: false },
};

const FALLBACK: Rate = { input: 5, output: 25, exact: false };

function normalize(model: string): string {
  return (model || "").trim().toLowerCase();
}

// User-supplied rate overrides, read once from ~/.openbar/pricing.json (or
// $OPENBAR_HOME/pricing.json). Lets users set exact, negotiated, or Batch (50%-off)
// rates, or add a brand-new model, without touching source. Local-first: no network.
// Shape: { "claude-opus-4-8": { "input": 5, "output": 25 }, "my-model": {...} }
// User-provided rates are treated as exact (no "approximate pricing" note).
let overridesCache: Record<string, Rate> | null = null;
function overrides(): Record<string, Rate> {
  if (overridesCache) return overridesCache;
  overridesCache = {};
  try {
    const dir = process.env.OPENBAR_HOME || path.join(os.homedir(), ".openbar");
    const raw = fs.readFileSync(path.join(dir, "pricing.json"), "utf8");
    const obj = JSON.parse(raw) as Record<string, { input?: unknown; output?: unknown }>;
    for (const [model, v] of Object.entries(obj)) {
      if (v && typeof v.input === "number" && typeof v.output === "number") {
        overridesCache[normalize(model)] = { input: v.input, output: v.output, exact: true };
      }
    }
  } catch {
    // No override file (the common case) — use the built-in table.
  }
  return overridesCache;
}

function longestPrefix(id: string, table: Record<string, Rate>): Rate | null {
  let best: { key: string; rate: Rate } | null = null;
  for (const key of Object.keys(table)) {
    if (id.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, rate: table[key] };
    }
  }
  return best ? best.rate : null;
}

/** Resolve a model id (possibly date-suffixed) to a rate. User overrides win. */
export function rateFor(model: string): Rate {
  const id = normalize(model);
  return longestPrefix(id, overrides()) || longestPrefix(id, RATES) || FALLBACK;
}

/** Test seam: clear the cached override file. */
export function _resetOverrides(): void {
  overridesCache = null;
}

export interface CostResult {
  usd: number;
  /** True if any model used the fallback or an approximate rate. */
  hasUnknownModel: boolean;
}

/** Compute total cost across per-model usage buckets. */
export function costForUsage(byModel: ModelUsage[]): CostResult {
  let usd = 0;
  let hasUnknownModel = false;
  for (const m of byModel) {
    const r = rateFor(m.model);
    if (!r.exact) hasUnknownModel = true;
    const perMillion =
      m.inputTokens * r.input +
      m.outputTokens * r.output +
      m.cacheReadTokens * r.input * CACHE_READ_MULT +
      m.cacheWrite5mTokens * r.input * CACHE_WRITE_5M_MULT +
      m.cacheWrite1hTokens * r.input * CACHE_WRITE_1H_MULT;
    usd += perMillion / 1_000_000;
  }
  return { usd, hasUnknownModel };
}
