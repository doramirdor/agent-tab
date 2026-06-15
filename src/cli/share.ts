// `agent-tab share` — render a shareable card for a session (SVG, PNG, or HTML).

import * as fs from "fs";
import * as path from "path";
import { analyze, loadEvents } from "../core/analyze";
import { renderCardSvg } from "../core/card";
import { latestSessionId, receiptsDir, sessionJsonlPath } from "../core/paths";
import { c } from "../core/util";

export function runShare(argv: string[]): number {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.find((a) => !a.startsWith("-"));
  const sessionId = get("--session") || positional || latestSessionId();
  const outFlag = get("--out");
  const wantPng = argv.includes("--png");
  const wantHtml = argv.includes("--html");

  if (!sessionId) {
    process.stderr.write(c.yellow("No runs found to share yet.\n"));
    return 1;
  }
  const jsonlPath = sessionJsonlPath(sessionId);
  if (!fs.existsSync(jsonlPath)) {
    process.stderr.write(c.red(`No event log for session ${sessionId}\n`));
    return 1;
  }

  const report = analyze(loadEvents(jsonlPath), { sessionId });
  const svg = renderCardSvg(report);
  const dir = receiptsDir();
  fs.mkdirSync(dir, { recursive: true });

  if (wantPng) {
    const png = svgToPng(svg);
    if (png) {
      const out = outFlag || path.join(dir, `${sessionId}.png`);
      fs.writeFileSync(out, png);
      process.stdout.write(
        c.green("  ✓ PNG receipt saved\n") + `  ${c.cyan(out)}\n`,
      );
      return 0;
    }
    // Fall back to a browser-based PNG export.
    const htmlPath = outFlag || path.join(dir, `${sessionId}.html`);
    fs.writeFileSync(htmlPath, htmlWrapper(svg, sessionId));
    process.stdout.write(
      c.yellow("  Native PNG rasterizer not installed.\n") +
        c.dim("  For direct PNG:  npm i -D @resvg/resvg-js  then re-run.\n\n") +
        c.green("  ✓ Wrote a browser PNG exporter instead\n") +
        `  ${c.cyan(htmlPath)}\n` +
        c.dim('  Open it and click "Download PNG".\n'),
    );
    return 0;
  }

  if (wantHtml) {
    const htmlPath = outFlag || path.join(dir, `${sessionId}.html`);
    fs.writeFileSync(htmlPath, htmlWrapper(svg, sessionId));
    process.stdout.write(
      c.green("  ✓ HTML receipt saved\n") + `  ${c.cyan(htmlPath)}\n`,
    );
    return 0;
  }

  const outPath = outFlag || path.join(dir, `${sessionId}.svg`);
  fs.writeFileSync(outPath, svg);
  process.stdout.write(
    c.green("  ✓ Receipt card saved\n") +
      `  ${c.cyan(outPath)}\n` +
      c.dim("  Post the SVG, or run  agent-tab share --png  for a PNG.\n"),
  );
  return 0;
}

/** Rasterize via the optional @resvg/resvg-js dependency. Returns null if absent. */
function svgToPng(svg: string): Buffer | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resvg } = require("@resvg/resvg-js");
    const r = new Resvg(svg, { fitTo: { mode: "width", value: 1440 } });
    return Buffer.from(r.render().asPng());
  } catch {
    return null;
  }
}

/** A self-contained page that renders the SVG and exports a PNG client-side. */
function htmlWrapper(svg: string, sessionId: string): string {
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Agent Tab receipt</title>
<style>
  body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0b0c0e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  img{max-width:90vw;height:auto;border-radius:20px}
  button{padding:10px 18px;border-radius:10px;border:1px solid #2a2d34;background:#16181d;color:#e8eaed;font-size:14px;cursor:pointer}
  button:hover{background:#1f2228}
</style></head><body>
<img id="card" alt="Agent Tab receipt" src="data:image/svg+xml;base64,${b64}">
<button id="dl">Download PNG</button>
<script>
  const img=document.getElementById('card');
  document.getElementById('dl').onclick=function(){
    const scale=2,c=document.createElement('canvas');
    c.width=720*scale;c.height=460*scale;
    const ctx=c.getContext('2d');ctx.scale(scale,scale);ctx.drawImage(img,0,0,720,460);
    const a=document.createElement('a');a.download=${JSON.stringify(sessionId + ".png")};
    a.href=c.toDataURL('image/png');a.click();
  };
</script>
</body></html>`;
}
