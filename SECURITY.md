# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's
[private vulnerability reporting](https://github.com/doramirdor/agent-tab/security/advisories/new)
(Security → Report a vulnerability), or email **amirdor@gmail.com**.

Please don't open a public issue for a vulnerability. We'll acknowledge within a few
days and keep you updated on a fix.

## What Agent Tab touches

Agent Tab is local-first and runs on your machine:

- It **reads** your agent's transcript/rollout files (for token counts), runs `git`
  in your project (for diff stats), and reads the hook payloads your agent sends.
- It **writes** only inside `.agent-tab/` in your project, your agent settings files
  (`.claude/settings.json` / `.codex/hooks.json`) when you run `install`, and your
  `CLAUDE.md` / `AGENTS.md` when you run `fix`.
- It makes **no network requests** and requires no account, API key, or upload. Nothing
  leaves your machine.

## Scope notes

- `install` registers a hook that runs `agent-tab hook` at your agent's lifecycle points.
  The command is an absolute path to this package's launcher; inspect it any time with
  `agent-tab install --print`.
- Event logs under `.agent-tab/runs/` may contain prompt text and file paths from your
  sessions. `.agent-tab/` is added to `.gitignore` by `install`; keep it out of commits.
- Codex skips freshly written command hooks until you explicitly trust them (`/hooks`),
  which is an intentional safety boundary — Agent Tab does not bypass it for you.

## Supported versions

The latest released version receives fixes.
