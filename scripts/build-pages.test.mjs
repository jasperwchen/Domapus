import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPages, sitemap, slugify, viewOf, methodologyShell, MIN_METRO_ZIPS } from "./build-pages.mjs";
import { readFileSync } from "node:fs";

const S = -2147483648;

// n ZIPs in metro "Denver, CO" plus one small metro and one ZIP with no metro.
function fixture(n) {
  const z = [], st = [], me = [], zhvi = [], yoy = [], msp = [], msp_yoy = [], rel = [];
  for (let i = 0; i < n + 3; i++) {
    z.push(String(80000 + i));
    st.push(1);
    me.push(i < n ? 0 : i < n + 2 ? 1 : S);
    zhvi.push(500000 + i * 1000);
    yoy.push(i % 2 ? 250 : -100);
    msp.push(600000);
    msp_yoy.push(i * 10);
    rel.push(1);
  }
  const cols = { st, ci: z.map(() => 0), me, lat: z.map(() => 3970000), lng: z.map(() => -10500000),
    bw: z.map(() => -100), bs: z.map(() => -100), be: z.map(() => 100), bn: z.map(() => 100),
    zhvi, zhvi_yoy: yoy, msp, msp_yoy, dom: z.map(() => 30), rel };
  return {
    f: Object.keys(cols), d: Object.values(cols), z, null_sentinel: S,
    dicts: { st: ["AL", "CO"], ci: ["Denver"], me: ["Denver, CO", "Tiny <Town>, CO"] },
    scales: { lat: 100000, lng: 100000, bw: 10000, bs: 10000, be: 10000, bn: 10000, zhvi_yoy: 100, msp_yoy: 100 },
    period_end: "2026-09-30", zhvi_month: "2026-09-30", built_utc: "2026-10-24T00:00:00Z",
  };
}

test("slugs drop accents and punctuation", () => {
  assert.equal(slugify("Denver, CO"), "denver-co");
  assert.equal(slugify("Mayagüez, PR"), "mayaguez-pr");
  assert.equal(slugify("Winston-Salem, NC"), "winston-salem-nc");
});

test("pages exist for each state and each metro that passes the threshold", () => {
  const { pages, metros } = buildPages(fixture(MIN_METRO_ZIPS), { generated_utc: "2026-10-24T00:00:00Z" }, "/Domapus/");
  assert.deepEqual(metros.map((m) => m.name), ["Denver, CO"]);
  assert.deepEqual(pages.map((p) => p.path), ["metro/denver-co/", "state/co/"]);
});

test("a metro page names the place, links home, ranks reliable ZIPs and escapes text", () => {
  const { pages } = buildPages(fixture(12), { generated_utc: "2026-10-24T00:00:00Z" }, "/base/");
  const html = pages.find((p) => p.path === "metro/denver-co/").html;
  assert.match(html, /<title>Denver, CO housing market by ZIP code, September 2026 \| Domapus<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/jasperwchen.github.io\/base\/metro\/denver-co\/">/);
  assert.match(html, /href="\/base\/state\/co\/"/);
  assert.match(html, /src="\/base\/\?embed=1&amp;metric=zhvi&amp;lat=/);
  assert.match(html, /<h3>Rising<\/h3><ol><li><a href="\/base\/\?zip=80001&amp;metric=zhvi"/);
  assert.match(html, /rose in 6 of them and fell in 6/);
  assert.doesNotMatch(html, /<Town>/);
});

test("the sitemap lists the app routes and every page with the release date", () => {
  const xml = sitemap([{ path: "state/co/" }], "2026-10-24", "https://x.io", "/D/");
  assert.match(xml, /<loc>https:\/\/x.io\/D\/<\/loc><lastmod>2026-10-24<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/x.io\/D\/methodology\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/x.io\/D\/state\/co\/<\/loc>/);
});

test("the view fits the ZIPs' bounds", () => {
  const v = viewOf([{ lat: 39.7, lng: -105, bw: -0.5, bs: -0.5, be: 0.5, bn: 0.5 }]);
  assert.equal(v.lng, -105);
  assert.ok(Math.abs(v.lat - 39.7) < 0.01);
  assert.ok(v.zoom > 7 && v.zoom < 10);
});

test("the ranked lists are the extremes of the rankable ZIPs, in order, and never overlap", () => {
  const snap = fixture(20);
  const col = (name) => snap.d[snap.f.indexOf(name)];
  // A shuffled order, an unrankable ZIP at each extreme, and one rankable ZIP with no change.
  col("zhvi_yoy").forEach((_, i, a) => { a[i] = ((i * 7) % 23) * 100 - 1100; });
  col("rel")[3] = 0; col("zhvi_yoy")[3] = 99_900;
  col("rel")[4] = 0; col("zhvi_yoy")[4] = -99_900;
  col("zhvi_yoy")[5] = S;
  // Sale-price change must not steer the order.
  col("msp_yoy").forEach((_, i, a) => { a[i] = i * 1000; });
  const html = buildPages(snap, { generated_utc: "2026-10-24T00:00:00Z" }, "/b/")
    .pages.find((p) => p.path === "metro/denver-co/").html;
  const listed = (h) => [...html.split(`<h3>${h}</h3>`)[1].split("</ol>")[0].matchAll(/zip=(\d+)/g)].map((m) => m[1]);
  const rising = listed("Rising");
  const falling = listed("Falling");

  const yoy = new Map(snap.z.map((z, i) => [z, col("zhvi_yoy")[i]]));
  const rankable = snap.z.filter((z, i) => i < 20 && col("rel")[i] >= 1 && col("zhvi_yoy")[i] !== S)
    .sort((a, b) => yoy.get(b) - yoy.get(a) || a.localeCompare(b));
  assert.deepEqual(rising, rankable.slice(0, 5));
  assert.deepEqual(falling, rankable.slice(-5).reverse());
  assert.ok(!rising.some((z) => falling.includes(z)));
  assert.ok(![...rising, ...falling].some((z) => ["80003", "80004", "80005"].includes(z)));
});

test("the methodology shell is the app shell with the page's own title and canonical", () => {
  const html = methodologyShell(readFileSync("index.html", "utf8"), "/Domapus/");
  assert.match(html, /<title>Methodology \| Domapus<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/jasperwchen.github.io\/Domapus\/methodology\/"/);
  assert.match(html, /<meta property="og:url" content="https:\/\/jasperwchen.github.io\/Domapus\/methodology\/"/);
  // The boot script must still recognise the path, or the page fetches the map's data.
  assert.ok(html.includes("var mapless = /\\/methodology\\/?$/.test(location.pathname);"));
});
