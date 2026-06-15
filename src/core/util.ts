// Tiny zero-dependency helpers (formatting + ANSI colors).

const enabledColor = (): boolean => {
  if (process.env.NO_COLOR) return false;
  if (process.env.AGENT_TAB_NO_COLOR) return false;
  return Boolean(process.stdout && process.stdout.isTTY);
};

const wrap = (open: number, close: number) => (s: string): string =>
  enabledColor() ? `[${open}m${s}[${close}m` : s;

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};

/** Compact token count: 213000 -> "213k". */
export function fmtTokens(n: number): string {
  if (!isFinite(n)) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(Math.round(n));
}

export function fmtUsd(n: number): string {
  if (n >= 100) return "$" + n.toFixed(0);
  if (n >= 1) return "$" + n.toFixed(2);
  if (n >= 0.01) return "$" + n.toFixed(2);
  return "$" + n.toFixed(3);
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Collapse whitespace and clamp to maxLen for one-line display. */
export function oneLine(s: string, maxLen = 80): string {
  const flat = (s || "").replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, Math.max(0, maxLen - 1)) + "…";
}

/** Human label for a tool id. */
export function toolLabel(tool: string | undefined): string {
  if (tool === "codex") return "Codex";
  if (tool === "claude-code" || !tool) return "Claude Code";
  return tool;
}

export function countLines(s: string | undefined | null): number {
  if (!s) return 0;
  // Count newlines + 1 for the trailing segment when non-empty.
  const n = (s.match(/\n/g) || []).length;
  return s.length > 0 ? n + 1 : 0;
}
