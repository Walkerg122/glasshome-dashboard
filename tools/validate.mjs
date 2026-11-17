#!/usr/bin/env node
// Glass Home sensitive-value scanner. Run it before every commit or release:
//
//   node tools/validate.mjs                      scan the working tree
//   node tools/validate.mjs --history            also scan every commit in git history (needs git)
//   node tools/validate.mjs --terms <file>       extra private words to flag, one per line
//   node tools/validate.mjs --dir <folder>       scan another folder instead of this repository
//
// It only REPORTS. It never edits, moves or deletes anything. Matched values are masked in the output, so the
// report itself is safe to share. Exit code 1 means something needs a look.
//
// Private words (your surname, street, town, Wi-Fi name, ...) can also come from .glasshome-private-terms.txt
// in the repository root or the GLASSHOME_PRIVATE_TERMS environment variable (comma separated). The terms
// file is in .gitignore. Keep it that way.
// A line that is a deliberate, safe example can end with the comment  glasshome-validate: allow

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
// --dir <folder> scans another folder instead of this repository (for example before copying files in)
const ROOT = args.includes("--dir") ? resolve(args[args.indexOf("--dir") + 1]) : resolve(fileURLToPath(new URL("..", import.meta.url)));
const HISTORY = args.includes("--history");
const termsArg = args.includes("--terms") ? args[args.indexOf("--terms") + 1] : null;

// ---------------------------------------------------------------- what is allowed
// Documentation ranges (RFC 5737), loopback and "any" addresses are fine in examples
const SAFE_IP = /^(0\.0\.0\.0|169\.254\.169\.254|127\.\d+\.\d+\.\d+|192\.0\.2\.\d+|198\.51\.100\.\d+|203\.0\.113\.\d+|255\.255\.255\.\d+)$/;
const SAFE_MAC = /^(AA:BB:CC:DD:EE:FF|00:00:00:00:00:00|FF:FF:FF:FF:FF:FF)$/i;
const SAFE_EMAIL = /@(example\.(com|org|net)|users\.noreply\.github\.com)$|^(noreply|no-reply)@/i;
const DEMO_PEOPLE = new Set(["person.alex", "person.sam", "person.demo"]);
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "public-release-private"]);
// Generated test and tool caches. Never published, so the working-tree walk skips them; they hold copies of test
// data (pytest stores every parametrised test id, including fictional addresses) that would otherwise show up as
// findings. Files git tracks are always scanned, even inside these folders (see git ls-files below).
const CACHE_DIRS = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".hypothesis", ".tox", ".nox", ".venv", "venv", "htmlcov"]);
const TEXT_EXT = new Set([".js", ".py", ".mjs", ".cjs", ".ts", ".json", ".yaml", ".yml", ".md", ".txt", ".csv", ".html", ".css", ".svg", ".env", ".example", ".ini", ".conf", ""]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

// ---------------------------------------------------------------- files that must never be published
const FORBIDDEN_FILES = [
  [/(^|\/)secrets\.yaml$/, "Home Assistant secrets file"],
  [/(^|\/)\.storage(\/|$)/, "Home Assistant .storage folder (contains tokens and users)"],
  [/(^|\/)\.cloud(\/|$)/, "Home Assistant cloud folder"],
  [/\.(db|db-shm|db-wal|sqlite)$/, "database file"],
  [/(^|\/)home-assistant\.log|\.log(\.\d+)?$/, "log file"],
  [/(^|\/)backups?\//, "backup folder"],
  [/\.(tar|tar\.gz|tgz|zip)$/, "archive (could be a backup)"],
  [/(^|\/)\.env$/, "environment file with secrets"],
  [/(^|\/)glasshome\/config\.ya?ml$|(^|\/)glasshome-config\.(ya?ml|js)$/, "your personal Glass Home settings (only the examples belong in git)"],
  [/(^|\/)www\/.*\.(ya?ml|json|csv)$/, "settings or data file inside www/ (that folder is served to the web without login)"],
  [/(^|\/)\.glasshome-private-terms\.txt$/, null], // expected locally, must stay ignored (checked below)
  [/(^|\/)(known_devices|ip_bans)\.yaml$/, "Home Assistant device or ban list"],
  [/\.(pem|key|p12|crt)$|(^|\/)id_(rsa|ed25519)/, "key or certificate"],
];

// ---------------------------------------------------------------- value rules
const RULES = [
  { id: "jwt-token", what: "JWT / Home Assistant long-lived access token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/g },
  { id: "bearer", what: "Bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
  { id: "secret-assignment", what: "password / token / API key assigned a literal value",
    re: /\b(pass(word|wd)?|api[_-]?key|access[_-]?token|client[_-]?secret|secret|token|auth)["']?\s*[:=]\s*["']?(?!!secret\b)(?![\[{(]|\$\{|this\.|process\.env)([A-Za-z0-9_\-+/=.]{12,})/gi, group: 3,
    keep: (m) => !/^(true|false|null|undefined|string|number|required|optional|example|placeholder|your[_-]|xxx|changeme|glasshome_)/i.test(m) && /\d/.test(m) && /[A-Za-z]/.test(m) },
  { id: "url-credentials", what: "username:password inside a URL", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`]+:[^\s/@"'`]+@[^\s"'`]+/gi },
  { id: "rtsp", what: "camera stream address (RTSP)", re: /\brtsps?:\/\/[^\s"'`]+/gi },
  { id: "ipv4", what: "IP address", re: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.])/g, keep: (m) => !SAFE_IP.test(m) },
  { id: "mac", what: "MAC address", re: /(?<![\w:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![\w:-])/g, keep: (m) => !SAFE_MAC.test(m) },
  { id: "email", what: "e-mail address", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    keep: (m) => !SAFE_EMAIL.test(m) && !/\.(png|jpe?g|svg|js|css)$/i.test(m) && !/@\d/.test(m) },
  { id: "uk-postcode", what: "UK postcode", re: /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/g,
    keep: (m) => /\s/.test(m) || m.length >= 6 },
  { id: "energy-meter", what: "energy meter serial / MPAN / MPRN / account number",
    re: /\b(?:octopus_energy_(?:electricity|gas)_(?!METER)[0-9a-z]{6,}_[0-9]{6,}|A-[0-9A-F]{8}\b|(?:mpan|mprn|meter[_ ]?(?:serial|point))["']?\s*[:=]\s*["']?\d{6,})/gi },
  { id: "person-entity", what: "real person.* entity (only demo names are allowed)", re: /\bperson\.[a-z0-9_]+/g, keep: (m) => !DEMO_PEOPLE.has(m) && !m.startsWith("person.demo_") && m !== "person.name" },
  { id: "mobile-notify", what: "phone-specific notify service", re: /\bnotify\.mobile_app_(?!<|your_)[a-z0-9_]+/g },
  { id: "spotify-user", what: "Spotify account / device id", re: /\b(?:spotify:user:[A-Za-z0-9]+|media_player\.spotify_(?!alex\b|demo\b|x\b|your_)[a-z0-9_]+)/g },
  { id: "remote-url", what: "remote-access address (Nabu Casa, DuckDNS, dynamic DNS)", re: /\b[a-z0-9-]+\.(?:ui\.nabu\.casa|duckdns\.org|dynu\.net|no-ip\.(?:org|com)|ddns\.net)\b/gi },
  { id: "coordinates", what: "precise latitude/longitude", re: /\b(?:latitude|longitude|lat|lon|lng)["']?\s*[:=]\s*["']?-?\d{1,3}\.\d{4,}/gi },
  { id: "private-key", what: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

// ---------------------------------------------------------------- private words
const terms = new Set();
const addTerms = (text) => text.split(/[\r\n,]+/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#") && s.length >= 3).forEach((s) => terms.add(s));
const localTerms = join(ROOT, ".glasshome-private-terms.txt");
if (existsSync(localTerms)) addTerms(readFileSync(localTerms, "utf8"));
if (termsArg) addTerms(readFileSync(resolve(termsArg), "utf8"));
if (process.env.GLASSHOME_PRIVATE_TERMS) addTerms(process.env.GLASSHOME_PRIVATE_TERMS);
const termRe = terms.size ? new RegExp(`(?<![A-Za-z0-9])(${[...terms].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "gi") : null;

// ---------------------------------------------------------------- scanning
const mask = (v) => (v.length <= 6 ? `${v[0]}***` : `${v.slice(0, 3)}***${v.slice(-2)}`);
const findings = [];
const add = (where, rule, value) => findings.push({ where, rule, value: value == null ? "" : mask(String(value)) });

function scanText(label, text) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/glasshome-validate:\s*allow/.test(line)) return;
    const where = `${label}:${i + 1}`;
    for (const r of RULES) {
      r.re.lastIndex = 0;
      for (const m of line.matchAll(r.re)) {
        const v = r.group ? m[r.group] : m[0];
        if (v && (!r.keep || r.keep(v))) add(where, `${r.id} (${r.what})`, v);
      }
    }
    if (termRe) for (const m of line.matchAll(termRe)) add(where, "private-term (from your private terms list)", m[0]);
  });
}

const skippedCaches = [];
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) {
      if (CACHE_DIRS.has(name)) { skippedCaches.push(relative(ROOT, p).split("\\").join("/")); continue; }
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const isRepo = existsSync(join(ROOT, ".git"));
// git check-ignore never reports a tracked file, so a committed file is scanned even if .gitignore matches it
const ignored = (rel) => { if (!isRepo) return false; try { git("check-ignore", "-q", rel); return true; } catch { return false; } };

const files = walk(ROOT);
// Every file git tracks is scanned, wherever it is (also inside skipped or cache folders): those get published.
if (isRepo) {
  const seen = new Set(files.map((f) => resolve(f)));
  for (const rel of git("ls-files", "-z").split("\0").filter(Boolean)) {
    const p = resolve(ROOT, rel);
    if (!seen.has(p) && existsSync(p) && statSync(p).isFile()) { files.push(p); seen.add(p); }
  }
}
const images = [];
for (const file of files) {
  const rel = relative(ROOT, file).split("\\").join("/");
  for (const [re, why] of FORBIDDEN_FILES) {
    if (!re.test(rel)) continue;
    if (why === null) { if (isRepo && !ignored(rel)) add(rel, "private-terms file is NOT ignored by git", null); continue; }
    if (!ignored(rel)) add(rel, `forbidden file: ${why}`, null);
  }
  const ext = extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) {
    images.push(rel);
    const buf = readFileSync(file);
    // EXIF GPS block (tag 0x8825) in a JPEG's Exif segment or a PNG eXIf chunk
    const jpg = buf.indexOf(Buffer.from("Exif\0\0", "latin1")), exif = jpg >= 0 ? jpg : buf.indexOf("eXIf");
    if (exif >= 0) {
      const seg = buf.subarray(exif, exif + 65536);
      if (seg.includes(Buffer.from([0x88, 0x25])) || seg.includes(Buffer.from([0x25, 0x88]))) add(rel, "image metadata contains a GPS location", null);
      else add(rel, "image has EXIF metadata (camera / date details); consider stripping it", null);
    }
    continue;
  }
  if (file === fileURLToPath(import.meta.url) || basename(file) === ".glasshome-private-terms.txt") continue;
  if (!TEXT_EXT.has(ext) && !basename(file).startsWith(".")) continue;
  if (ignored(rel)) continue;
  const st = statSync(file);
  if (st.size > 8 * 1024 * 1024) { add(rel, "very large file, not scanned", null); continue; }
  scanText(rel, readFileSync(file, "utf8"));
}

if (HISTORY) {
  if (!isRepo) console.log("--history: not a git repository yet, nothing to scan.");
  else {
    const log = git("log", "--all", "-p", "--no-color", "--unified=0", "--format=commit %h");
    let commit = "", fileName = "";
    const added = [];
    for (const line of log.split("\n")) {
      if (line.startsWith("commit ")) commit = line.slice(7);
      else if (line.startsWith("+++ b/")) fileName = line.slice(6);
      else if (line.startsWith("+") && !line.startsWith("+++") && fileName !== "tools/validate.mjs") added.push([`history ${commit} ${fileName}`, line.slice(1)]);
    }
    for (const [label, text] of added) scanText(label, text);
    for (const name of git("log", "--all", "--format=", "--name-only").split("\n").filter(Boolean)) {
      for (const [re, why] of FORBIDDEN_FILES) if (why && re.test(name)) add(`history: ${name}`, `forbidden file was committed at some point: ${why}`, null);
    }
  }
}

// ---------------------------------------------------------------- report
const uniq = [...new Map(findings.map((f) => [`${f.where}|${f.rule}|${f.value}`, f])).values()];
console.log(`Glass Home validate: ${files.length} files scanned${HISTORY ? " + git history" : ""}, ${terms.size} private terms.`);
if (skippedCaches.length) console.log(`Skipped generated caches (never published${isRepo ? "; files git tracks in them were still scanned" : ""}): ${skippedCaches.join(", ")}`);
if (images.length) console.log(`Images to check by eye for personal details (${images.length}): ${images.join(", ")}`);
if (!uniq.length) { console.log("No sensitive values found."); process.exit(0); }
console.log(`\n${uniq.length} finding(s). Nothing has been changed. Review each one:\n`);
for (const f of uniq) console.log(`  ${f.where}\n    ${f.rule}${f.value ? `: ${f.value}` : ""}`);
console.log("\nIf a line is a deliberate fictional example, add the comment  glasshome-validate: allow  to it.");
process.exit(1);
