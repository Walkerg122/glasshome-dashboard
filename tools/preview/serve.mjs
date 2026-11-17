// Glass Home preview: serves the dashboard against fictional demo data, without Home Assistant.
// Usage (from the repository root): node tools/preview/serve.mjs [port]   then open http://localhost:8123/glass-home/home
// Fresh install: run  document.cookie = "ghcfg=none"  in the browser console and reload ("ghcfg=example" for
// the example settings, "ghcfg=" to go back to the demo).
// Development aid only: it listens on localhost and serves this repository's files read-only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PORT = Number(process.argv[2]) || Number(process.env.GLASSHOME_PREVIEW_PORT) || 8123;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".yaml": "text/yaml", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };

const route = (path) => {
  if (path === "/" || path.startsWith("/glass-home")) return "tools/preview/index.html";
  if (path.startsWith("/local/glasshome/")) return `www/glasshome/${path.slice("/local/glasshome/".length)}`;
  if (/^\/(dashboards|themes|config|examples|tools\/preview)\//.test(path)) return path.slice(1);
  return null;
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = route(path);
  const file = rel && normalize(join(ROOT, rel));
  if (!file || !file.startsWith(ROOT)) { res.writeHead(404).end("not found"); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Glass Home preview: http://localhost:${PORT}/glass-home/home`));
