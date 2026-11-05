// Copies the compiled engine (dist/) into desktop/dist so the Electron app is
// self-contained: its requires resolve against desktop/node_modules (where
// better-sqlite3 is rebuilt for Electron's ABI).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "dist");
const dest = path.join(__dirname, "..", "desktop", "dist");

if (!fs.existsSync(src)) {
  console.error("dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Copied dist -> desktop/dist");
