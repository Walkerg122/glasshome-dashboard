// Layout check for the preview (paste into the browser console, or run from an automation tool).
// For every homepage page and every sections view it reports: cards wider than the screen, content
// spilling outside its card, horizontal page scroll, and script errors. Returns a summary object.
window.ghLayoutCheck = async function ghLayoutCheck() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  const onErr = (e) => errors.push(String((e.reason && e.reason.message) || e.message || e.reason));
  window.addEventListener("error", onErr);
  window.addEventListener("unhandledrejection", onErr);
  const W = innerWidth;
  const spill = (root, found = []) => {
    for (const card of root.querySelectorAll("ha-card")) {
      const cr = card.getBoundingClientRect();
      if (!cr.width) continue;
      for (const el of card.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (!r.width || getComputedStyle(el).visibility === "hidden") continue;
        if ((r.right > cr.right + 3 || r.left < cr.left - 3) && !/\b(cl|fog|sky|rain|snow|stars?|sun|moon|fx|bolt)\b/.test(typeof el.className === "string" ? el.className : "")) { found.push(`${root.host ? root.host.localName : "doc"} > ${el.localName}.${el.className || ""}`.slice(0, 90)); break; }
      }
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) spill(el.shadowRoot, found);
    return found;
  };
  const report = { viewport: `${W}x${innerHeight}`, pages: {}, views: {} };
  const pager = document.querySelector("glasshome-pager-card");
  if (pager) {
    const sr = pager.shadowRoot;
    const ids = pager._config.pages.map((p) => p.id);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      pager._go(i, false);
      await wait(500);
      const vis = sr.querySelectorAll(".page")[i];
      if (!vis || Math.abs(vis.getBoundingClientRect().left) > 4) { report.pages[id] = "not shown"; continue; }
      const cells = [...vis.querySelectorAll(".grid > div")].filter((c) => c.getClientRects().length && !c.classList.contains("guide"));
      const off = cells.filter((c) => { const r = c.getBoundingClientRect(); return r.right > W + 1 || r.left < -1; }).length;
      const grid = vis.querySelector(".grid");
      const m = /matrix\(([\d.]+)/.exec(getComputedStyle(grid).transform);
      report.pages[id] = { cards: cells.length, offscreen: off, scale: m ? Number(m[1]).toFixed(2) : "1.00", scrolls: vis.scrollHeight > vis.clientHeight + 2,
        spill: spill(vis).slice(0, 4) };
    }
  }
  report.pageScrollX = document.documentElement.scrollWidth > W + 1;
  report.errors = [...new Set(errors)];
  window.removeEventListener("error", onErr);
  window.removeEventListener("unhandledrejection", onErr);
  return report;
};
window.ghSpillCheck = async function ghSpillCheck() {
  await new Promise((r) => setTimeout(r, 1200));
  const W = innerWidth, out = [];
  const walk = (root) => {
    for (const card of root.querySelectorAll("ha-card")) {
      const cr = card.getBoundingClientRect();
      if (!cr.width) continue;
      if (cr.right > W + 1) out.push(`${root.host ? root.host.localName : "doc"} wider than screen`);
      for (const el of card.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > cr.right + 3 || r.left < cr.left - 3)) { out.push(`${root.host ? root.host.localName : "doc"} > ${el.localName}.${el.className || ""}`.slice(0, 90)); break; }
      }
    }
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
  };
  walk(document);
  return { viewport: `${W}x${innerHeight}`, path: location.pathname, pageScrollX: document.documentElement.scrollWidth > W + 1, spill: [...new Set(out)].slice(0, 8) };
};
