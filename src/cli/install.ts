// `agent-tab install` / `uninstall` — manage Claude Code and Codex hooks.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { projectRoot } from "../core/paths";
import { c } from "../core/util";

const MARKER = "agent-tab";

interface HookCmd {
  type: "command";
  command: string;
  timeout?: number;
}
interface HookEntry {
  matcher?: string;
  hooks: HookCmd[];
}
type Settings = Record<string, unknown> & { hooks?: Record<string, HookEntry[]> };

interface AgentSpec {
  tool: string;
  /** Events that take a tool-name matcher. */
  toolEvents: string[];
  /** Events with no matcher. */
  lifecycleEvents: string[];
  /** Matcher value for tool events ("*" for Claude, ".*" regex for Codex). */
  matcher: string;
}

const CLAUDE: AgentSpec = {
  tool: "claude-code",
  toolEvents: ["PreToolUse", "PostToolUse"],
  lifecycleEvents: ["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"],
  matcher: "*",
};

// Codex mirrors Claude's hook structure but has no SessionEnd, and matchers are regex.
const CODEX: AgentSpec = {
  tool: "codex",
  toolEvents: ["PreToolUse", "PostToolUse"],
  lifecycleEvents: ["SessionStart", "UserPromptSubmit", "Stop"],
  matcher: ".*",
};

function hookCommand(tool: string): string {
  // dist/cli/install.js -> package root is two levels up.
  const pkgRoot = path.resolve(__dirname, "..", "..");
  const binPath = path.join(pkgRoot, "bin", "agent-tab.js");
  return `"${process.execPath}" "${binPath}" hook --tool ${tool}`;
}

function isAgentTabEntry(entry: HookEntry): boolean {
  return (entry.hooks || []).some(
    (h) => typeof h.command === "string" && h.command.includes(MARKER),
  );
}

function readSettings(file: string): Settings {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Settings;
  } catch {
    return {};
  }
}

export interface InstallOpts {
  global?: boolean;
  local?: boolean;
  codex?: boolean;
  print?: boolean;
}

export function parseInstallOpts(argv: string[]): InstallOpts {
  return {
    global: argv.includes("--global"),
    local: argv.includes("--local"),
    codex: argv.includes("--codex"),
    print: argv.includes("--print") || argv.includes("--dry-run"),
  };
}

function settingsTarget(opts: InstallOpts): string {
  if (opts.codex) {
    return opts.global
      ? path.join(os.homedir(), ".codex", "hooks.json")
      : path.join(projectRoot(), ".codex", "hooks.json");
  }
  if (opts.global) return path.join(os.homedir(), ".claude", "settings.json");
  const dir = path.join(projectRoot(), ".claude");
  return path.join(dir, opts.local ? "settings.local.json" : "settings.json");
}

function buildHooks(spec: AgentSpec, existing: Record<string, HookEntry[]>): Record<string, HookEntry[]> {
  const cmd = hookCommand(spec.tool);
  const hooks: Record<string, HookEntry[]> = { ...existing };
  const addEntry = (event: string, entry: HookEntry): void => {
    const kept = (hooks[event] || []).filter((e) => !isAgentTabEntry(e));
    kept.push(entry);
    hooks[event] = kept;
  };
  for (const event of spec.toolEvents) {
    addEntry(event, {
      matcher: spec.matcher,
      hooks: [{ type: "command", command: cmd, timeout: 10 }],
    });
  }
  for (const event of spec.lifecycleEvents) {
    addEntry(event, { hooks: [{ type: "command", command: cmd, timeout: 10 }] });
  }
  return hooks;
}

export function runInstall(argv: string[]): number {
  const opts = parseInstallOpts(argv);
  const spec = opts.codex ? CODEX : CLAUDE;
  const target = settingsTarget(opts);

  const settings = readSettings(target);
  settings.hooks = buildHooks(spec, settings.hooks || {});

  if (opts.print) {
    process.stdout.write(JSON.stringify(settings, null, 2) + "\n");
    process.stdout.write(c.dim(`\n(dry run — would write to ${target})\n`));
    return 0;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(settings, null, 2) + "\n");
  ensureGitignore();
  printInstalled(spec, target);
  return 0;
}

export function runUninstall(argv: string[]): number {
  const opts = parseInstallOpts(argv);
  // Remove from every place we might have installed.
  const targets = opts.codex
    ? [settingsTarget({ codex: true }), settingsTarget({ codex: true, global: true })]
    : [
        settingsTarget({}),
        settingsTarget({ local: true }),
        settingsTarget({ global: true }),
        settingsTarget({ codex: true }),
        settingsTarget({ codex: true, global: true }),
      ];

  let removed = 0;
  let touched = 0;
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    const settings = readSettings(target);
    const hooks = settings.hooks || {};
    let local = 0;
    for (const event of Object.keys(hooks)) {
      const before = hooks[event].length;
      hooks[event] = hooks[event].filter((e) => !isAgentTabEntry(e));
      local += before - hooks[event].length;
      if (hooks[event].length === 0) delete hooks[event];
    }
    if (local === 0) continue;
    removed += local;
    touched += 1;
    if (Object.keys(hooks).length === 0) delete settings.hooks;
    else settings.hooks = hooks;
    fs.writeFileSync(target, JSON.stringify(settings, null, 2) + "\n");
  }
  process.stdout.write(
    removed > 0
      ? c.green(`Removed ${removed} agent-tab hook${removed === 1 ? "" : "s"} from ${touched} file${touched === 1 ? "" : "s"}\n`)
      : c.dim("No agent-tab hooks found to remove.\n"),
  );
  return 0;
}

function ensureGitignore(): void {
  try {
    const gi = path.join(projectRoot(), ".gitignore");
    let content = "";
    try {
      content = fs.readFileSync(gi, "utf8");
    } catch {
      /* no file yet */
    }
    if (!/^\.agent-tab\/?\s*$/m.test(content)) {
      const prefix = content && !content.endsWith("\n") ? "\n" : "";
      fs.appendFileSync(gi, `${prefix}.agent-tab/\n`);
    }
  } catch {
    /* best effort */
  }
}

function printInstalled(spec: AgentSpec, target: string): void {
  const L: string[] = [];
  const name = spec.tool === "codex" ? "Codex" : "Claude Code";
  L.push("");
  L.push(c.green(c.bold(`  ✓ Agent Tab installed for ${name}`)));
  L.push("");
  L.push(`  Hooks added to ${c.cyan(target)}`);
  L.push(
    c.dim(
      "  Events: " + [...spec.toolEvents, ...spec.lifecycleEvents].join(", "),
    ),
  );
  L.push("");
  if (spec.tool === "codex") {
    L.push(c.yellow("  ⚠ Codex skips new command hooks until you trust them."));
    L.push(c.dim("    Run /hooks inside Codex to trust them (or use --dangerously-bypass-hook-trust)."));
    L.push("");
  }
  L.push("  Next:");
  L.push(`    1. Run ${name} as usual in this project`);
  L.push(`    2. After it works, run  ${c.bold("npx agent-tab report")}`);
  L.push(`    3. Turn waste into rules:  ${c.bold("npx agent-tab fix")}`);
  L.push("");
  L.push(c.dim(`  Uninstall anytime with  npx agent-tab uninstall${spec.tool === "codex" ? " --codex" : ""}`));
  L.push("");
  process.stdout.write(L.join("\n"));
}
