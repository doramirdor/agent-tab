// Optional SQLite history. Uses the built-in node:sqlite (Node >= 22.5). If it's
// unavailable, every function degrades to a no-op so receipts still render.

import * as fs from "fs";
import * as path from "path";
import type { RunReport } from "./types";

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

function openDb(dbPath: string): SqliteDb | null {
  let mod: { DatabaseSync: new (p: string) => SqliteDb };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("node:sqlite");
  } catch {
    return null;
  }
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new mod.DatabaseSync(dbPath);
    db.exec(SCHEMA);
    return db;
  } catch {
    return null;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  tool TEXT,
  repo_path TEXT,
  started_at TEXT,
  ended_at TEXT,
  model TEXT,
  estimated_input_tokens INTEGER,
  estimated_output_tokens INTEGER,
  estimated_cost_usd REAL,
  bloat_score INTEGER,
  files_touched INTEGER,
  lines_added INTEGER,
  lines_removed INTEGER,
  commands_run INTEGER,
  retries INTEGER,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS file_changes (
  run_id TEXT,
  file_path TEXT,
  added INTEGER,
  removed INTEGER,
  change_type TEXT
);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  type TEXT,
  severity TEXT,
  title TEXT,
  explanation TEXT,
  suggested_fix TEXT
);
`;

export function saveRun(dbPath: string, r: RunReport): boolean {
  const db = openDb(dbPath);
  if (!db) return false;
  try {
    db.prepare("DELETE FROM runs WHERE id = ?").run(r.sessionId);
    db.prepare("DELETE FROM file_changes WHERE run_id = ?").run(r.sessionId);
    db.prepare("DELETE FROM findings WHERE run_id = ?").run(r.sessionId);

    db.prepare(
      `INSERT INTO runs (id, tool, repo_path, started_at, ended_at, model,
        estimated_input_tokens, estimated_output_tokens, estimated_cost_usd, bloat_score,
        files_touched, lines_added, lines_removed, commands_run, retries, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      r.sessionId,
      r.tool,
      r.repoPath,
      r.startedAt || null,
      r.endedAt || null,
      r.models.join(",") || null,
      r.tokens.inputTokens + r.tokens.cacheReadTokens,
      r.tokens.outputTokens,
      r.cost.usd,
      r.bloatScore,
      r.files.filesTouched,
      r.files.linesAdded,
      r.files.linesRemoved,
      r.commandsRun,
      r.retries,
      new Date().toISOString(),
    );

    const fc = db.prepare(
      "INSERT INTO file_changes (run_id, file_path, added, removed, change_type) VALUES (?,?,?,?,?)",
    );
    for (const ch of r.files.changes) {
      fc.run(r.sessionId, ch.filePath, ch.added, ch.removed, ch.changeType);
    }

    const fd = db.prepare(
      "INSERT INTO findings (run_id, type, severity, title, explanation, suggested_fix) VALUES (?,?,?,?,?,?)",
    );
    for (const f of r.findings) {
      fd.run(r.sessionId, f.type, f.severity, f.title, f.explanation, f.suggestedFix);
    }
    return true;
  } catch {
    return false;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export interface RunRow {
  id: string;
  started_at: string | null;
  bloat_score: number | null;
  estimated_cost_usd: number | null;
  files_touched: number | null;
  lines_added: number | null;
  commands_run: number | null;
  model: string | null;
}

export function listRuns(dbPath: string, limit = 10): RunRow[] {
  const db = openDb(dbPath);
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT id, started_at, bloat_score, estimated_cost_usd, files_touched,
                lines_added, commands_run, model
         FROM runs ORDER BY COALESCE(started_at, created_at) DESC LIMIT ?`,
      )
      .all(limit) as RunRow[];
    return rows;
  } catch {
    return [];
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export interface Summary {
  runs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalFiles: number;
  totalLinesAdded: number;
  avgBloat: number;
  worst: { id: string; cost: number; bloat: number } | null;
  topFindings: { type: string; count: number }[];
  since: string | null;
}

/** Aggregate saved runs over the last `days` (0 = all time). */
export function summarize(dbPath: string, days = 7): Summary | null {
  const db = openDb(dbPath);
  if (!db) return null;
  const since =
    days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  try {
    const where = since ? "WHERE COALESCE(started_at, created_at) >= ?" : "";
    const params = since ? [since] : [];
    const agg = db
      .prepare(
        `SELECT COUNT(*) AS runs,
                COALESCE(SUM(estimated_cost_usd),0) AS cost,
                COALESCE(SUM(estimated_input_tokens),0) AS input,
                COALESCE(SUM(estimated_output_tokens),0) AS output,
                COALESCE(SUM(files_touched),0) AS files,
                COALESCE(SUM(lines_added),0) AS lines,
                COALESCE(AVG(bloat_score),0) AS bloat
         FROM runs ${where}`,
      )
      .get(...params) as Record<string, number>;

    const worstRow = db
      .prepare(
        `SELECT id, estimated_cost_usd AS cost, bloat_score AS bloat
         FROM runs ${where} ORDER BY estimated_cost_usd DESC LIMIT 1`,
      )
      .get(...params) as { id: string; cost: number; bloat: number } | undefined;

    const findingWhere = since
      ? "WHERE run_id IN (SELECT id FROM runs WHERE COALESCE(started_at, created_at) >= ?)"
      : "";
    const findings = db
      .prepare(
        `SELECT type, COUNT(*) AS count FROM findings ${findingWhere}
         GROUP BY type ORDER BY count DESC LIMIT 5`,
      )
      .all(...params) as { type: string; count: number }[];

    return {
      runs: agg.runs || 0,
      totalCostUsd: agg.cost || 0,
      totalInputTokens: agg.input || 0,
      totalOutputTokens: agg.output || 0,
      totalFiles: agg.files || 0,
      totalLinesAdded: agg.lines || 0,
      avgBloat: agg.bloat || 0,
      worst: worstRow || null,
      topFindings: findings || [],
      since,
    };
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export function sqliteAvailable(): boolean {
  try {
    require("node:sqlite");
    return true;
  } catch {
    return false;
  }
}
