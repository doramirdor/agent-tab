# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] — 2026-06-17

### Changed
- `openbar fix` now **aggregates findings across your recent sessions** (configurable
  with `--last n`, default 15) instead of only the latest run — so recurring waste wins
  over a single, possibly-clean session. The managed block notes how many sessions it
  drew from. Pass `--session <id>` for the old single-run behavior. (Found by dogfooding:
  `fix` was defaulting to the latest session, which was sometimes clean, producing only
  generic rules.)

### Fixed
- `install` no longer overwrites a settings file that exists but isn't valid JSON.
  Previously a malformed `.claude/settings.json` (e.g. a stray trailing comma) was
  silently treated as empty, so install would clobber the user's entire config —
  including the global `~/.claude/settings.json`. Install now aborts with an
  actionable message and leaves the file untouched; `uninstall` skips unparseable
  files instead of rewriting them.

### Added
- Global project registry (`~/.openbar/projects.json`, override with `OPENBAR_HOME`).
  Hooks record each project on lifecycle events so commands can find your data.
- Local pricing override: drop a `~/.openbar/pricing.json` (e.g.
  `{ "claude-opus-4-8": { "input": 5, "output": 25 } }`) to set exact, negotiated, or
  Batch (50%-off) rates, or price a new model — without editing source, no network.
  User-provided rates are treated as exact.

### Changed
- The receipt no longer truncates the biggest-waste explanation/fix with `…` — it
wraps the full text to your terminal width.
- `report` no longer prints a misleading all-zeros receipt when run outside a project.
  If the current project has no usable session, it explains that `report` is
  per-project and lists your recent openbar projects to `cd` into.
- The `output_heavy` detector is now contextual: raw output volume scales with session
  length, so it only flags output that's large *and* disproportionate to durable change
  (few files / tiny diff), and it's now low-severity. A long, productive run no longer
  gets flagged for "wasting" output tokens.
- The receipt's "Biggest waste" headline only appears for actionable (high/medium)
  findings. Clean runs say so and list any minor items under "Notes" — the headline no
  longer contradicts a low bloat score.

## [0.1.0] — 2026-06-15

First release. Local-first cost + bloat receipts for coding agents.

### Added
- `install` / `uninstall` — wire hooks into Claude Code (`.claude/settings.json`) or
  Codex (`.codex/hooks.json`, via `--codex`). Idempotent and reversible.
- `hook` — the collector. Reads a hook payload from stdin and appends a compact event
  to `.openbar/runs/<session>.jsonl`. Wrapped to never block or slow the agent.
- `report` — a per-run receipt: accurate token usage, estimated cost, file changes,
  retries, a 0–100 bloat score, and the biggest waste with a concrete fix.
- `summary` — local aggregate of recent runs (your weekly agent bill).
- `share` — a shareable card as SVG (default), PNG (`--png`, via optional
  `@resvg/resvg-js`, with a zero-dependency browser fallback), or HTML.
- `fix` — writes a managed rules block into `CLAUDE.md` / `AGENTS.md` from real findings.
- Accurate cost from the agent's own transcript/rollout, deduped by request id, with
  the 5-minute vs 1-hour cache-write split and Anthropic's cache multipliers.
- Codex support: token usage parsed from `~/.codex/sessions/.../rollout-*.jsonl`
  `token_count` lines (OpenAI's cached-input semantics handled).
- 12 waste detectors and a transparent, capped bloat score.
- Local history via the built-in `node:sqlite` (degrades gracefully when unavailable).
- Opt-in debug logging (`OPENBAR_DEBUG=1` → `.openbar/openbar.log`).

[Unreleased]: https://github.com/doramirdor/openbar/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/doramirdor/openbar/releases/tag/v0.1.0
