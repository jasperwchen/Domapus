// Static landing pages, one per metro and per state, plus sitemap.xml. Runs from the Vite
// build (writeBundle), so it sees the same base path as the app, PR previews included, and
// regenerates whenever Deploy rebuilds after a data release.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const SITE_ORIGIN = "https://jasperwchen.github.io";
// A metro page needs this many ZIPs with data. Fewer reads as filler to a search engine.
export const MIN_METRO_ZIPS = 10;
// Ranked lists need enough reliably sampled ZIPs for five up and five down without overlap.
const MIN_RANKED = 10;

const STATE_NAMES = {
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado",
  CT: "Connecticut", DC: "District of Columbia", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine",
  MI: "Michigan", MN: "Minnesota", MO: "Missouri", MS: "Mississippi", MT: "Montana",
  NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VA: "Virginia", VI: "U.S. Virgin Islands", VT: "Vermont", WA: "Washington",
  WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
};

export function slugify(name) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const monthLabel = (iso) => iso
  ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
  : "";

/** The same month a year earlier, for "From October 2025 to October 2026". */
const yearBefore = (iso) => iso ? `${+iso.slice(0, 4) - 1}${iso.slice(4, 7)}-01` : "";

const usd = (v) => v == null ? "" : `$${Math.round(v).toLocaleString("en-US")}`;
const pct = (v) => {
  if (v == null) return "";
  const t = `${Math.abs(v).toFixed(1)}%`;
  if (t === "0.0%") return t;
  return v > 0 ? `<span class="up">&#9650; ${t}</span>` : `<span class="dn">&#9660; ${t}</span>`;
};

/** The snapshot's columns decoded into one plain object per ZIP. Wire format: src/lib/snapshot.ts. */
export function decodeSnapshot(snap) {
  const col = (name) => {
    const j = snap.f.indexOf(name);
    if (j < 0) throw new Error(`snapshot has no ${name} column`);
    const scale = snap.scales[name] ?? 1;
    const dict = snap.dicts[name];
    return (i) => {
      const raw = snap.d[j][i];
      if (raw === snap.null_sentinel) return null;
      return dict ? dict[raw] ?? null : raw / scale;
    };
  };
  const get = Object.fromEntries(
    ["st", "ci", "me", "lat", "lng", "bw", "bs", "be", "bn", "zhvi", "zhvi_yoy", "msp", "msp_yoy", "dom", "rel", "hs"]
      .map((n) => [n, col(n)]),
  );
  return snap.z.map((zip, i) => {
    const r = { zip };
    for (const [n, g] of Object.entries(get)) r[n] = g(i);
    return r;
  });
}

const hasData = (r) => r.zhvi != null || r.msp != null;

/** Centre and zoom that fit the ZIPs' polygon bounds into a w x h map. */
export function viewOf(rows, w = 800, h = 450) {
  let W = Infinity, S = Infinity, E = -Infinity, N = -Infinity;
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const box = r.bw != null && r.bs != null && r.be != null && r.bn != null
      ? [r.lng + r.bw, r.lat + r.bs, r.lng + r.be, r.lat + r.bn]
      : [r.lng, r.lat, r.lng, r.lat];
    W = Math.min(W, box[0]); S = Math.min(S, box[1]); E = Math.max(E, box[2]); N = Math.max(N, box[3]);
  }
  if (!Number.isFinite(W)) return null;
  const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const zx = Math.log2((w / 256) * (360 / Math.max(E - W, 1e-3)));
  const zy = Math.log2((h / 256) * ((2 * Math.PI) / Math.max(merc(N) - merc(S), 1e-5)));
  const zoom = Math.min(12, Math.max(3, Math.min(zx, zy) - 0.2));
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((merc(N) + merc(S)) / 2)) - Math.PI / 2);
  return { lat: +lat.toFixed(4), lng: +((W + E) / 2).toFixed(4), zoom: +zoom.toFixed(1) };
}

// Ranked by ZHVI change: sale-price change ranked the noise (92% of ZIPs within 2 standard
// errors of zero, and Denver's top "riser" was a mix shift while its ZHVI fell). Still only
// rankable ZIPs: thin-market ZHVI is wider too (p1-p99 of -12% to +16% against -6% to +10%),
// and those ZIPs filled the extremes.
function ranked(rows) {
  const ok = rows.filter((r) => r.rel >= 1 && r.zhvi_yoy != null);
  if (ok.length < MIN_RANKED) return null;
  ok.sort((a, b) => b.zhvi_yoy - a.zhvi_yoy || a.zip.localeCompare(b.zip));
  return { rising: ok.slice(0, 5), falling: ok.slice(-5).reverse(), n: ok.length };
}

const mostCommon = (values) => {
  const n = new Map();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
};

/** The metros that get a page. The app's panel links from this same list (vite.config.ts). */
function selectMetros(rows) {
  const metroRows = new Map();
  for (const r of rows) {
    if (r.me) (metroRows.get(r.me) ?? metroRows.set(r.me, []).get(r.me)).push(r);
  }
  const metros = [...metroRows]
    .filter(([, zs]) => zs.length >= MIN_METRO_ZIPS)
    .map(([name, zs]) => ({
      name, slug: slugify(name), rows: zs,
      state: mostCommon(zs.map((r) => r.st)),
      states: [...new Set(zs.map((r) => r.st).filter(Boolean))].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const slugs = new Map();
  for (const m of metros) {
    if (slugs.has(m.slug)) throw new Error(`metro slug collision: ${slugs.get(m.slug)} and ${m.name}`);
    slugs.set(m.slug, m.name);
  }
  return metros;
}

/** Metro name to page slug, for every metro that has a page. */
export function metroPageSlugs(snapshot) {
  return Object.fromEntries(selectMetros(decodeSnapshot(snapshot).filter(hasData)).map((m) => [m.name, m.slug]));
}

/** Every page as { path, title, html }, keyed by its path below the base. */
export function buildPages(snapshot, manifest, base) {
  const rows = decodeSnapshot(snapshot).filter(hasData);
  const ctx = {
    base,
    salesPeriod: monthLabel(snapshot.period_end),
    zhviMonth: monthLabel(snapshot.zhvi_month),
    zhviYearBefore: monthLabel(yearBefore(snapshot.zhvi_month)),
    released: (manifest.generated_utc ?? snapshot.built_utc ?? "").slice(0, 10),
  };

  const metros = selectMetros(rows);
  const stateRows = new Map();
  for (const r of rows) {
    if (r.st) (stateRows.get(r.st) ?? stateRows.set(r.st, []).get(r.st)).push(r);
  }

  const states = [...stateRows]
    .filter(([code]) => STATE_NAMES[code])
    .map(([code, zs]) => ({
      code, name: STATE_NAMES[code], rows: zs,
      metros: metros.filter((m) => m.states.includes(code)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stateByCode = new Map(states.map((s) => [s.code, s]));

  const pages = [];
  for (const m of metros) {
    pages.push({ path: `metro/${m.slug}/`, title: m.name, html: metroPage(m, stateByCode, ctx) });
  }
  for (const s of states) {
    pages.push({ path: `state/${s.code.toLowerCase()}/`, title: s.name, html: statePage(s, ctx) });
  }
  pages.push({ path: "places/", title: "All places", html: hubPage(states, ctx) });
  return { pages, metros, states, released: ctx.released };
}

export function sitemap(pages, released, origin = SITE_ORIGIN, base = "/Domapus/") {
  const urls = ["", "methodology/", ...pages.map((p) => p.path)];
  const lastmod = released ? `<lastmod>${released}</lastmod>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(origin + base + u)}</loc>${lastmod}</url>`).join("\n")}
</urlset>
`;
}

function mapLinks(rows, ctx) {
  const v = viewOf(rows);
  if (!v) return { iframe: "", link: ctx.base };
  const q = `metric=zhvi&lat=${v.lat}&lng=${v.lng}&zoom=${v.zoom}`;
  return {
    link: `${ctx.base}?${q}`,
    iframe: `<iframe src="${esc(`${ctx.base}?embed=1&${q}`)}" loading="lazy" title="Map of Zillow home values by ZIP code"></iframe>`,
  };
}

function rankedLists(rows, ctx) {
  const r = ranked(rows);
  if (!r) return "";
  const li = (z) => `<li><a href="${esc(`${ctx.base}?zip=${z.zip}&metric=zhvi`)}">${z.zip}</a>${z.ci ? ` ${esc(z.ci)}` : ""}: ${pct(z.zhvi_yoy)}</li>`;
  return `<section>
<h2>Home values rising and falling fastest</h2>
<p>Change in the Zillow Home Value Index over the year to ${esc(ctx.zhviMonth)}, among the ${r.n} ZIP codes with enough sales to rank.</p>
<div class="cols">
<div><h3>Rising</h3><ol>${r.rising.map(li).join("")}</ol></div>
<div><h3>Falling</h3><ol>${r.falling.map(li).join("")}</ol></div>
</div>
</section>`;
}

function summary(name, rows, ctx) {
  const zv = rows.filter((r) => r.zhvi_yoy != null);
  const up = zv.filter((r) => r.zhvi_yoy > 0).length;
  const down = zv.filter((r) => r.zhvi_yoy < 0).length;
  const sales = rows.filter((r) => r.msp != null).length;
  const n = (v) => v.toLocaleString("en-US");
  const total = `${name} has a total of ${n(rows.length)} ZIP codes with housing data`;
  const parts = [sales
    ? `${total}, ${n(sales)} of them with Redfin sales data for the three months ending ${ctx.salesPeriod}.`
    : `${total}.`];
  if (zv.length) {
    parts.push(`From ${ctx.zhviYearBefore} to ${ctx.zhviMonth}, the Zillow Home Value Index increased in ${n(up)} ZIP codes and decreased in ${n(down)}.`);
  }
  return parts.join(" ");
}

function zipTable(rows, ctx) {
  const sorted = [...rows].sort((a, b) => a.zip.localeCompare(b.zip));
  const tr = (r) => `<tr><td><a href="${esc(`${ctx.base}?zip=${r.zip}`)}">${r.zip}</a></td><td>${esc(r.ci ?? "")}</td>`
    + `<td>${usd(r.zhvi)}</td><td>${pct(r.zhvi_yoy)}</td>`
    + `<td>${usd(r.msp)}${r.msp != null && !(r.rel >= 1) ? "*" : ""}</td><td>${r.dom ?? ""}</td></tr>`;
  return `<section>
<h2>Every ZIP code</h2>
<div class="scroll"><table>
<thead><tr><th>ZIP</th><th>City</th><th>Home value</th><th>1-year change</th><th>Median sale price</th><th>Days on market</th></tr></thead>
<tbody>${sorted.map(tr).join("\n")}</tbody>
</table></div>
<p class="note">Home value is the Zillow Home Value Index for ${esc(ctx.zhviMonth)}. Sale price and days on market are Redfin medians over the three months ending ${esc(ctx.salesPeriod)}.</p>
<p class="note">* Too few sales for a reliable median.</p>
</section>`;
}

function metroPage(m, stateByCode, ctx) {
  const map = mapLinks(m.rows, ctx);
  const home = stateByCode.get(m.state);
  const siblings = home ? home.metros.filter((x) => x !== m) : [];
  const stateLinks = m.states.filter((c) => stateByCode.has(c))
    .map((c) => `<a href="${ctx.base}state/${c.toLowerCase()}/">${esc(stateByCode.get(c).name)}</a>`).join(", ");
  const title = `${m.name} housing market by ZIP code, ${ctx.zhviMonth}`;
  const body = `<p class="lede">${esc(summary(m.name, m.rows, ctx))}</p>
<div class="map">${map.iframe}</div>
<p><a class="cta" href="${esc(map.link)}" target="_blank" rel="noopener">Open the full map</a></p>
${rankedLists(m.rows, ctx)}
${zipTable(m.rows, ctx)}
<section><h2>Nearby</h2>
${stateLinks ? `<p>State: ${stateLinks}</p>` : ""}
${siblings.length ? `<p>Other metros in ${esc(home.name)}: ${siblings.map((x) => `<a href="${ctx.base}metro/${x.slug}/">${esc(x.name)}</a>`).join(", ")}</p>` : ""}
</section>`;
  const crumbs = [...HUB, ...(home ? [[home.name, `state/${home.code.toLowerCase()}/`]] : []), [m.name, `metro/${m.slug}/`]];
  return page({ ctx, path: `metro/${m.slug}/`, title, place: m.name, description: summary(m.name, m.rows, ctx), body, crumbs });
}

function statePage(s, ctx) {
  const map = mapLinks(s.rows, ctx);
  const title = `${s.name} housing market by ZIP code, ${ctx.zhviMonth}`;
  const metroList = s.metros.length
    ? `<section><h2>Metro areas</h2><ul class="metros">${s.metros.map((m) =>
      `<li><a href="${ctx.base}metro/${m.slug}/">${esc(m.name)}</a> <span class="note">${m.rows.filter((r) => r.st === s.code).length} ZIP codes</span></li>`).join("")}</ul></section>`
    : "";
  const body = `<p class="lede">${esc(summary(s.name, s.rows, ctx))}</p>
<div class="map">${map.iframe}</div>
<p><a class="cta" href="${esc(map.link)}" target="_blank" rel="noopener">Open the full map</a></p>
${rankedLists(s.rows, ctx)}
${metroList}`;
  const crumbs = [...HUB, [s.name, `state/${s.code.toLowerCase()}/`]];
  return page({ ctx, path: `state/${s.code.toLowerCase()}/`, title, place: s.name, description: summary(s.name, s.rows, ctx), body, crumbs });
}

const HUB = [["Domapus", ""], ["All places", "places/"]];

/** The one page that links every state and metro page, so they are reachable without the sitemap. */
function hubPage(states, ctx) {
  const metros = new Set(states.flatMap((s) => s.metros)).size;
  const title = "Housing market by state and metro area";
  const description = `ZIP code home values and sales for every state, D.C. and ${metros} metro areas, from Redfin and Zillow, updated monthly.`;
  // Each link carries its size and kind, so the search reads its list from the page.
  const body = `<p class="lede">${esc(description)} A metro area is listed when at least ${MIN_METRO_ZIPS} of its ZIP codes have data.</p>
${SEARCH}
${states.map((s) => `<section><h2><a href="${ctx.base}state/${s.code.toLowerCase()}/" data-s="${sold(s.rows)}" data-k="State">${esc(s.name)}</a></h2>${s.metros.length
    ? `<ul class="metros">${s.metros.map((m) => `<li><a href="${ctx.base}metro/${m.slug}/" data-s="${sold(m.rows)}" data-k="Metro">${esc(m.name)}</a></li>`).join("")}</ul>`
    : ""}</section>`).join("\n")}`;
  return page({ ctx, path: "places/", title, place: "United States", description, body, crumbs: HUB });
}

// Bigger markets first, by homes sold, as the export's metro search ranks them: ZIP count
// put Pittsburgh above Chicago because Pennsylvania cuts its metros into small ZIPs.
const sold = (rows) => Math.round(rows.reduce((t, r) => t + (r.hs ?? 0), 0));

// A metro is listed under every state it touches, so the script keeps one entry per page.
const SEARCH = `<div class="search">
<input id="q" type="search" placeholder="Search states and metro areas" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="q-list" aria-autocomplete="list" aria-label="Search states and metro areas">
<div id="q-list" role="listbox" aria-label="States and metro areas" hidden></div>
</div>
<script>(() => {
  const q = document.getElementById("q"), box = document.getElementById("q-list");
  // Read on first use: this script runs before the links below it are parsed.
  let items = null, shown = [], act = 0;
  const read = () => {
    const seen = new Set();
    items = [];
    for (const a of document.querySelectorAll("a[data-s]")) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      items.push({ n: a.textContent, l: a.textContent.toLowerCase(), u: a.href, s: +a.dataset.s, k: a.dataset.k });
    }
  };
  const close = () => { box.hidden = true; q.setAttribute("aria-expanded", "false"); q.removeAttribute("aria-activedescendant"); };
  const mark = () => {
    box.querySelectorAll("[role=option]").forEach((o, j) => o.setAttribute("aria-selected", j === act));
    const o = document.getElementById("q-" + act);
    if (o) { q.setAttribute("aria-activedescendant", o.id); o.scrollIntoView({ block: "nearest" }); }
  };
  const draw = () => {
    if (!items) read();
    const t = q.value.trim().toLowerCase();
    shown = items.filter((i) => i.l.includes(t))
      .sort((a, b) => (t ? a.l.indexOf(t) - b.l.indexOf(t) : 0) || b.s - a.s || a.n.localeCompare(b.n));
    act = 0;
    box.replaceChildren(...(shown.length ? shown.map((i, j) => {
      const o = document.createElement("a");
      o.href = i.u; o.id = "q-" + j; o.tabIndex = -1;
      o.setAttribute("role", "option");
      o.textContent = i.n;
      const k = document.createElement("span");
      k.textContent = i.k;
      o.append(k);
      o.onmouseenter = () => { act = j; mark(); };
      return o;
    }) : [Object.assign(document.createElement("p"), { textContent: "No states or metro areas match." })]));
    box.hidden = false;
    q.setAttribute("aria-expanded", "true");
    mark();
  };
  q.addEventListener("input", draw);
  q.addEventListener("focus", draw);
  q.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return close();
    if (box.hidden || !shown.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      act = (act + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      mark();
    } else if (e.key === "Enter") {
      e.preventDefault();
      location.href = shown[act].u;
    }
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest(".search")) close(); });
})();</script>`;

const icon = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  map: icon('<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>'),
  book: icon('<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>'),
  list: icon('<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>'),
  github: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>',
};

/** The app's top bar (TopBarShell in src/components/dashboard/TopBar.tsx) as static markup.
 *  Change the two together, so every page keeps the same way back to the map.
 *  Never change the subtitle ("Housing Market Analysis"), on any page. */
function topBar(base, hub) {
  return `<header class="top">
<a class="brand" href="${base}" title="Reset the map"><img src="${base}Logo.svg" alt="Domapus Logo" width="40" height="40"><span><b>Domapus</b><small>Housing Market Analysis</small></span></a>
<nav class="links">
<a class="btn" href="${base}" title="Map">${ICONS.map}<span>Map</span></a>
<a class="btn" href="${base}methodology/" title="Methodology">${ICONS.book}<span>Methodology</span></a>
${hub ? "" : `<a class="btn" href="${base}places/" title="Places">${ICONS.list}<span>Places</span></a>
`}<a class="btn" href="https://github.com/jasperwchen/Domapus" title="GitHub" aria-label="GitHub (opens in a new tab)" target="_blank" rel="noopener noreferrer">${ICONS.github}<span>GitHub</span></a>
</nav>
</header>`;
}

function page({ ctx, path: rel, title, place, description, body, crumbs }) {
  const url = SITE_ORIGIN + ctx.base + rel;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        // Not a Dataset: the figures are Redfin and Zillow data, which this
        // project cannot license or offer as its own download.
        "@type": "WebPage",
        name: title,
        description,
        url,
        about: { "@type": "Place", name: place },
        isPartOf: { "@type": "WebApplication", name: "Domapus", url: SITE_ORIGIN + ctx.base },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: SITE_ORIGIN + ctx.base + p })),
      },
    ],
  };
  const nav = crumbs.map(([name, p], i) => i === crumbs.length - 1
    ? `<span>${esc(name)}</span>` : `<a href="${ctx.base}${p}">${esc(name)}</a>`).join(" / ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({"gtm.start":new Date().getTime(),event:"gtm.js"});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src="https://www.googletagmanager.com/gtm.js?id="+i;f.parentNode.insertBefore(j,f);})(window,document,"script","dataLayer","GTM-PNP9L5ZD");</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | Domapus</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="${ctx.base}favicon.ico">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE_ORIGIN}${ctx.base}preview.png">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>
:root{color-scheme:light;--bg:hsl(210 20% 98%);--card:#fff;--fg:hsl(222.2 84% 4.9%);--muted:hsl(215.4 16.3% 46.9%);--line:hsl(214.3 31.8% 91.4%);--accent:hsl(221.2 83.2% 53.3%);--panel:hsl(210 40% 96%);--up:#15803d;--dn:#dc2626}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}a{color:var(--accent)}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;height:56px;padding:8px 12px;background:var(--card);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;min-width:0;color:var(--fg);text-decoration:none;font-family:Inter,sans-serif}.brand:hover{opacity:.8}
.brand img{width:32px;height:32px;flex-shrink:0}.brand span{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.brand b{font-size:16px}.brand small{display:none;font-size:12px;color:var(--muted)}
.links{display:flex;gap:6px;flex-shrink:0}
.btn{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:6px;background:hsl(210 40% 98%);color:var(--fg);font-size:14px;font-weight:500;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--panel)}.btn span{display:none}
@media (min-width:640px){.top{height:64px;padding:8px 20px}.brand img{width:36px;height:36px}.brand small{display:block}}
@media (min-width:1280px){.btn span{display:inline}}
.search{position:relative;max-width:480px;margin:16px 0 8px}
#q{width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);font:inherit;font-size:15px}
#q-list{position:absolute;z-index:10;left:0;right:0;margin-top:4px;max-height:300px;overflow-y:auto;padding:4px;background:var(--card);border:1px solid var(--line);border-radius:6px;box-shadow:0 4px 12px rgb(0 0 0/.08)}
#q-list a{display:flex;justify-content:space-between;gap:12px;padding:6px 8px;border-radius:4px;color:var(--fg);text-decoration:none;font-size:14px}
#q-list a[aria-selected=true]{background:var(--panel)}#q-list span{color:var(--muted);font-size:12px}#q-list p{margin:16px;text-align:center;color:var(--muted);font-size:14px}
.crumbs{font-size:14px;color:var(--muted);margin:8px 0 0}h1{font-size:28px;line-height:1.2;margin:8px 0 12px}
h2{font-size:20px;margin:32px 0 8px}h3{font-size:16px;margin:8px 0}.lede{font-size:17px}
.map iframe{width:100%;height:450px;border:1px solid var(--line);border-radius:8px}
.cta{display:inline-block;padding:8px 14px;border-radius:6px;background:var(--accent);color:var(--bg);text-decoration:none;font-weight:600}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:nth-child(-n+2),td:nth-child(-n+2){text-align:left}th{background:var(--panel);position:sticky;top:0}
.note{color:var(--muted);font-size:13px}.up{color:var(--up)}.dn{color:var(--dn)}.metros{columns:2 240px;padding-left:18px}
footer{max-width:960px;margin:32px auto;padding:16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
</style>
</head>
<body>
${topBar(ctx.base, rel === "places/")}
<main>
<p class="crumbs">${nav}</p>
<h1>${esc(title)}</h1>
${body}
</main>
<footer>Data from Redfin and Zillow, updated monthly. Release ${esc(ctx.released)}. <a href="${ctx.base}places/">All states and metros</a>. <a href="${ctx.base}methodology/">How the numbers are made</a>.</footer>
</body>
</html>
`;
}

/**
 * The app shell again at methodology/index.html. GitHub Pages had no file there and answered
 * 404, so crawlers dropped the page although the bounce showed it to people. The copy carries
 * the page's own title and canonical; index.html's boot script already skips the map there.
 */
export function methodologyShell(indexHtml, base) {
  const url = `${SITE_ORIGIN}${base}methodology/`;
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, "<title>Methodology | Domapus</title>")
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`);
}

/** Writes every page and sitemap.xml under outDir. Reads the committed snapshot and manifest. */
export async function writePages(outDir, base, dataDir = "public/data") {
  const [snapshot, manifest] = await Promise.all([
    readFile(path.join(dataDir, "zip-data.json"), "utf8").then(JSON.parse),
    readFile(path.join(dataDir, "manifest.json"), "utf8").then(JSON.parse),
  ]);
  const { pages, released } = buildPages(snapshot, manifest, base);
  for (const p of pages) {
    const dir = path.join(outDir, p.path);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), p.html);
  }
  await writeFile(path.join(outDir, "sitemap.xml"), sitemap(pages, released, SITE_ORIGIN, base));
  const shell = await readFile(path.join(outDir, "index.html"), "utf8");
  await mkdir(path.join(outDir, "methodology"), { recursive: true });
  await writeFile(path.join(outDir, "methodology", "index.html"), methodologyShell(shell, base));
  return pages.length;
}

