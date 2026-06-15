#!/usr/bin/env node
// Thin launcher. Keeps the shebang out of the TypeScript sources (tsc rejects it)
// and gives hooks a stable absolute entrypoint to call.
"use strict";

let cli;
try {
  cli = require("../dist/cli/index.js");
} catch (err) {
  process.stderr.write(
    "agent-tab: build output missing. Run `npm run build` in the agent-tab package.\n" +
      String((err && err.message) || err) +
      "\n",
  );
  process.exit(1);
}

cli.main(process.argv.slice(2)).then(
  (code) => process.exit(typeof code === "number" ? code : 0),
  (err) => {
    process.stderr.write("agent-tab: " + String((err && err.stack) || err) + "\n");
    process.exit(1);
  },
);
