#!/usr/bin/env node
// Runs every JavaScript test in tests/js with Node's built-in test runner:
//
//   node tests/run-js-tests.mjs          (or: npm test)
//
// Works the same on Windows, macOS and Linux and on Node 18 and later. It lists the *.test.mjs files itself
// instead of relying on the shell to expand a wildcard (Windows shells do not) or on how a particular Node
// version reads `node --test <folder>` (newer versions treat the argument as a glob pattern, so a bare folder
// can find no tests). Extra arguments are passed on to node --test, e.g. --test-name-pattern="demo".
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = readdirSync(new URL("./js/", import.meta.url))
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => `tests/js/${f}`); // relative, forward slashes: a plain path is also a valid glob on every OS

if (!files.length) {
  console.error("No tests found in tests/js (expected *.test.mjs files).");
  process.exit(1);
}

const run = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { cwd: root, stdio: "inherit" });
if (run.error) { console.error(run.error.message); process.exit(1); }
process.exit(run.status ?? 1);
