// Responsive check for the preview (paste into the browser console, or run from an automation tool).
// Size the window first (or use the browser's device toolbar), then: await ghAll()
// It walks every view, every homepage page and every Settings tab and reports, from the rendered layout:
// cards wider than the screen, content spilling outside its card, overlapping cards, text cut off without
// "…", text under 10.5 px (chart and floor plan labels under 9 px), touch targets under 24 px, stretched
// camera pictures, sideways page scroll, controls left under a floating bar (navigation, demo label) after
// scrolling to the end, and script errors. ghWizardSteps() gives the setup wizard's steps (fresh-install
// preview: cookie ghcfg=none) for ghResp(steps) and ghCovered(steps).
window.ghResp = async function ghResp(views, opts = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const W = innerWidth, H = innerHeight;
  const errors = [];
  const onErr = (e) => errors.push(String((e.reason && e.reason.message) || e.message || e.reason).slice(0, 120));
  addEventListener("error", onErr); addEventListener("unhandledrejection", onErr);
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; const cs = getComputedStyle(el); return cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0 ? null : r; };
  const name = (root, el) => `${root.host ? root.host.localName.replace("glasshome-", "") : "doc"}>${el.localName}${typeof el.className === "string" && el.className ? "." + el.className.split(/\s+/)[0] : ""}`;
  const DECOR = /\b(cl|fog|sky|rain|snow|stars?|sun|moon|fx|bolt|glow|orb|bg|halo|ring|shine|blob|aurora|rainwrap|drops?|flake)\b/;
  // every element across shadow roots, with its root
  const all = (root = document, out = []) => { for (const el of root.querySelectorAll("*")) { out.push([root, el]); if (el.shadowRoot) all(el.shadowRoot, out); } return out; };
  // is the element inside a horizontally scrolling (intended) strip, or clipped by an ancestor on purpose
  const inScroller = (el) => { for (let p = el.parentElement || (el.getRootNode() && el.getRootNode().host); p; p = p.parentElement || (p.getRootNode && p.getRootNode().host)) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth + 1) return true; if (p.localName === "ha-card") return false; } return false; };
  async function inspect(label, scope) {
    const res = { offscreen: [], spill: [], overlap: [], clipped: [], tiny: [], small: [], cams: [] };
    const els = all(scope);
    // cards
    const cards = els.filter(([, el]) => el.localName === "ha-card").map(([root, el]) => [root, el, vis(el)]).filter((x) => x[2]);
    for (const [root, card, cr] of cards) {
      if (cr.right > W + 1 || cr.left < -1) res.offscreen.push(name(root, card));
    }
    // spill: descendants outside their card (decorative layers excluded)
    for (const [root, card, cr] of cards) {
      for (const el of card.querySelectorAll("*")) {
        const r = vis(el); if (!r) continue;
        const cls = typeof el.className === "string" ? el.className : "";
        if (DECOR.test(cls) || getComputedStyle(el).position === "fixed") continue;
        if ((r.right > cr.right + 3 || r.left < cr.left - 3) && !inScroller(el)) { res.spill.push(name(root, el)); break; }
      }
    }
    // overlap between sibling grid cells (sections and the homepage grid)
    const grids = els.filter(([, el]) => el.classList && (el.classList.contains("section") || el.classList.contains("grid") || el.id === "view"));
    for (const [root, g] of grids) {
      const kids = [...g.children].map((k) => [k, vis(k)]).filter((x) => x[1] && getComputedStyle(x[0]).position !== "absolute");
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i][1], b = kids[j][1];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 3 && oy > 3) res.overlap.push(`${name(root, kids[i][0])} x ${name(root, kids[j][0])}`);
      }
    }
    // clipped text: a text leaf cut off without an ellipsis
    for (const [root, el] of els) {
      if (!el.childNodes.length || [...el.childNodes].some((n) => n.nodeType === 1)) continue;
      const txt = (el.textContent || "").trim(); if (txt.length < 2) continue;
      const r = vis(el); if (!r) continue;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflow.includes("hidden") && cs.textOverflow !== "ellipsis" && el.clientWidth > 0) res.clipped.push(`${name(root, el)} "${txt.slice(0, 24)}"`);
      const svg = el.closest && el.closest("svg"); const vb = svg && svg.viewBox && svg.viewBox.baseVal; const fs = svg && vb && vb.width ? parseFloat(cs.fontSize) * svg.getBoundingClientRect().width / vb.width : parseFloat(cs.fontSize);
      if (svg && fs >= 8.95) continue;
      if (fs < 10.5) res.small.push(`${name(root, el)} ${fs}px "${txt.slice(0, 16)}"`);
    }
    // touch targets
    for (const [root, el] of els) {
      if (!(el.localName === "button" || el.localName === "a" || el.localName === "ha-icon-button" || el.getAttribute("role") === "button" || el.localName === "select" || (el.localName === "input" && el.type !== "hidden"))) continue;
      const r = vis(el); if (!r) continue;
      if (Math.min(r.width, r.height) < 24 && !(el.closest && el.closest("ha-icon-button"))) res.tiny.push(`${name(root, el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    // camera pictures keep their shape
    for (const [root, el] of els) {
      if (!(el.localName === "img" || el.localName === "video" || el.localName === "hui-image")) continue;
      if (!(root.host && /camera|chip/.test(root.host.localName))) continue;
      const r = vis(el); if (!r || el.localName === "hui-image") continue;
      const nw = el.naturalWidth || el.videoWidth, nh = el.naturalHeight || el.videoHeight;
      const fit = getComputedStyle(el).objectFit;
      if (nw && nh && fit === "fill" && Math.abs(r.width / r.height - nw / nh) > 0.05) res.cams.push(`${name(root, el)} ${(r.width / r.height).toFixed(2)} vs ${(nw / nh).toFixed(2)}`);
    }
    for (const k of Object.keys(res)) res[k] = [...new Set(res[k])].slice(0, 6);
    res.scrollX = document.documentElement.scrollWidth > W + 1;
    return res;
  }
  const out = { vp: `${W}x${H}`, views: {} };
  for (const v of views) {
    if (typeof v === "object") { await v.go(); await wait(v.wait || 700); out.views[v.label] = await inspect(v.label, document); continue; }
    history.pushState(null, "", `/glass-home/${v}`); dispatchEvent(new CustomEvent("location-changed"));
    await wait(opts.wait || 1100);
    const pager = document.querySelector("glasshome-pager-card");
    if (v === "home" && pager && pager._config) {
      const sr = pager.shadowRoot;
      for (let i = 0; i < pager._config.pages.length; i++) {
        pager._go(i, false); await wait(450);
        const page = sr.querySelectorAll(".page")[i];
        const r = await inspect(`home/${pager._config.pages[i].id}`, page);
        const grid = page.querySelector(".grid"), m = /matrix\(([\d.]+)/.exec(getComputedStyle(grid).transform);
        r.scale = m ? Number(m[1]).toFixed(2) : "1";
        r.pageScroll = page.scrollHeight > page.clientHeight + 2;
        r.gridW = Math.round(grid.getBoundingClientRect().width);
        const nav = sr.querySelector(".nav"); if (nav) { const nr = nav.getBoundingClientRect(); r.navOk = nr.left >= -1 && nr.right <= W + 1 && nr.bottom <= H + 1; }
        out.views[`home/${pager._config.pages[i].id}`] = r;
      }
    } else out.views[v] = await inspect(v, document);
  }
  out.errors = [...new Set(errors)];
  removeEventListener("error", onErr); removeEventListener("unhandledrejection", onErr);
  // compact form: only views with problems
  const bad = {};
  for (const [k, r] of Object.entries(out.views)) {
    const p = Object.fromEntries(Object.entries(r).filter(([key, val]) => (Array.isArray(val) ? val.length : (key === "scrollX" && val) || (key === "navOk" && val === false))));
    if (Object.keys(p).length) bad[k] = p;
    if (r.scale) (out.home = out.home || {})[k.slice(5)] = `${r.scale}${r.pageScroll ? "s" : ""}/${r.gridW}`;
  }
  return { vp: out.vp, home: out.home, problems: bad, errors: out.errors };
};

// steps that open each Settings tab, for ghResp
window.ghSettingsSteps = () => {
  const card = () => document.querySelector("glasshome-settings-card");
  const ids = ["profile","weather","connect","rooms","devices","personalise","features","bins","energy","media","plan","guides","advanced"];
  return [{ label: "settings", go: async () => { history.pushState(null, "", "/glass-home/settings"); dispatchEvent(new CustomEvent("location-changed")); await new Promise((r) => setTimeout(r, 1200)); } },
    ...ids.map((id) => ({ label: "settings/" + id, go: async () => { const b = card().shadowRoot.querySelector(`[data-tab="${id}"]`); if (b) b.click(); } }))];
};
// After scrolling every scroll area to its end: controls still under a floating bar (demo label, bottom
// navigation) cannot be reached. Returns { view: [control names] } for the given views (and home pages).
window.ghCovered = async function ghCovered(views) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deep = (root = document, out = []) => { for (const el of root.querySelectorAll("*")) { out.push(el); if (el.shadowRoot) deep(el.shadowRoot, out); } return out; };
  const res = {};
  const check = async (label) => {
    const els = deep();
    for (const el of els) { const cs = getComputedStyle(el); if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 2) el.scrollTop = 1e6; }
    document.scrollingElement.scrollTop = 1e6;
    await wait(350);
    const bars = els.filter((el) => { if (getComputedStyle(el).position !== "fixed" || el.getAttribute("role") === "status") return false; const r = el.getBoundingClientRect(); return r.height > 10 && r.height < 160 && r.bottom > innerHeight * 0.6 && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden"; })
      .map((el) => [el, el.getBoundingClientRect()]);
    const out = [];
    for (const el of els) {
      if (!(el.localName === "button" || el.localName === "select" || el.localName === "input" || el.localName === "a" || (el.localName === "label" && el.classList.contains("btn")) || el.localName === "ha-card")) continue;
      if (el.type === "file" || el.classList.contains("vh")) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.top > innerHeight + 1 || r.bottom < 0) continue;
      for (const [b, br] of bars) {
        if (b === el || b.contains(el) || (el.getRootNode().host && b.contains(el.getRootNode().host))) continue;
        let inside = false; for (let n = el; n; n = n.parentElement || (n.getRootNode && n.getRootNode().host)) if (n === b) { inside = true; break; }
        if (inside) continue;
        const oy = Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top), ox = Math.min(r.right, br.right) - Math.max(r.left, br.left);
        if (oy > 4 && ox > 4) out.push(`${(el.getRootNode().host || {}).localName || "doc"}>${el.localName}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""} under ${b.id || b.className}`);
      }
    }
    if (out.length) res[label] = [...new Set(out)].slice(0, 5);
  };
  for (const v of views) {
    if (typeof v === "object") { await v.go(); await wait(700); await check(v.label); continue; }
    history.pushState(null, "", `/glass-home/${v}`); dispatchEvent(new CustomEvent("location-changed")); await wait(1100);
    const pager = document.querySelector("glasshome-pager-card");
    if (v === "home" && pager && pager._config) { for (let i = 0; i < pager._config.pages.length; i++) { pager._go(i, false); await wait(450); await check("home/" + pager._config.pages[i].id); } }
    else await check(v);
  }
  return { vp: `${innerWidth}x${innerHeight}`, covered: res };
};
// steps that walk the setup wizard (fresh-install preview: cookie ghcfg=none)
window.ghWizardSteps = () => {
  const card = () => document.querySelector("glasshome-wizard-card");
  const steps = ["welcome", "profile", "weather", "connect", "rooms", "devices", "personalise", "features", "done"];
  return [{ label: "wizard/start", go: async () => { history.pushState(null, "", "/glass-home/welcome"); dispatchEvent(new CustomEvent("location-changed")); await new Promise((r) => setTimeout(r, 1500)); } },
    ...steps.map((st) => ({ label: "wizard/" + st, go: async () => { const c = card(); if (c && c._goStep) await c._goStep(st); } }))];
};
// one size, everything: views + settings tabs (layout) and the floating-bar check; compact summary
window.ghAll = async () => {
  const views = ["home","house","rooms","security","laundry","climate","lights","lights-scenes","lights-schedules","media","news","welcome","setup"];
  const a = await ghResp([...views, ...ghSettingsSteps()]);
  const b = await ghCovered([...views, ...ghSettingsSteps()]);
  const probs = {};
  for (const [k, v] of Object.entries(a.problems)) { const keep = {}; for (const [kk, vv] of Object.entries(v)) { const f = Array.isArray(vv) ? vv.filter((x) => !/gh-mock-card|bin-card>b$/.test(x)) : vv; if (Array.isArray(f) ? f.length : f) keep[kk] = f; } if (Object.keys(keep).length) probs[k] = keep; }
  const cov = Object.fromEntries(Object.entries(b.covered).map(([k, v]) => [k, v.filter((x) => !/gh-mock-card/.test(x))]).filter(([, v]) => v.length));
  return { vp: a.vp, home: Object.values(a.home || {}).join(" "), problems: probs, covered: cov, errors: a.errors };
};
