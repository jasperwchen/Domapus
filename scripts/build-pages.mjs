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
    ["st", "ci", "me", "lat", "lng", "bw", "bs", "be", "bn", "zhvi", "zhvi_yoy", "msp", "msp_yoy", "dom", "rel"]
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

/** Every page as { path, title, html }, keyed by its path below the base. */
export function buildPages(snapshot, manifest, base) {
  const rows = decodeSnapshot(snapshot).filter(hasData);
  const ctx = {
    base,
    salesPeriod: monthLabel(snapshot.period_end),
    zhviMonth: monthLabel(snapshot.zhvi_month),
    released: (manifest.generated_utc ?? snapshot.built_utc ?? "").slice(0, 10),
  };

  const metroRows = new Map();
  const stateRows = new Map();
  for (const r of rows) {
    if (r.me) (metroRows.get(r.me) ?? metroRows.set(r.me, []).get(r.me)).push(r);
    if (r.st) (stateRows.get(r.st) ?? stateRows.set(r.st, []).get(r.st)).push(r);
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
  const parts = [`${name} has ${rows.length.toLocaleString("en-US")} ZIP codes with housing data.`];
  if (zv.length) {
    parts.push(`Over the year to ${ctx.zhviMonth}, the Zillow Home Value Index rose in ${up.toLocaleString("en-US")} of them and fell in ${down.toLocaleString("en-US")}.`);
  }
  if (sales) {
    parts.push(`Redfin reports a median sale price for ${sales.toLocaleString("en-US")} ZIP codes over the three months ending ${ctx.salesPeriod}.`);
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
<p class="note">Home value is the Zillow Home Value Index for ${esc(ctx.zhviMonth)}. Sale price and days on market are Redfin medians over the three months ending ${esc(ctx.salesPeriod)}. * Too few sales for a reliable median.</p>
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
<p><a class="cta" href="${esc(map.link)}">Open the full map</a></p>
${rankedLists(m.rows, ctx)}
${zipTable(m.rows, ctx)}
<section><h2>Nearby</h2>
${stateLinks ? `<p>State: ${stateLinks}</p>` : ""}
${siblings.length ? `<p>Other metros in ${esc(home.name)}: ${siblings.map((x) => `<a href="${ctx.base}metro/${x.slug}/">${esc(x.name)}</a>`).join(", ")}</p>` : ""}
</section>`;
  const crumbs = [["Domapus", ""], ...(home ? [[home.name, `state/${home.code.toLowerCase()}/`]] : []), [m.name, `metro/${m.slug}/`]];
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
<p><a class="cta" href="${esc(map.link)}">Open the full map</a></p>
${rankedLists(s.rows, ctx)}
${metroList}`;
  const crumbs = [["Domapus", ""], [s.name, `state/${s.code.toLowerCase()}/`]];
  return page({ ctx, path: `state/${s.code.toLowerCase()}/`, title, place: s.name, description: summary(s.name, s.rows, ctx), body, crumbs });
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
:root{--bg:#fff;--fg:#1a1f2b;--muted:#5b6475;--line:#e3e6ec;--accent:#1d4ed8;--panel:#f6f7f9}
@media (prefers-color-scheme:dark){:root{--bg:#11141a;--fg:#e6e8ec;--muted:#9aa3b2;--line:#2a303b;--accent:#7aa2ff;--panel:#181c24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:16px}a{color:var(--accent)}
header{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line)}
header a{color:var(--fg);font-weight:600;text-decoration:none;display:flex;align-items:center;gap:8px}
.crumbs{font-size:14px;color:var(--muted);margin:8px 0 0}h1{font-size:28px;line-height:1.2;margin:8px 0 12px}
h2{font-size:20px;margin:32px 0 8px}h3{font-size:16px;margin:8px 0}.lede{font-size:17px}
.map iframe{width:100%;height:450px;border:1px solid var(--line);border-radius:8px}
.cta{display:inline-block;padding:8px 14px;border-radius:6px;background:var(--accent);color:var(--bg);text-decoration:none;font-weight:600}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:14px;font-variant-numeric:tabular-nums}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:nth-child(-n+2),td:nth-child(-n+2){text-align:left}th{background:var(--panel);position:sticky;top:0}
.note{color:var(--muted);font-size:13px}.metros{columns:2 240px;padding-left:18px}
footer{max-width:960px;margin:32px auto;padding:16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
</style>
</head>
<body>
<header><a href="${ctx.base}"><img src="${ctx.base}Logo.svg" alt="" width="24" height="24">Domapus</a></header>
<main>
<p class="crumbs">${nav}</p>
<h1>${esc(title)}</h1>
${body}
</main>
<footer>Data from Redfin and Zillow, updated monthly. Release ${esc(ctx.released)}. <a href="${ctx.base}methodology/">How the numbers are made</a>.</footer>
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

