# Contributing to Agent Tab

Thanks for helping. Agent Tab is a small, dependency-light TypeScript CLI, so the loop
is fast.

## Setup

```bash
git clone https://github.com/doramirdor/agent-tab
cd agent-tab
npm install        # also builds via the `prepare` script
npm run build      # compile src/ -> dist/
npm test           # end-to-end smoke tests (Claude Code + Codex)
```

Requires Node ≥ 22.5 (the tests and history use the built-in `node:sqlite`).

## Project layout

```
src/
  core/      pure logic — no CLI concerns
    pricing.ts      per-model rates + cost math
    transcript.ts   Claude Code transcript parser (token usage)
    codex.ts        Codex rollout parser (token usage)
    git.ts          working-tree snapshots + diff stats
    events.ts       derive reads/commands/edits from the event log
    detectors.ts    waste detectors -> findings
    scoring.ts      the bloat score
    receipt.ts      terminal receipt renderer
    card.ts         shareable SVG card
    storage.ts      optional node:sqlite history
    analyze.ts      orchestration: events + transcript -> RunReport
  cli/       one file per command (install, hook, report, summary, share, fix)
bin/agent-tab.js     launcher
scripts/             end-to-end tests
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow.

## How to...

**Add a waste detector.** Add a `Detector` function in `src/core/detectors.ts`, register
it in the `DETECTORS` array, and add a canonical rule for its `type` in
`src/cli/fix.ts` (`CANONICAL`). If it needs new derived data, extend
`DerivedEvents` in `src/core/events.ts`. Add an assertion in `scripts/e2e.js`.

**Adjust the bloat score.** Edit the capped components in `src/core/scoring.ts`. Keep
the weights summing to 100 and each dimension capped.

**Update pricing.** Edit the `RATES` table in `src/core/pricing.ts`. Mark a rate
`exact: true` only when you've verified it against the provider's pricing page —
otherwise leave it `false` so the receipt surfaces the "approximate pricing" note. We
never show false precision.

## Debugging hooks

Hooks write nothing to stdout by design (agents can inject hook stdout into the model).
To see what the collector is doing, set `AGENT_TAB_DEBUG=1` — it appends to
`.agent-tab/agent-tab.log`.

## Pull requests

- Run `npm run build && npm test` before pushing; CI runs both on Node 22 and 24.
- Match the surrounding style (2-space indent, no runtime dependencies in `core`/`cli`).
- Keep `core/` free of process/CLI concerns; put I/O and argument parsing in `cli/`.
- Update `CHANGELOG.md` under `[Unreleased]`.

By contributing you agree your work is licensed under the project's [MIT License](LICENSE).
