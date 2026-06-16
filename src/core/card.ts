// Render a RunReport as a shareable SVG card (zero dependencies).
// SVG keeps `bartab share` dependency-free and converts cleanly to PNG later.

import type { RunReport } from "./types";
import { fmtInt, fmtTokens, fmtUsd, oneLine, toolLabel } from "./util";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreHex(score: number): string {
  if (score >= 75) return "#ff5c5c";
  if (score >= 45) return "#f5b042";
  return "#3ecf8e";
}

export function renderCardSvg(r: RunReport): string {
  const W = 720;
  const H = 460;
  const accent = scoreHex(r.bloatScore);
  const totalInput =
    r.tokens.inputTokens +
    r.tokens.cacheReadTokens +
    r.tokens.cacheWrite5mTokens +
    r.tokens.cacheWrite1hTokens;

  const top = r.findings[0];
  const wasteTitle = top ? top.title : "Clean run — no obvious waste";
  const fixText = top ? top.suggestedFix : "Nothing to fix. Nice.";

  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const sans =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  const stat = (x: number, value: string, label: string): string =>
    `<text x="${x}" y="196" font-family="${mono}" font-size="30" font-weight="700" fill="#e8eaed">${esc(value)}</text>` +
    `<text x="${x}" y="220" font-family="${sans}" font-size="14" fill="#9aa0a6">${esc(label)}</text>`;

  // Gauge geometry
  const gx = 600;
  const gy = 96;
  const gr = 46;
  const circ = 2 * Math.PI * gr;
  const dash = (r.bloatScore / 100) * circ;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${sans}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16181d"/>
      <stop offset="1" stop-color="#0d0f12"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="20" fill="url(#bg)"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="none" stroke="#2a2d34" stroke-width="1"/>

  <!-- header -->
  <text x="40" y="58" font-size="22" font-weight="800" fill="#e8eaed">BarTab</text>
  <text x="40" y="80" font-size="14" fill="#9aa0a6">${esc(toolLabel(r.tool))} run receipt</text>

  <!-- headline cost -->
  <text x="40" y="140" font-family="${mono}" font-size="52" font-weight="800" fill="${accent}">${esc(fmtUsd(r.cost.usd))}</text>
  <text x="42" y="164" font-size="14" fill="#9aa0a6">estimated run cost</text>

  <!-- bloat gauge -->
  <circle cx="${gx}" cy="${gy}" r="${gr}" fill="none" stroke="#2a2d34" stroke-width="10"/>
  <circle cx="${gx}" cy="${gy}" r="${gr}" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round"
    stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${gx} ${gy})"/>
  <text x="${gx}" y="${gy - 2}" text-anchor="middle" font-family="${mono}" font-size="30" font-weight="800" fill="#e8eaed">${r.bloatScore}</text>
  <text x="${gx}" y="${gy + 18}" text-anchor="middle" font-size="12" fill="#9aa0a6">bloat</text>

  <!-- divider -->
  <line x1="40" y1="232" x2="${W - 40}" y2="232" stroke="#2a2d34" stroke-width="1"/>

  <!-- stats row -->
  ${stat(40, fmtTokens(totalInput), "input tokens")}
  ${stat(190, fmtTokens(r.tokens.outputTokens), "output tokens")}
  ${stat(340, String(r.files.filesTouched), "files")}
  ${stat(440, "+" + fmtInt(r.files.linesAdded), "lines added")}
  ${stat(600, String(r.commandsRun), "commands")}

  <!-- biggest waste -->
  <text x="40" y="296" font-size="13" font-weight="700" fill="#9aa0a6" letter-spacing="1">BIGGEST WASTE</text>
  <text x="40" y="324" font-size="19" font-weight="700" fill="#f5b042">${esc(oneLine(wasteTitle, 60))}</text>

  <!-- fix -->
  <rect x="40" y="346" width="${W - 80}" height="74" rx="12" fill="#11261c" stroke="#1f4733" stroke-width="1"/>
  <text x="58" y="374" font-size="13" font-weight="700" fill="#3ecf8e" letter-spacing="1">FIX</text>
  <text x="58" y="398" font-size="15" fill="#cfe9dd">${esc(oneLine(fixText, 64))}</text>

  <text x="${W - 40}" y="${H - 18}" text-anchor="end" font-size="12" fill="#5f6671">npx bartab</text>
</svg>`;
}
