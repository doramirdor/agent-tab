# OpenBar

[![CI](https://github.com/doramirdor/openbar/actions/workflows/ci.yml/badge.svg)](https://github.com/doramirdor/openbar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.5-43853d.svg)](https://nodejs.org)

**A spending tab for your coding agent.** Local-first cost + bloat receipts for Claude Code and Codex.

🌐 [doramirdor.github.io/openbar](https://doramirdor.github.io/openbar/) · 📐 [Architecture](docs/ARCHITECTURE.md) · 🤝 [Contributing](CONTRIBUTING.md) · 🔒 [Security](SECURITY.md)

```text
  OpenBar  ·  Claude Code

  $1.42 estimated run cost
  213k input tokens  (claude-opus-4-8)
  9.8k output tokens
  18 files touched  +612 -83  5 new
  27 commands run
  5 retries

  Bloat score: 87/100  █████████████████░░░

  Biggest waste:
  Re-read package-lock.json 7 times

  Fix:
  Add lockfiles to your agent ignore rules.
```

It runs entirely on your machine. No account, no upload, no API key.

## Quick start

```bash
npm i -g @amirdor/openbar   # installs the `openbar` command
openbar install             # add Claude Code hooks to this project
# ... use Claude Code as usual ...
openbar report              # print the receipt for the last run
openbar summary             # your weekly agent bill across runs
openbar fix                 # turn the biggest wastes into CLAUDE.md rules
openbar share --png         # render a shareable card
```

No global install? `npx @amirdor/openbar install`. Using Codex too? add `--codex`.

## How it works

```text
Claude Code / Codex
   │  (lifecycle hooks: SessionStart, PreToolUse, PostToolUse, Stop, …)
   ▼
openbar hook  ──►  .openbar/runs/<session>.jsonl   (append-only event log)
   │
   ▼
analyzer  ──►  transcript/rollout token usage + git diff + waste detectors
   │
   ├─►  receipt (terminal)             openbar report
   ├─►  weekly bill (terminal)         openbar summary
   ├─►  shareable card (SVG/PNG/HTML)  openbar share
   ├─►  agent rules (CLAUDE.md)        openbar fix
   └─►  history (SQLite)               openbar report --history
```

- **`install`** writes hooks into `.claude/settings.json` (or `--global` / `--local`). It's idempotent and reversible (`uninstall`).
- **`hook`** is called by Claude Code at each lifecycle point. It reads the hook JSON from stdin and appends a compact event to the per-session log. It is wrapped to never block or slow down the agent.
- **`report`** reconstructs the run: real token usage from the Claude Code transcript, file changes from `git diff` (or tool events when there's no repo), waste detectors, and a bloat score.

## Accurate cost, honestly labeled

Token counts come from the real Claude Code transcript (`message.usage`), not estimates — including the 5-minute vs 1-hour cache-write split. Cost is computed per-model with Anthropic's cache multipliers (read ×0.10, write-5m ×1.25, write-1h ×2.0).

It's still labeled **estimated** because pricing for some legacy models is approximate and discount tiers can't be detected. We never show false precision. (Note: on a Claude subscription you don't pay per token — the figure is the API-rate equivalent, a "what this would cost" signal, not an invoice.)

Rates live in a built-in table. To set exact, negotiated, or Batch (50%-off) rates — or price a model OpenBar doesn't know — drop a `~/.openbar/pricing.json`:

```json
{ "claude-opus-4-8": { "input": 5, "output": 25 }, "my-model": { "input": 2, "output": 8 } }
```

Your file wins over the defaults, stays on your machine, and its rates are treated as exact.

> One subtlety handled correctly: a single API response is written to the transcript as multiple lines (one per content block) that all repeat the same `usage`. OpenBar dedupes by request id so tokens aren't counted 3–5× over.

## Bloat score

A transparent 0–100 score (higher = more wasteful), capped per dimension so nothing dominates:

| Dimension | Max |
|---|---|
| files touched | 18 |
| lines added | 14 |
| repeated reads | 20 |
| retries / failures | 16 |
| dependency changes | 10 |
| generated-file changes | 12 |
| big diff for a tiny prompt | 10 |

## Waste detectors

Re-read files, lockfile reads, `node_modules`/`dist` reads, repeated commands, failing-test loops, dependency changes, edits to generated output, huge file reads, huge tool outputs, edit churn, output-heavy runs, file sprawl, and big-diff-for-small-prompt. Each finding carries a concrete fix.

## Codex

Codex has official hooks too, so the same flow works:

```bash
npx openbar install --codex   # writes .codex/hooks.json (--global for ~/.codex)
```

Two Codex specifics OpenBar handles for you:

- **Tokens** come from Codex's on-disk rollout (`~/.codex/sessions/.../rollout-*.jsonl`, the `token_count` lines), normalized so the shared cost math applies. OpenAI pricing is approximate and the receipt says so.
- **Trust model:** Codex skips a freshly-written command hook until you trust it — run `/hooks` inside Codex once after installing (or launch with `--dangerously-bypass-hook-trust`).

## `openbar fix`

Writes a managed block into `CLAUDE.md` (and `AGENTS.md` with `--all`), generated from what actually wasted money in your runs:

```md
<!-- openbar:start -->
## Agent cost rules

- Do not read lockfiles unless explicitly asked. Use the manifest for dependency questions.
- If the same command fails twice for the same reason, stop and explain the blocker.
- Prefer editing existing files over creating new ones.
<!-- openbar:end -->
```

The block is re-written in place on each run, so it stays current.

## Commands

| Command | Description |
|---|---|
| `openbar install [--codex] [--global\|--local] [--print]` | Add hooks to Claude Code (or Codex) |
| `openbar uninstall [--codex]` | Remove openbar hooks |
| `openbar report [session] [--json] [--history] [--transcript path] [--no-save]` | Print a receipt |
| `openbar summary [--days n\|--all] [--json]` | Aggregate recent runs (weekly bill) |
| `openbar share [session] [--png] [--html] [--out file]` | Render a shareable card |
| `openbar fix [session] [--all] [--target file] [--print]` | Write rules into CLAUDE.md / AGENTS.md |

## Requirements

- Node ≥ 22.5 (uses the built-in `node:sqlite` for history; history degrades gracefully if unavailable).
- Zero required runtime dependencies. PNG export uses the optional `@resvg/resvg-js`; without it, `share --png` writes a browser-based PNG exporter instead.

## Development

```bash
npm install      # builds via the prepare script
npm run build
npm test         # end-to-end smoke tests (Claude Code + Codex) against the compiled binary
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout and how to add a detector,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow.

## Troubleshooting

Hooks are silent by design (agents can inject hook stdout into the model). If a run isn't
showing up, set `OPENBAR_DEBUG=1` and check `.openbar/openbar.log`. Confirm the
hooks are registered with `openbar install --print`. On Codex, remember to trust the
hook via `/hooks` after installing.

## Status

V0 — Claude Code + Codex, fully local. Done: receipts, accurate per-model cost, bloat score, waste detectors, `fix` rules, SVG/PNG/HTML share cards, local history + weekly summary.

Deliberately deferred until the receipt is getting shared (per the original plan): cloud sync, team dashboard, PR comments, budget alerts, and billing. None of that is required to get value from the receipt.

## License

MIT
