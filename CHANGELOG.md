# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Global project registry (`~/.agent-tab/projects.json`, override with `AGENT_TAB_HOME`).
  Hooks record each project on lifecycle events so commands can find your data.

### Changed
- `report` no longer prints a misleading all-zeros receipt when run outside a project.
  If the current project has no usable session, it explains that `report` is
  per-project and lists your recent agent-tab projects to `cd` into.
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
  to `.agent-tab/runs/<session>.jsonl`. Wrapped to never block or slow the agent.
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
- Opt-in debug logging (`AGENT_TAB_DEBUG=1` → `.agent-tab/agent-tab.log`).

[Unreleased]: https://github.com/doramirdor/agent-tab/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/doramirdor/agent-tab/releases/tag/v0.1.0
