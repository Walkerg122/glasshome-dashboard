// Regression tests for the privacy scanner (tools/validate.mjs): generated test caches are not scanned, but a
// sensitive value in anything that would be published is still found.
// Run with: node tests/run-js-tests.mjs   (or: npm test)
// Each test builds a throw-away folder in the system temp directory. The "sensitive" values are fictional and
// assembled at run time, so this file itself contains none of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VALIDATE = fileURLToPath(new URL("../../tools/validate.mjs", import.meta.url));
const ADDRESS = [10, 20, 30, 40].join(".");                  // a private network address
const MAIL = ["someone", "realmail.co.uk"].join("@");        // a real-looking e-mail address
const TOKEN = ["eyJ" + "h".repeat(16), "p".repeat(20), "s".repeat(12)].join(".");  // JWT-shaped access token

const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), "glasshome-validate-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
function scan(dir, ...extra) {
  const env = { ...process.env };
  delete env.GLASSHOME_PRIVATE_TERMS; // only what the test folder contains
  const r = spawnSync(process.execPath, [VALIDATE, "--dir", dir, ...extra], { encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
}
function git(dir, ...a) {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...a], { cwd: dir, stdio: "ignore" });
}
// pytest writes every parametrised test id here, including the fictional addresses the tests use
const PYTEST_CACHE = {
  ".pytest_cache/v/cache/nodeids": JSON.stringify([`tests/test_x.py::test_blocks[http://${ADDRESS}/feed]`, `tests/test_x.py::test_mail[${MAIL}]`]),
  ".pytest_cache/v/cache/lastfailed": "{}",
  ".pytest_cache/README.md": "# pytest cache directory #\n",
  "tests/__pycache__/notes.txt": `cached ${ADDRESS}\n`,
};

test("generated test caches are skipped: a clean release with .pytest_cache passes", (t) => {
  const dir = folder({ "README.md": "# Example\n", "packages/example.yaml": "light:\n  - platform: template\n", ...PYTEST_CACHE });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = scan(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /No sensitive values found/);
  assert.match(r.out, /Skipped generated caches[^\n]*\.pytest_cache/);
});

test("a sensitive value in a release file is still found next to the caches", (t) => {
  const dir = folder({
    ...PYTEST_CACHE,
    "packages/example.yaml": `host: ${ADDRESS}\n`,
    "docs/notes.md": `Contact ${MAIL}\n`,
    "www/glasshome/extra.js": `const t = "${TOKEN}";\n`,
    "docs/pytest_cache_notes.md": `also ${ADDRESS}\n`,   // only real cache folders are skipped, not similar names
    "config/cache/settings.yaml": `also ${ADDRESS}\n`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = scan(dir);
  assert.equal(r.code, 1, r.out);
  for (const where of ["packages/example.yaml:1", "docs/notes.md:1", "www/glasshome/extra.js:1", "docs/pytest_cache_notes.md:1", "config/cache/settings.yaml:1"]) {
    assert.ok(r.out.includes(where), `reports ${where}\n${r.out}`);
  }
  assert.match(r.out, /ipv4/);
  assert.match(r.out, /e-mail/);
  assert.match(r.out, /JWT/);
  assert.ok(!r.out.includes(".pytest_cache/v/cache"), "the cache itself is not reported");
  assert.ok(!r.out.includes(ADDRESS) && !r.out.includes(MAIL), "values are masked in the report");
});

test("forbidden files are still reported outside the caches", (t) => {
  const dir = folder({ ...PYTEST_CACHE, "secrets.yaml": "x: 1\n", ".storage/auth": "{}\n" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = scan(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /forbidden file: Home Assistant secrets file/);
  assert.match(r.out, /forbidden file: Home Assistant \.storage folder/);
});

test("in a git repository, ignored caches pass but tracked files are always scanned", { skip: !hasGit && "git is not installed" }, (t) => {
  const dir = folder({
    ".gitignore": ".pytest_cache/\n__pycache__/\nnode_modules/\n",
    "README.md": "# Example\n",
    ...PYTEST_CACHE,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "clean");
  assert.equal(scan(dir).code, 0, "untracked caches are not findings");

  // files committed on purpose inside ignored folders get published, so they must be scanned
  writeFileSync(join(dir, ".pytest_cache", "kept.yaml"), `host: ${ADDRESS}\n`);
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), `// ${MAIL}\n`);
  git(dir, "add", "-f", ".pytest_cache/kept.yaml", "node_modules/pkg/index.js");
  git(dir, "commit", "-q", "-m", "tracked files in ignored folders");
  const r = scan(dir);
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes(".pytest_cache/kept.yaml:1"), r.out);
  assert.ok(r.out.includes("node_modules/pkg/index.js:1"), r.out);
  assert.ok(!r.out.includes(".pytest_cache/v/cache"), "untracked cache files stay skipped");
});

test("git history is still scanned, including files under cache folders", { skip: !hasGit && "git is not installed" }, (t) => {
  const dir = folder({ ".gitignore": ".pytest_cache/\n", "README.md": "# Example\n", "packages/old.yaml": `host: ${ADDRESS}\n` });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "with a value");
  mkdirSync(join(dir, ".pytest_cache"), { recursive: true });
  writeFileSync(join(dir, ".pytest_cache", "old.txt"), `${MAIL}\n`);
  git(dir, "add", "-f", ".pytest_cache/old.txt");
  git(dir, "rm", "-q", "packages/old.yaml");
  git(dir, "commit", "-q", "-m", "remove it");
  git(dir, "rm", "-q", ".pytest_cache/old.txt");
  git(dir, "commit", "-q", "-m", "remove that too");
  assert.equal(scan(dir).code, 0, "the working tree is clean now");
  const r = scan(dir, "--history");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /history \w+ packages\/old\.yaml/);
  assert.match(r.out, /history \w+ \.pytest_cache\/old\.txt/);
});
