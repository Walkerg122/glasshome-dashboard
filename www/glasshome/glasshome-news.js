/*
 * Glass Home News: a news reader for the Glass Home dashboard (optional; features.news).
 * Loaded as its own Lovelace resource (/local/glasshome/glasshome-news.js) after glasshome-cards.js,
 * which provides the shared nav card and the News pill on the hero card (the way in).
 *   - custom:glasshome-news-card, the reader itself (the dashboard's "news" subview).
 * Headlines: public RSS feeds (BBC, Sky News, The Guardian by default; choose with news.categories
 *   in the dashboard's glasshome: settings, or add your own with news.custom), fetched by Home Assistant
 *   through the Glass Home News integration (custom_components/glasshome_news, action
 *   glasshome_news.fetch), because browsers cannot read these feeds directly. The integration only
 *   fetches public https addresses (see its README). Cached per device for about 15 minutes.
 * Saved and added articles: a Home Assistant Local To-do list (news.todo, default todo.glasshome_news),
 *   so they are shared by every device, survive restarts and are included in backups.
 *   Each article is one item: summary = headline, description = JSON with the details.
 */

// the settings come from the dashboard, loaded by glasshome-cards.js
await customElements.whenDefined("glasshome-nav-card");
const WN_CFG = () => (window.GlassHomeConfig && window.GlassHomeConfig.news) || {};
const WN_TODO = WN_CFG().todo || "todo.glasshome_news";
const WN_FETCH = ["glasshome_news", "fetch"];
const WN_TTL = 15 * 60 * 1000;
const WN_CACHE = "glasshome.news.feed.";
const WN_BASE = () => `/${location.pathname.split("/")[1] || "glass-home"}`;
const WN_LOCALE = () => ((window.GlassHomeConfig || {}).household || {}).locale || navigator.language || "en-GB";

const BBC = "https://feeds.bbci.co.uk", SKY = "https://feeds.skynews.com/feeds/rss", GDN = "https://www.theguardian.com";
const WN_ALL = [
  { id: "top", name: "Top stories", icon: "mdi:newspaper-variant-outline", feeds: [`${BBC}/news/rss.xml`, `${SKY}/home.xml`] },
  { id: "uk", name: "UK News", icon: "mdi:map-marker-outline", feeds: [`${BBC}/news/uk/rss.xml`, `${SKY}/uk.xml`] },
  { id: "world", name: "World", icon: "mdi:earth", feeds: [`${BBC}/news/world/rss.xml`, `${SKY}/world.xml`, `${GDN}/world/rss`] },
  { id: "business", name: "Business", icon: "mdi:briefcase-outline", feeds: [`${BBC}/news/business/rss.xml`, `${SKY}/business.xml`, `${GDN}/uk/business/rss`] },
  { id: "technology", name: "Technology", icon: "mdi:chip", feeds: [`${BBC}/news/technology/rss.xml`, `${SKY}/technology.xml`, `${GDN}/uk/technology/rss`] },
  { id: "sport", name: "Sport", icon: "mdi:soccer", feeds: [`${BBC}/sport/rss.xml`, `${GDN}/uk/sport/rss`] },
  { id: "science", name: "Science", icon: "mdi:flask-outline", feeds: [`${BBC}/news/science_and_environment/rss.xml`, `${GDN}/science/rss`] },
  { id: "entertainment", name: "Entertainment", icon: "mdi:movie-open-outline", feeds: [`${BBC}/news/entertainment_and_arts/rss.xml`, `${SKY}/entertainment.xml`, `${GDN}/uk/culture/rss`] },
];
// news.categories picks and orders the built-in categories (default: all of them); news.custom adds
// your own: [{ id, name, icon, feeds: ["https://…/rss"] }] (public https feeds only)
const WN_CATS = (() => {
  const c = WN_CFG(), ids = Array.isArray(c.categories) ? c.categories : WN_ALL.map((x) => x.id);
  const pick = ids.map((id) => WN_ALL.find((x) => x.id === id)).filter(Boolean);
  const own = (Array.isArray(c.custom) ? c.custom : []).filter((x) => x && x.id && x.name && Array.isArray(x.feeds) && x.feeds.length)
    .map((x) => ({ icon: "mdi:rss", ...x, feeds: x.feeds.filter((u) => /^https:\/\//.test(u)) }));
  return [...pick, ...own];
})();
const WN_TABS = [...WN_CATS, { id: "saved", name: "Saved", icon: "mdi:star-outline" }, { id: "mine", name: "My articles", icon: "mdi:bookmark-plus-outline" }];
const wnCatName = (id) => (WN_CATS.find((c) => c.id === id) || {}).name || "";

const wnEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wnText = (html) => {
  if (!html) return "";
  const d = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return (d.body.textContent || "").replace(/\s+/g, " ").trim();
};
const wnClip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);
const wnUrlOk = (u) => { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch (e) { return false; } };
// the same story with or without tracking tags (?at_medium=RSS, utm_…) or "www." counts as one
const wnNormUrl = (u) => {
  try {
    const x = new URL(u);
    [...x.searchParams.keys()].forEach((k) => { if (/^(utm_|at_)/i.test(k)) x.searchParams.delete(k); });
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/$/, "")}${x.search}`;
  } catch (e) { return u || ""; }
};
const wnPublisher = (u) => {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    if (/bbc\./.test(h)) return "BBC News";
    if (/sky(news)?\./.test(h)) return "Sky News";
    if (/theguardian\./.test(h)) return "The Guardian";
    return h;
  } catch (e) { return ""; }
};
function wnAgo(ms) {
  if (!ms) return "";
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
  return new Date(ms).toLocaleDateString(WN_LOCALE(), { day: "numeric", month: "short", year: new Date(ms).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}
// BBC thumbnails come at 240px; the same picture is published at larger sizes
const wnBigImg = (u, w) => (u && /ichef\.bbci\.co\.uk\/.+\/240\//.test(u) ? u.replace("/240/", `/${w}/`) : u);

// ------------------------------------------------------------------ fetching (through Home Assistant)
async function wnFetch(hass, url) {
  const r = await hass.callWS({ type: "call_service", domain: WN_FETCH[0], service: WN_FETCH[1], service_data: { url }, return_response: true });
  const res = (r && r.response) || {};
  if (res.status && res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const c = res.content;
  if (typeof c !== "string" || !c) throw new Error("empty");
  return c;
}

function wnParseFeed(xml, feedUrl, cat) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("bad feed");
  const chan = doc.getElementsByTagName("channel")[0];
  const chanTitle = chan ? ((chan.getElementsByTagName("title")[0] || {}).textContent || "") : "";
  const pub = /bbc/i.test(feedUrl) ? "BBC News" : /sky/i.test(feedUrl) ? "Sky News" : /guardian/i.test(feedUrl) ? "The Guardian" : chanTitle;
  const out = [];
  for (const it of Array.from(doc.getElementsByTagName("item")).slice(0, 30)) {
    const get = (t) => { const n = it.getElementsByTagName(t)[0]; return n ? (n.textContent || "").trim() : ""; };
    const url = get("link");
    const title = wnText(get("title"));
    if (!url || !title || !wnUrlOk(url)) continue;
    // picture: the largest media:content (Guardian), else media:thumbnail (BBC, Sky), else an image enclosure
    let img = "", best = 0;
    for (const m of Array.from(it.getElementsByTagName("media:content"))) {
      const w = +m.getAttribute("width") || 1, u = m.getAttribute("url");
      if (u && (m.getAttribute("medium") || "image") === "image" && w > best && w <= 1200) { best = w; img = u; }
    }
    if (!img) { const t = it.getElementsByTagName("media:thumbnail")[0]; if (t) img = t.getAttribute("url") || ""; }
    // some feeds put the picture inside the description
    if (!img) { const m = /<img[^>]+src=["']([^"']+)["']/i.exec(get("description") + get("content:encoded")); if (m) img = m[1].replace(/&amp;/g, "&"); }
    if (!img) { const e = it.getElementsByTagName("enclosure")[0]; if (e && /^image\//.test(e.getAttribute("type") || "")) img = e.getAttribute("url") || ""; }
    const d = Date.parse(get("pubDate") || get("dc:date"));
    out.push({ url, title, desc: wnClip(wnText(get("description")), 260), img: img.startsWith("http") ? img : "", date: Number.isFinite(d) ? d : 0, pub, cat });
  }
  return out;
}

async function wnFeed(hass, url, cat, force) {
  const key = WN_CACHE + url;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { /* no cache */ }
  if (!force && cached && Date.now() - cached.t < WN_TTL) return cached.items;
  try {
    const items = wnParseFeed(await wnFetch(hass, url), url, cat);
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), items })); } catch (e) { /* storage full: fine */ }
    return items;
  } catch (e) {
    if (cached) return cached.items; // show the last copy rather than nothing
    throw e;
  }
}

// Page details for an article added by address (Open Graph tags, then the page title)
async function wnMeta(hass, url) {
  const html = await wnFetch(hass, url);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      if (el && el.getAttribute("content")) return el.getAttribute("content").trim();
    }
    return "";
  };
  const t = Date.parse(meta("article:published_time", "og:article:published_time", "date", "pubdate", "dc.date"));
  let img = meta("og:image", "og:image:url", "twitter:image");
  try { if (img) img = new URL(img, url).toString(); } catch (e) { img = ""; }
  return {
    title: wnText(meta("og:title", "twitter:title") || ((doc.querySelector("title") || {}).textContent || "")),
    desc: wnClip(wnText(meta("og:description", "description", "twitter:description")), 400),
    img: img.startsWith("http") ? img : "",
    pub: wnText(meta("og:site_name", "application-name")) || wnPublisher(url),
    date: Number.isFinite(t) ? t : 0,
  };
}

// ------------------------------------------------------------------ the reader
const WN_CSS = `
  :host { display: block; color: #fff; }
  * { box-sizing: border-box; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 14px 16px calc(28px + env(safe-area-inset-bottom, 0px)); }
  .top { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .top glasshome-nav-card { flex: 0 0 auto; width: 128px; }
  .ttl { flex: 1 1 auto; min-width: 0; }
  .ttl h1 { margin: 0; font-size: 32px; font-weight: 750; letter-spacing: -0.6px; line-height: 1.05; }
  .ttl .d { font-size: 14px; color: #a29db8; margin-top: 3px; }
  .acts { display: flex; gap: 8px; }
  .btn { height: 44px; border-radius: 18px; border: 1px solid var(--lg-border, rgba(255,255,255,0.14)); cursor: pointer; font: inherit; font-size: 14px; font-weight: 600; color: #e9e5f5;
    display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; --mdc-icon-size: 20px;
    background: var(--lg-fill, linear-gradient(150deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 34%, rgba(255,255,255,0.02) 62%, rgba(255,255,255,0.05) 100%), rgba(30,23,56,0.56)); box-shadow: inset 0 1px 0 rgba(255,255,255,0.18); -webkit-tap-highlight-color: transparent;
    transition: transform 0.14s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.2s ease, border-color 0.2s ease; }
  .btn:active { transform: scale(0.96); }
  .btn ha-icon { color: #a78bfa; }
  .btn.pri { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.7), rgba(109,40,217,0.5)); border-color: transparent; }
  .btn.pri ha-icon { color: #fff; }
  .btn.danger { color: #fff; background: rgba(239,68,68,0.55); border-color: transparent; }
  .btn:active { transform: scale(0.96); }
  .btn.ic { width: 44px; padding: 0; }
  .btn.spin ha-icon { animation: wnrot 1s linear infinite; }
  @keyframes wnrot { to { transform: rotate(360deg); } }
  .tabs { display: flex; gap: 8px; overflow-x: auto; margin: 16px -16px 0; padding: 2px 16px 6px; scrollbar-width: none; overscroll-behavior-x: contain; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { flex: none; height: 38px; border-radius: 19px; border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.05); color: #c9c4dc;
    font: inherit; font-size: 14px; font-weight: 600; padding: 0 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; --mdc-icon-size: 17px; }
  .tab.on { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.62), rgba(109,40,217,0.38)); border-color: transparent;
    box-shadow: 0 0 14px rgba(139,92,246,0.3); }
  .status { margin-top: 14px; font-size: 13.5px; color: #a29db8; display: flex; align-items: center; gap: 8px; --mdc-icon-size: 17px; min-height: 18px; }
  .status.err { color: #ffb4b4; }
  .hero { position: relative; display: block; margin-top: 12px; border-radius: 26px; overflow: hidden; min-height: 300px; cursor: pointer;
    background: rgba(26,20,46,0.8); border: 1px solid var(--lg-border, rgba(255,255,255,0.14)); box-shadow: var(--lg-shadow, inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(6,3,20,0.30)); }
  .hero img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .hero .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,6,24,0) 25%, rgba(10,6,24,0.55) 55%, rgba(10,6,24,0.95) 100%); }
  .hero .tx { position: relative; display: flex; flex-direction: column; justify-content: flex-end; min-height: 300px; padding: 22px 22px 20px; }
  .hero h2 { margin: 6px 0 0; font-size: 30px; line-height: 1.12; letter-spacing: -0.4px; font-weight: 750; text-shadow: 0 2px 16px rgba(0,0,0,0.5); }
  .hero p { margin: 8px 0 0; font-size: 15.5px; line-height: 1.4; color: #ddd8ec; max-width: 760px; }
  .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: #b9b3cf; }
  .meta b { color: #fff; font-weight: 700; }
  .tag { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; padding: 3px 8px; border-radius: 8px;
    background: rgba(139,92,246,0.28); color: #ddd6fe; }
  .tag.mine { background: rgba(45,212,191,0.22); color: #99f6e4; }
  .sec { display: flex; align-items: baseline; justify-content: space-between; margin: 26px 2px 10px; }
  .sec h3 { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: -0.2px; }
  .sec span { font-size: 13px; color: #8e8aa0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 14px; grid-auto-flow: row dense; }
  .card { position: relative; display: flex; flex-direction: column; border-radius: 22px; overflow: hidden; cursor: pointer; min-width: 0;
    background: var(--lg-fill, linear-gradient(150deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 34%, rgba(255,255,255,0.02) 62%, rgba(255,255,255,0.05) 100%), rgba(30,23,56,0.56)); border: 1px solid var(--lg-border, rgba(255,255,255,0.14)); box-shadow: var(--lg-shadow, inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(255,255,255,0.05), 0 8px 24px rgba(6,3,20,0.30));
    -webkit-tap-highlight-color: transparent; transition: transform 0.14s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.25s ease; }
  .card:active { transform: scale(0.99); }
  .card .im { aspect-ratio: 16 / 9; background: rgba(255,255,255,0.04); overflow: hidden; }
  .card .im img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card .bd { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .card h4 { margin: 0; font-size: 16.5px; line-height: 1.25; font-weight: 700; }
  .card p { margin: 0; font-size: 13.5px; line-height: 1.4; color: #b9b3cf; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .card.wide { grid-column: span 2; flex-direction: row; }
  .card.wide .im { flex: 0 0 48%; aspect-ratio: auto; min-height: 210px; }
  .card.wide h4 { font-size: 20px; }
  .card.mine { border-color: rgba(45,212,191,0.35); }
  .card.mine::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg, #2dd4bf, #0d9488); z-index: 1; }
  .card .row { display: flex; gap: 6px; margin-top: auto; padding-top: 4px; }
  .fav { position: absolute; top: 10px; right: 10px; z-index: 2; width: 40px; height: 40px; border-radius: 50%; border: 0; cursor: pointer;
    background: rgba(10,6,24,0.6); color: #fff; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 21px;
    -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); -webkit-tap-highlight-color: transparent; }
  .fav.on { color: #fcd34d; }
  .fav:disabled { opacity: 0.5; }
  .hero .fav { top: 14px; right: 14px; }
  .sm { height: 34px; font-size: 13px; padding: 0 11px; border-radius: 14px; --mdc-icon-size: 17px; }
  .empty { margin-top: 26px; padding: 30px 20px; border-radius: 22px; text-align: center; color: #a29db8; font-size: 15px; line-height: 1.5;
    background: rgba(255,255,255,0.04); border: 1px dashed rgba(255,255,255,0.12); }
  .empty ha-icon { --mdc-icon-size: 34px; color: #8b5cf6; display: block; margin: 0 auto 8px; }
  /* dialogs */
  .dlg { position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(5,3,14,0.55); }
  .box { width: 100%; max-width: 560px; max-height: calc(100vh - 32px); overflow-y: auto; border-radius: 24px; padding: 20px;
    background: linear-gradient(155deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.05) 100%), rgba(26,20,48,0.80); border: 1px solid var(--lg-float-border, rgba(255,255,255,0.17));
    box-shadow: 0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22);
    -webkit-backdrop-filter: var(--lg-float-blur, blur(22px) saturate(175%)); backdrop-filter: var(--lg-float-blur, blur(22px) saturate(175%)); }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .box { background: linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03)), #1a1430; } }
  @media (prefers-reduced-motion: reduce) { .btn, .card { transition: none; } .btn:active, .card:active { transform: none; } }
  .box h3 { margin: 0 0 4px; font-size: 21px; }
  .box .hint { font-size: 13.5px; color: #a29db8; margin-bottom: 14px; line-height: 1.4; }
  .fld { display: block; margin-top: 12px; }
  .fld span { display: block; font-size: 12.5px; font-weight: 600; color: #a29db8; margin-bottom: 5px; letter-spacing: 0.3px; }
  .fld input, .fld textarea, .fld select { width: 100%; font: inherit; font-size: 15px; color: #fff; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 11px 12px; outline: none; }
  .fld select option { background: #1a1430; }
  .fld textarea { min-height: 84px; resize: vertical; }
  .fld input:focus, .fld textarea:focus, .fld select:focus { border-color: rgba(167,139,250,0.7); }
  .urlrow { display: flex; gap: 8px; } .urlrow input { flex: 1; min-width: 0; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .bact { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; flex-wrap: wrap; }
  .note { margin-top: 10px; font-size: 13px; color: #a29db8; min-height: 16px; } .note.err { color: #ffb4b4; } .note.ok { color: #86efac; }
  .prev { margin-top: 12px; border-radius: 14px; overflow: hidden; aspect-ratio: 16 / 9; background: rgba(255,255,255,0.04); }
  .prev img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* Narrow: a foldable's cover screen, a phone */
  @media (max-width: 599px) {
    .wrap { padding: 10px 12px calc(24px + env(safe-area-inset-bottom, 0px)); }
    .top glasshome-nav-card { width: 108px; }
    .ttl h1 { font-size: 26px; }
    .ttl .d { font-size: 12.5px; }
    .btn .lbl { display: none; }
    .btn { padding: 0 12px; }
    .tabs { margin: 12px -12px 0; padding: 2px 12px 6px; }
    .hero, .hero .tx { min-height: 250px; }
    .hero h2 { font-size: 22px; }
    .hero p { font-size: 14px; -webkit-line-clamp: 3; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
    .grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .card.wide { grid-column: auto; flex-direction: column; }
    .card.wide .im { flex: none; aspect-ratio: 16 / 9; min-height: 0; }
    .card.wide h4 { font-size: 17px; }
    .two { grid-template-columns: 1fr; }
    .box { padding: 16px; }
  }
  @media (min-width: 600px) and (max-width: 860px) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }`;

class GlassHomeNewsCard extends HTMLElement {
  setConfig(c) { this._config = { todo: WN_TODO, ...c }; }
  getCardSize() { return 12; }
  set hass(h) {
    h = window.GlassHomeHass ? window.GlassHomeHass(h) : h;
    const first = !this._hass;
    this._hass = h;
    if (first) this._start();
    const t = h.states[this._config.todo];
    const stamp = t ? `${t.state}|${t.last_updated}` : "none";
    if (stamp !== this._todoStamp) { this._todoStamp = stamp; if (!first) this._loadSaved(); }
  }
  connectedCallback() {
    if (this._hass && !this._unsub) this._subscribe();
  }
  disconnectedCallback() {
    if (this._unsub) { this._unsub.then((u) => u && u()).catch(() => {}); this._unsub = null; }
  }

  _start() {
    this._tab = "top";
    this._items = {};      // category id -> RSS articles
    this._saved = [];      // to-do items (favourites and added articles)
    this._busy = new Set();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${WN_CSS}</style><div class="wrap">
      <div class="top"><glasshome-nav-card></glasshome-nav-card>
        <div class="ttl"><h1>News</h1><div class="d"></div></div>
        <div class="acts"><button class="btn ic" data-a="refresh" aria-label="Refresh"><ha-icon icon="mdi:refresh"></ha-icon></button>
          <button class="btn pri" data-a="add"><ha-icon icon="mdi:plus"></ha-icon><span class="lbl">Add article</span></button></div></div>
      <div class="tabs noswipe">${WN_TABS.map((t) => `<button class="tab" data-tab="${t.id}"><ha-icon icon="${t.icon}"></ha-icon>${t.name}</button>`).join("")}</div>
      <div class="status"></div><div class="body"></div><div class="dlgs"></div></div>`;
    const nav = this.shadowRoot.querySelector("glasshome-nav-card");
    const navCfg = { variant: "links", links: [{ name: "Home", icon: "mdi:arrow-left", path: `${WN_BASE()}/home#home` }], prev: `${WN_BASE()}/home#home`, swipe: true };
    customElements.whenDefined("glasshome-nav-card").then(() => { nav.setConfig(navCfg); nav.hass = this._hass; });
    this.shadowRoot.querySelector(".d").textContent = new Date().toLocaleDateString(WN_LOCALE(), { weekday: "long", day: "numeric", month: "long" });
    this.shadowRoot.addEventListener("click", (e) => this._click(e));
    this._subscribe();
    this._loadSaved();
    this._show("top");
  }

  _subscribe() {
    if (this._unsub || !this._hass || !this._hass.connection) return;
    // other devices adding, saving or removing an article show up here straight away
    this._unsub = this._hass.connection.subscribeMessage(() => this._loadSaved(),
      { type: "todo/item/subscribe", entity_id: this._config.todo }).catch(() => null);
  }

  async _loadSaved() {
    const h = this._hass;
    if (!h || !h.states[this._config.todo]) { this._saved = []; this._noStore = true; this._render(); return; }
    this._noStore = false;
    try {
      const r = await h.callWS({ type: "call_service", domain: "todo", service: "get_items", target: { entity_id: this._config.todo },
        service_data: { status: ["needs_action", "completed"] }, return_response: true });
      const list = ((r.response || {})[this._config.todo] || {}).items || [];
      this._saved = list.map((it) => {
        let d = {};
        try { d = JSON.parse(it.description || "{}"); } catch (e) { d = {}; }
        return { uid: it.uid, title: it.summary, url: d.url || "", desc: d.desc || "", img: d.img || "", pub: d.pub || wnPublisher(d.url),
          date: d.date || 0, cat: d.cat || "", manual: !!d.manual, fav: d.manual ? !!d.fav : true, added: d.added || 0 };
      }).filter((a) => a.url);
    } catch (e) { console.warn("glasshome-news: could not read saved articles", e); }
    this._render();
  }
  _savedFor(url) { const u = wnNormUrl(url); return this._saved.find((a) => wnNormUrl(a.url) === u); }

  async _show(tab, force) {
    this._tab = tab;
    this.shadowRoot.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    const cat = WN_CATS.find((c) => c.id === tab);
    this._err = null;
    if (!cat) { this._render(); return; }
    if (!this._items[tab] || force) {
      this._loading = tab;
      this._render();
      const res = await Promise.allSettled(cat.feeds.map((u) => wnFeed(this._hass, u, tab, force)));
      const all = [], seen = new Set();
      res.forEach((r) => { if (r.status === "fulfilled") r.value.forEach((a) => { const k = wnNormUrl(a.url); if (!seen.has(k)) { seen.add(k); all.push(a); } }); });
      // newest first; items without a published time keep their feed order after the dated ones
      all.sort((a, b) => (b.date || 0) - (a.date || 0));
      const failed = res.filter((r) => r.status === "rejected").length;
      if (!all.length) this._err = failed ? "News could not be loaded. Check the connection and try again." : "No stories right now.";
      else if (failed) this._err = `${failed} of ${cat.feeds.length} sources did not respond; showing the rest.`;
      this._items[tab] = all;
      this._fetched = Date.now();
      if (this._loading === tab) this._loading = null;
    }
    if (this._tab === tab) this._render();
  }

  _render() {
    if (!this.shadowRoot) return;
    const body = this.shadowRoot.querySelector(".body"), st = this.shadowRoot.querySelector(".status");
    const tab = this._tab;
    const rb = this.shadowRoot.querySelector('[data-a="refresh"]');
    if (rb) rb.classList.toggle("spin", this._loading === tab);
    let list;
    if (tab === "saved") list = this._saved.filter((a) => a.fav).sort((a, b) => (b.added || 0) - (a.added || 0));
    else if (tab === "mine") list = this._saved.filter((a) => a.manual).sort((a, b) => (b.added || 0) - (a.added || 0));
    else list = this._items[tab] || [];
    if (this._noStore) st.innerHTML = `<ha-icon icon="mdi:alert-outline"></ha-icon>Saving is not set up yet (the to-do list ${wnEsc(this._config.todo)} was not found).`;
    else if (this._loading === tab && !list.length) st.innerHTML = `<ha-icon icon="mdi:loading"></ha-icon>Loading the latest stories…`;
    else if (this._err && WN_CATS.some((c) => c.id === tab)) st.innerHTML = `<ha-icon icon="mdi:alert-circle-outline"></ha-icon>${wnEsc(this._err)}`;
    else if (WN_CATS.some((c) => c.id === tab) && list.length) st.textContent = `${[...new Set(list.map((a) => a.pub).filter(Boolean))].join(" · ")}${this._fetched ? ` · updated ${new Date(this._fetched).toLocaleTimeString(WN_LOCALE(), { hour: "2-digit", minute: "2-digit" })}` : ""}`;
    else st.textContent = "";
    st.classList.toggle("err", !!this._err && WN_CATS.some((c) => c.id === tab));

    if (!list.length) {
      if (this._loading === tab) { body.innerHTML = ""; return; }
      const msg = tab === "saved" ? ["mdi:star-outline", "No saved stories yet. Tap the star on any story to keep it here, on every device."]
        : tab === "mine" ? ["mdi:bookmark-plus-outline", "Articles you add by pasting a link appear here. Use “Add article” at the top."]
          : ["mdi:newspaper-remove", "No stories to show."];
      body.innerHTML = `<div class="empty"><ha-icon icon="${msg[0]}"></ha-icon>${msg[1]}</div>`;
      return;
    }
    this._list = list;
    const [lead, ...rest] = list;
    const heading = tab === "saved" ? "Saved" : tab === "mine" ? "My articles" : "Latest";
    body.innerHTML = `${this._hero(lead, 0)}
      ${rest.length ? `<div class="sec"><h3>${heading}</h3><span>${rest.length + 1} stories</span></div>
      <div class="grid">${rest.map((a, k) => this._card(a, k + 1, k % 7 === 2)).join("")}</div>` : ""}`;
  }

  _favBtn(a, k) {
    const s = a.manual ? a : this._savedFor(a.url);
    const on = a.manual ? !!a.fav : !!(s && s.fav);
    const busy = this._busy.has(wnNormUrl(a.url));
    return `<button class="fav${on ? " on" : ""}" data-a="fav" data-k="${k}" ${busy ? "disabled" : ""} aria-label="${on ? "Remove from saved" : "Save"}"><ha-icon icon="${on ? "mdi:star" : "mdi:star-outline"}"></ha-icon></button>`;
  }
  _metaLine(a) {
    return `<div class="meta">${a.manual ? '<span class="tag mine">Added by you</span>' : ""}${a.cat ? `<span class="tag">${wnEsc(wnCatName(a.cat) || a.cat)}</span>` : ""}<b>${wnEsc(a.pub || "")}</b>${a.date ? `<span>${wnAgo(a.date)}</span>` : ""}</div>`;
  }
  _tools(a, k) {
    return a.manual ? `<div class="row"><button class="btn sm" data-a="edit" data-k="${k}"><ha-icon icon="mdi:pencil"></ha-icon>Edit</button>
      <button class="btn sm" data-a="del" data-k="${k}"><ha-icon icon="mdi:delete-outline"></ha-icon>Delete</button></div>` : "";
  }
  _hero(a, k) {
    const img = wnBigImg(a.img, 976);
    return `<div class="hero${a.manual ? " mine" : ""}" data-open="${k}">
      ${img ? `<img src="${wnEsc(img)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer">` : ""}<div class="shade"></div>${this._favBtn(a, k)}
      <div class="tx">${this._metaLine(a)}<h2>${wnEsc(a.title)}</h2>${a.desc ? `<p>${wnEsc(a.desc)}</p>` : ""}${this._tools(a, k)}</div></div>`;
  }
  _card(a, k, wide) {
    const img = wnBigImg(a.img, wide ? 800 : 480);
    return `<div class="card${wide ? " wide" : ""}${a.manual ? " mine" : ""}" data-open="${k}">${this._favBtn(a, k)}
      ${img ? `<div class="im"><img src="${wnEsc(img)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>` : ""}
      <div class="bd">${this._metaLine(a)}<h4>${wnEsc(a.title)}</h4>${a.desc ? `<p>${wnEsc(a.desc)}</p>` : ""}${this._tools(a, k)}</div></div>`;
  }

  _click(e) {
    const path = e.composedPath();
    const el = path.find((n) => n.dataset && (n.dataset.a || n.dataset.tab || n.dataset.open != null));
    if (!el) return;
    if (el.dataset.tab) { this._show(el.dataset.tab); return; }
    const a = el.dataset.a, item = this._list && this._list[+el.dataset.k];
    if (a === "refresh") { if (WN_CATS.some((c) => c.id === this._tab)) this._show(this._tab, true); else this._loadSaved(); return; }
    if (a === "add") { this._editor(null); return; }
    if (a === "fav" && item) { this._toggleFav(item); return; }
    if (a === "edit" && item) { this._editor(item); return; }
    if (a === "del" && item) { this._confirmDelete(item); return; }
    if (el.dataset.open != null && !a) {
      const it = this._list && this._list[+el.dataset.open];
      if (it && wnUrlOk(it.url)) window.open(it.url, "_blank", "noopener");
    }
  }

  async _call(service, data) {
    return this._hass.callService("todo", service, data, { entity_id: this._config.todo });
  }
  _payload(a) {
    return JSON.stringify({ url: a.url, desc: a.desc || "", img: a.img || "", pub: a.pub || "", date: a.date || 0, cat: a.cat || "",
      manual: !!a.manual, fav: !!a.fav, added: a.added || Date.now() });
  }

  async _toggleFav(a) {
    if (this._noStore) return;
    const key = wnNormUrl(a.url);
    if (this._busy.has(key)) return;
    this._busy.add(key);
    this._render();
    try {
      const s = a.manual ? a : this._savedFor(a.url);
      if (s && s.manual) await this._call("update_item", { item: s.uid, description: this._payload({ ...s, fav: !s.fav }) });
      else if (s) await this._call("remove_item", { item: s.uid });
      else await this._call("add_item", { item: wnClip(a.title, 250), description: this._payload({ ...a, manual: false, fav: true, added: Date.now() }) });
      await this._loadSaved();
    } catch (err) {
      this._toast(`Could not save: ${err.message || err}`);
    } finally {
      this._busy.delete(key);
      this._render();
    }
  }

  _toast(text) {
    const st = this.shadowRoot.querySelector(".status");
    st.textContent = text;
    st.classList.add("err");
  }

  _confirmDelete(a) {
    const d = this.shadowRoot.querySelector(".dlgs");
    d.innerHTML = `<div class="dlg noswipe"><div class="box"><h3>Delete this article?</h3>
      <div class="hint">“${wnEsc(a.title)}” will be removed from My articles on every device. This cannot be undone.</div>
      <div class="bact"><button class="btn" data-x="no">Cancel</button><button class="btn danger" data-x="yes"><ha-icon icon="mdi:delete-outline"></ha-icon>Delete</button></div></div></div>`;
    d.querySelector('[data-x="no"]').onclick = () => { d.innerHTML = ""; };
    d.querySelector(".dlg").onclick = (e) => { if (e.target.classList.contains("dlg")) d.innerHTML = ""; };
    d.querySelector('[data-x="yes"]').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try { await this._call("remove_item", { item: a.uid }); d.innerHTML = ""; await this._loadSaved(); }
      catch (err) { d.innerHTML = ""; this._toast(`Could not delete: ${err.message || err}`); }
    };
  }

  _editor(a) {
    if (this._noStore) { this._toast("Saving is not set up yet, so articles cannot be added."); return; }
    const d = this.shadowRoot.querySelector(".dlgs");
    const v = a || { url: "", title: "", desc: "", img: "", pub: "", date: 0, cat: "" };
    const dateVal = v.date ? new Date(v.date - new Date(v.date).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "";
    d.innerHTML = `<div class="dlg noswipe"><div class="box"><h3>${a ? "Edit article" : "Add an article"}</h3>
      <div class="hint">${a ? "Change any detail and save." : "Paste a link and the details are filled in for you where the site allows it. You can type or change anything."}</div>
      <label class="fld"><span>Link</span><div class="urlrow"><input name="url" type="url" inputmode="url" placeholder="https://…" value="${wnEsc(v.url)}">
        <button class="btn" data-x="fetch"><ha-icon icon="mdi:download-outline"></ha-icon>Fetch</button></div></label>
      <div class="note"></div>
      <label class="fld"><span>Headline</span><input name="title" value="${wnEsc(v.title)}"></label>
      <div class="two"><label class="fld"><span>Publisher</span><input name="pub" value="${wnEsc(v.pub)}"></label>
        <label class="fld"><span>Published</span><input name="date" type="date" value="${dateVal}"></label></div>
      <label class="fld"><span>Category</span><select name="cat"><option value="">None</option>${WN_CATS.filter((c) => c.id !== "top").map((c) => `<option value="${c.id}" ${v.cat === c.id ? "selected" : ""}>${c.name}</option>`).join("")}</select></label>
      <label class="fld"><span>Description</span><textarea name="desc">${wnEsc(v.desc)}</textarea></label>
      <label class="fld"><span>Image link (optional)</span><input name="img" type="url" value="${wnEsc(v.img)}"></label>
      <div class="prev" ${v.img ? "" : "hidden"}>${v.img ? `<img src="${wnEsc(v.img)}" alt="" referrerpolicy="no-referrer">` : ""}</div>
      <div class="bact"><button class="btn" data-x="cancel">Cancel</button><button class="btn pri" data-x="save"><ha-icon icon="mdi:check"></ha-icon>Save</button></div></div></div>`;
    const q = (n) => d.querySelector(`[name="${n}"]`), note = d.querySelector(".note");
    const say = (t, cls = "") => { note.textContent = t; note.className = `note ${cls}`; };
    const showImg = () => {
      const u = q("img").value.trim(), p = d.querySelector(".prev");
      p.hidden = !wnUrlOk(u);
      p.innerHTML = wnUrlOk(u) ? `<img src="${wnEsc(u)}" alt="" referrerpolicy="no-referrer">` : "";
    };
    q("img").addEventListener("change", showImg);
    d.querySelector('[data-x="cancel"]').onclick = () => { d.innerHTML = ""; };
    d.querySelector('[data-x="fetch"]').onclick = async (e) => {
      const url = q("url").value.trim();
      if (!/^https:\/\//i.test(url)) { say("Enter a full link starting with https://", "err"); return; }
      const btn = e.currentTarget; btn.disabled = true;
      say("Fetching the page details…");
      try {
        const m = await wnMeta(this._hass, url);
        if (m.title) q("title").value = m.title;
        if (m.pub) q("pub").value = m.pub;
        if (m.desc) q("desc").value = m.desc;
        if (m.img) { q("img").value = m.img; showImg(); }
        if (m.date) q("date").value = new Date(m.date - new Date(m.date).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        say(m.title ? "Details filled in. Check them and save." : "The page gave no details. Please fill them in.", m.title ? "ok" : "err");
      } catch (err) {
        say("This site could not be read automatically. Please fill in the details yourself.", "err");
      } finally { btn.disabled = false; }
    };
    d.querySelector('[data-x="save"]').onclick = async (e) => {
      const url = q("url").value.trim(), title = q("title").value.trim();
      if (!wnUrlOk(url)) { say("Enter a valid link (https://…).", "err"); return; }
      if (!title) { say("Enter a headline.", "err"); return; }
      const dup = this._savedFor(url);
      if (dup && (!a || dup.uid !== a.uid)) { say(dup.manual ? "That article is already in My articles." : "That story is already saved.", "err"); return; }
      const dv = q("date").value;
      const art = { url, title, pub: q("pub").value.trim() || wnPublisher(url), desc: q("desc").value.trim(), img: wnUrlOk(q("img").value.trim()) ? q("img").value.trim() : "",
        cat: q("cat").value, date: !dv ? 0 : a && dv === dateVal ? a.date : Date.parse(`${dv}T12:00:00`), manual: true, fav: a ? a.fav : false, added: a ? a.added : Date.now() };
      const btn = e.currentTarget; btn.disabled = true;
      try {
        if (a) await this._call("update_item", { item: a.uid, rename: wnClip(title, 250), description: this._payload(art) });
        else await this._call("add_item", { item: wnClip(title, 250), description: this._payload(art) });
        d.innerHTML = "";
        await this._loadSaved();
        if (!a) this._show("mine");
      } catch (err) {
        btn.disabled = false;
        say(`Could not save: ${err.message || err}`, "err");
      }
    };
  }
}

if (!customElements.get("glasshome-news-card")) customElements.define("glasshome-news-card", GlassHomeNewsCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "glasshome-news-card", name: "GlassHome News", description: "News reader: RSS headlines, saved stories and added articles (shared via a to-do list)." });
