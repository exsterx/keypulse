// Downloads the better-sqlite3 prebuilt native binary for the current
// Node/OS/arch and extracts it into node_modules/better-sqlite3/build/Release.
//
// This avoids relying on `prebuild-install` (whose download step can fail on
// some Windows setups) and does NOT require Python or a C++ compiler.
// Requires Windows 10 1803+ (curl.exe and tar.exe ship with Windows).
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function run(cmd, args, options) {
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

function main() {
  const pkgPath = path.join(__dirname, "..", "node_modules", "better-sqlite3", "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.error("better-sqlite3 is not installed. Run `npm install --ignore-scripts` first.");
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const version = pkg.version;
  const abi = process.versions.modules;
  const platform = process.platform;
  const arch = process.arch;

  const filename = `better-sqlite3-v${version}-node-v${abi}-${platform}-${arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${filename}`;
  const destDir = path.join(__dirname, "..", "node_modules", "better-sqlite3");
  const tmp = path.join(os.tmpdir(), filename);

  console.log(`Fetching native binary for better-sqlite3@${version} (abi ${abi}, ${platform}-${arch})...`);

  // Download (curl.exe handles redirects and the system proxy stack reliably).
  const curl = process.env.CURL_EXE || "curl.exe";
  run(curl, ["-L", "--fail", "--retry", "3", "-o", tmp, url]);

  console.log("Extracting prebuilt binary...");
  const tar = process.env.TAR_EXE || "tar.exe";
  run(tar, ["-xzf", tmp, "-C", destDir]);

  fs.unlinkSync(tmp);

  const binary = path.join(destDir, "build", "Release", "better_sqlite3.node");
  if (!fs.existsSync(binary)) {
    console.error("Extraction finished but the binary was not found at:", binary);
    process.exit(1);
  }
  console.log("better-sqlite3 native binary installed successfully.");
}

try {
  main();
} catch (error) {
  console.error("Failed to fetch better-sqlite3 native binary:", error.message);
  console.error(
    "Alternative: install Node.js 22 LTS and re-run `npm install`, or install " +
      "Visual Studio Build Tools + Python and run `npm install` (source build)."
  );
  process.exit(1);
}
