// A tiny global registry of projects that have openbar data. Because hooks fire in
// every directory (global install), `report`/`summary` are per-project and it's easy to
// run them from the wrong place. The registry lets those commands point you at where
// your data actually is. Stored at ~/.openbar/projects.json. Never throws.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { projectRoot, runsDir } from "./paths";

export interface ProjectEntry {
  path: string;
  lastSeen: string;
}

export function globalDir(): string {
  return process.env.OPENBAR_HOME || path.join(os.homedir(), ".openbar");
}

function registryPath(): string {
  return path.join(globalDir(), "projects.json");
}

function read(): ProjectEntry[] {
  try {
    const raw = fs.readFileSync(registryPath(), "utf8");
    const obj = JSON.parse(raw);
    if (Array.isArray(obj?.projects)) return obj.projects as ProjectEntry[];
  } catch {
    /* missing or corrupt — start fresh */
  }
  return [];
}

/** Upsert the project for `cwd` into the registry. Safe to call from a hook. */
export function recordProject(cwd: string): void {
  try {
    const root = projectRoot(cwd);
    const entries = read().filter((e) => e.path !== root);
    entries.unshift({ path: root, lastSeen: new Date().toISOString() });
    const capped = entries.slice(0, 200);
    const dir = globalDir();
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write to tolerate concurrent hook processes.
    const tmp = path.join(dir, `.projects.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({ projects: capped }, null, 2));
    fs.renameSync(tmp, registryPath());
  } catch {
    /* registry is best-effort */
  }
}

/** Registered projects that still have a runs/ dir, most-recent first. */
export function listProjects(): ProjectEntry[] {
  return read()
    .filter((e) => {
      try {
        return fs.existsSync(runsDir(e.path));
      } catch {
        return false;
      }
    })
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
}
