# Architecture

OpenBar turns an agent run into a receipt. The pipeline:

```
Claude Code / Codex
   │  lifecycle hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, …)
   ▼
openbar hook            collect — append one compact JSON line per event
   │                      .openbar/runs/<session>.jsonl
   ▼
analyze()                 orchestrate
   ├── transcript.ts / codex.ts   real token usage (deduped by request id)
   ├── git.ts / events.ts         file changes (git delta, or tool events)
   ├── detectors.ts               waste findings
   ├── scoring.ts                 bloat score
   └── pricing.ts                 per-model cost
   ▼
RunReport ──► receipt.ts (terminal)
          ──► card.ts (SVG/PNG/HTML share card)
          ──► fix.ts (CLAUDE.md / AGENTS.md rules)
          ──► storage.ts (SQLite history + summary)
```

## Collection (the hook)

`install` registers `openbar hook --tool <claude-code|codex>` at each lifecycle point.
On every event the hook reads the payload from **stdin**, normalizes it, and appends a
line to `.openbar/runs/<session_id>.jsonl`. It:

- never writes to **stdout** (agents can inject hook stdout into the model) and always
  exits 0 (a hook must never block the agent);
- trims tool inputs — large strings (file contents) are reduced to size/line metrics so
  the log stays small;
- captures a `git` working-tree snapshot only on lifecycle boundaries
  (`SessionStart` / `Stop` / `SessionEnd`), keeping per-tool hooks fast.

JSONL append is used (not a live DB) so concurrent short-lived hook processes can't lock
each other.

## Token usage (the accurate part)

Token counts come from the agent's own transcript, not estimates.

- **Claude Code** (`transcript.ts`): each assistant API response is written as multiple
  transcript lines (one per content block) that **all repeat the same `message.usage`**.
  We dedupe by `requestId` so usage is counted once per request, and read the
  `cache_creation.ephemeral_5m/1h` split for exact cache-write pricing.
- **Codex** (`codex.ts`): usage lives in the rollout's `token_count` lines
  (`info.total_token_usage`, cumulative — we take the last). OpenAI's `input_tokens`
  *includes* cached tokens, so we store `inputTokens = input − cached` and
  `cacheReadTokens = cached` to match the shared cost model.

Cost (`pricing.ts`) is per-model with cache multipliers (read ×0.10, write-5m ×1.25,
write-1h ×2.0). It's always labeled **estimated**; rates verified against a provider's
pricing page are `exact: true`, everything else is flagged approximate.

## File changes

`git.ts` diffs a baseline snapshot (session start) against the latest one and subtracts,
so a repo that was already dirty doesn't inflate the numbers. When there's no git repo,
`events.ts` reconstructs file stats from `Write`/`Edit`/`MultiEdit` events instead.

## Detectors and score

`detectors.ts` holds independent `Detector` functions (repeated reads, lockfile reads,
failing-command loops, dependency changes, huge reads, edit churn, …); each returns a
finding with a concrete fix. `scoring.ts` produces a transparent 0–100 bloat score as a
capped weighted sum (each dimension has a hard ceiling, weights sum to 100).

## Storage

`storage.ts` uses the built-in `node:sqlite`. It persists `runs`, `file_changes`, and
`findings` for `report --history` and `summary`. If `node:sqlite` is unavailable, every
storage call is a no-op and single-run receipts still work.

## Design constraints

- **Zero required runtime dependencies** (PNG export uses an optional rasterizer).
- `core/` is pure logic; `cli/` owns process/argv/I-O.
- Every hook path is wrapped so the collector can't break a run.
