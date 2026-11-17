#!/usr/bin/env node
// Builds the installation ZIP for a GitHub release from COMMITTED files only (git archive), so nothing
// untracked, ignored or local (settings, caches, .git) can end up in it:
//
//   node tools/make-release-zip.mjs v2.0.0-beta.1        -> dist/glasshome-v2.0.0-beta.1.zip
//
// The ZIP has one top folder, glasshome-<version>/, with the install files in their documented paths, the docs,
// the examples and tools/release/START-HERE.txt at the top. Tests, development tools and repository settings are
// left out. Commit first: the working tree must be clean. Run tools/validate.mjs on the extracted ZIP after.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version || "")) {
  console.error("usage: node tools/make-release-zip.mjs v<major>.<minor>.<patch>[-pre]   e.g. v2.0.0-beta.1");
  process.exit(2);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
if (git("status", "--porcelain").trim()) {
  console.error("refusing: the working tree has uncommitted changes. The ZIP is built from the last commit only.");
  process.exit(3);
}
// what users install or read; everything else (tests/, tools/, .github/, package.json, ...) stays out
const PATHS = ["www/glasshome", "themes/glasshome.yaml", "dashboards/glasshome.yaml", "custom_components/glasshome_news",
  "packages", "config", "examples", "docs", "README.md", "CHANGELOG.md", "SECURITY.md", "LICENSE"];
const name = `glasshome-${version}`;
mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
const out = `dist/${name}.zip`;
git("archive", "--format=zip", "-9", `--prefix=${name}/`, "--add-file=tools/release/START-HERE.txt", "-o", out, "HEAD", "--", ...PATHS);
console.log(`${out} from ${git("rev-parse", "--short", "HEAD").trim()}`);
