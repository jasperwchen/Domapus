// Cold-load benchmark: N runs under pinned CPU/network, reported as median + p95.
// Metrics are browser-native only, so this runs against any build including
// historical commits that cannot be instrumented.
//
// Usage:
//   node bench/run.mjs --url http://localhost:4173/Domapus/ --label era3-head
//   node bench/run.mjs --url https://jasperwchen.github.io/Domapus/ --label prod --runs 15
//
// Options:
//   --url <url>      required
//   --label <name>   output file name stem (default: derived from url)
//   --runs <n>       measured runs, excluding one discarded warm-up (default 10)
//   --net <profile>  slow4g | cable | none        (default slow4g)
//   --cpu <rate>     CPU throttle multiplier      (default 4)
//   --viewport <wxh> (default 1440x900)
//   --no-pin         skip view pinning (for builds predating URL state)
//   --out <dir>      (default bench/results)
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// PMTiles fetches by range request, so tile volume depends on the viewport.
// Unpinned, tile traffic swamps every other signal and runs are not comparable.
const PINNED_VIEW = "lat=39.5&lng=-98.35&zoom=4&metric=zhvi";

// The artifacts that gate first colour. Measured, not timed: paint detection here
// runs after a resource-stability loop, so by the time the map is known to have
// painted everything has already downloaded and there is nothing left to attribute.
// The claim being tracked is "how many bytes must land before a ZIP can be
// coloured", and that is a property of WHICH FILE GATES THE PAINT, not a race.
//
// THE SET CHANGES WHEN THE ARCHITECTURE DOES, and that is the metric working
// rather than the metric cheating. Before Phase 4 the whole 2.5 MB snapshot had to
// land before anything could be coloured, so it was the gate. After Phase 4 the
// paint table and the manifest are the gate: the snapshot is still fetched, but
// nothing waits for it to paint — it backs hover, search and export. Leaving it in
// this pattern would report 2.5 MB and claim the phase changed nothing, which is
// false. Counting it was correct then and is wrong now.
//
// If a future change makes the snapshot gate paint again, put it back.
const GATES_FIRST_COLOR = /\/paint\/[^/]+\.u8(\?|$)|\/manifest\.json(\?|$)/;

// The pre-Phase-4 definition, kept so an old build can still be measured the way
// its baseline was measured.
const GATES_FIRST_COLOR_LEGACY = /zip-data\.json/;

const NET = {
  slow4g: { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  cable:  { downloadThroughput: (5 * 1024 * 1024) / 8,   uploadThroughput: (1 * 1024 * 1024) / 8, latency: 28 },
  none:   null,
};

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const url = arg("url");
if (!url) {
  console.error("--url is required");
  process.exit(1);
}
const runs = Number(arg("runs", "10"));
const netName = arg("net", "slow4g");
const cpuRate = Number(arg("cpu", "4"));
const [vw, vh] = arg("viewport", "1440x900").split("x").map(Number);
const outDir = arg("out", "bench/results");
const label = arg("label", new URL(url).hostname.replace(/\W+/g, "-"));
const pin = !flag("no-pin");

const target = pin ? `${url}${url.includes("?") ? "&" : "?"}${PINNED_VIEW}` : url;

// Installed before any app code runs, so no early entries are missed.
const COLLECTOR = `
window.__bench = { longTasks: [], lcp: 0, cls: 0, shifts: 0 };
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__bench.longTasks.push({ start: e.startTime, dur: e.duration });
  }).observe({ type: "longtask", buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => {
    const es = l.getEntries();
    window.__bench.lcp = es[es.length - 1].startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__bench.cls += e.value; window.__bench.shifts++; }
  }).observe({ type: "layout-shift", buffered: true });
} catch {}
`;

/** Median and p95 of a numeric array. */
function stats(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
  return { median: at(0.5), p95: at(0.95), min: v[0], max: v[v.length - 1], n: v.length };
}

/**
 * One cold load. Fresh context each time so nothing is cached between runs.
 */
async function measureOnce(browser) {
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    // Chromium's default UA advertises HeadlessChrome; some CDNs vary on it.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.addInitScript(COLLECTOR);

  // Collected here, not from resource timing: zip-data.json is fetched inside the
  // Web Worker, and main-thread resource timing excludes worker requests.
  const responses = [];
  page.on("response", (r) => responses.push(r));

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (NET[netName]) {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NET[netName] });
  }
  if (cpuRate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });

  const t0 = Date.now();
  await page.goto(target, { waitUntil: "load", timeout: 180_000 });

  try {
    await page.waitForLoadState("networkidle", { timeout: 180_000 });
  } catch {
    /* some builds keep a connection open; fall through */
  }

  // networkidle is not enough: the full dataset is deferred behind
  // requestIdleCallback, so it starts after the network first goes quiet.
  {
    let last = -1, stable = 0;
    for (let i = 0; i < 90 && stable < 3; i++) {
      const n = await page.evaluate(() => performance.getEntriesByType("resource").length);
      stable = n === last ? stable + 1 : 0;
      last = n;
      await page.waitForTimeout(1000);
    }
  }
  // Screenshot, not gl.readPixels: MapLibre omits preserveDrawingBuffer, so
  // readPixels reads back cleared after compositing.
  const painted = await (async () => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const shot = await page.screenshot({
        clip: { x: vw / 2 - 60, y: vh / 2 - 60, width: 120, height: 120 },
        type: "png",
      });
      // PNG size is a cheap proxy for pixel variety; a blank crop compresses to nothing.
      if (shot.length > 2000) return true;
      await page.waitForTimeout(250);
    }
    return false;
  })();

  const wallMs = Date.now() - t0;

  const metrics = await page.evaluate(() => {
    const b = window.__bench;
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const res = performance.getEntriesByType("resource");

    const tbt = b.longTasks.reduce((sum, t) => sum + Math.max(0, t.dur - 50), 0);
    const maxLongTask = b.longTasks.reduce((m, t) => Math.max(m, t.dur), 0);

    const marks = {};
    for (const m of performance.getEntriesByType("measure")) marks[m.name] = m.duration;

    return {
      lcp: b.lcp,
      cls: b.cls,
      tbt,
      maxLongTask,
      longTaskCount: b.longTasks.length,
      domContentLoaded: nav.domContentLoadedEventEnd || 0,
      loadEvent: nav.loadEventEnd || 0,
      mainThreadResourceCount: res.length,
      marks,
      pinnedViewApplied: location.search.includes("zoom="),
    };
  });

  const byKind = {};
  let transferTotal = 0;
  let gatingBytes = 0;
  let gatingBytesLegacy = 0;
  for (const r of responses) {
    let bytes = 0;
    try { bytes = (await r.request().sizes()).responseBodySize || 0; } catch { /* aborted */ }
    transferTotal += bytes;
    const u = r.url();
    // Bytes that must arrive before any ZIP can be coloured. Today that is the
    // whole of zip-data.json, because classes are computed in-process from the
    // loaded records; after the paint table lands it is that file alone. The
    // pattern matches both on purpose — the number is only useful if it stays
    // comparable across that change.
    if (GATES_FIRST_COLOR.test(u)) gatingBytes += bytes;
    if (GATES_FIRST_COLOR_LEGACY.test(u)) gatingBytesLegacy += bytes;
    const kind = /\.pmtiles/.test(u) ? "pmtiles"
      : /geojson|topojson/.test(u) ? "data-geojson"
      : /zip-data|last_updated/.test(u) ? "data-json"
      : /basemaps\.cartocdn|\/tiles?\//.test(u) ? "basemap"
      : /\.js$/.test(u) ? "js"
      : /\.css$/.test(u) ? "css"
      : "other";
    byKind[kind] = (byKind[kind] || 0) + bytes;
  }
  const requestCount = responses.length;

  let heapBytes = null;
  try {
    heapBytes = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  } catch {
    /* not always available */
  }

  // Interaction cost: switch the metric and time until the map repaints.
  let metricSwitchMs = null;
  try {
    const combo = page.locator("[role=combobox]").first();
    if (await combo.count()) {
      const t = Date.now();
      await combo.click({ timeout: 5_000 });
      const option = page.locator("[role=option]").nth(2);
      await option.click({ timeout: 5_000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      metricSwitchMs = Date.now() - t;
    }
  } catch {
    /* control not present in this build */
  }

  await context.close();
  return { ...metrics, transferTotal, gatingBytes, gatingBytesLegacy, byKind, requestCount, heapBytes,
           metricSwitchMs, wallMs, painted };
}

const browser = await chromium.launch();
const samples = [];
console.log(`\n${label}  ${target}`);
console.log(`net=${netName} cpu=${cpuRate}x viewport=${vw}x${vh} runs=${runs} (+1 discarded warm-up)\n`);

for (let i = 0; i <= runs; i++) {
  const s = await measureOnce(browser);
  if (i === 0) {
    console.log(`  warm-up discarded (CDN/DNS priming)`);
    continue;
  }
  samples.push(s);
  console.log(
    `  run ${String(i).padStart(2)}  LCP ${Math.round(s.lcp)}ms  TBT ${Math.round(s.tbt)}ms  ` +
      `transfer ${(s.transferTotal / 1048576).toFixed(2)}MB  ${s.painted ? "" : "[MAP NEVER PAINTED] "}` +
      `${s.pinnedViewApplied ? "" : "[VIEW NOT PINNED]"}`
  );
}
await browser.close();

const numeric = ["lcp", "tbt", "maxLongTask", "longTaskCount", "domContentLoaded", "loadEvent",
                 "transferTotal", "gatingBytes", "gatingBytesLegacy", "requestCount", "heapBytes", "metricSwitchMs",
                 "cls", "wallMs"];
const summary = {};
for (const k of numeric) summary[k] = stats(samples.map((s) => s[k]));

const kinds = new Set(samples.flatMap((s) => Object.keys(s.byKind)));
summary.byKind = {};
for (const k of kinds) summary.byKind[k] = stats(samples.map((s) => s.byKind[k] || 0));

const markNames = new Set(samples.flatMap((s) => Object.keys(s.marks)));
summary.marks = {};
for (const m of markNames) summary.marks[m] = stats(samples.map((s) => s.marks[m]).filter(Boolean));

const dataBytes = (summary.byKind["data-json"]?.median || 0) + (summary.byKind["data-geojson"]?.median || 0);
const paintedAll = samples.every((s) => s.painted);
const valid = paintedAll && dataBytes > 100_000;

const result = {
  label,
  url: target,
  valid,
  invalidReason: valid ? null
    : !paintedAll ? "map never painted — build is broken or non-functional at this commit"
    : "no housing data loaded — this build fetched no zip-data/geojson, so its timings are not comparable",
  conditions: { net: netName, cpu: cpuRate, viewport: `${vw}x${vh}`, runs, pinned: pin },
  warnings: [
    samples.some((s) => !s.painted) && "map did not paint in at least one run",
    dataBytes <= 100_000 && "no housing data was fetched — timings measure a shell, not the app",
    samples.some((s) => !s.pinnedViewApplied) && "view pinning did not apply — tile transfer may vary",
    !markNames.size && "no performance.measure marks — build is uninstrumented (expected for historical builds)",
  ].filter(Boolean),
  summary,
  samples,
};

await mkdir(outDir, { recursive: true });
const out = join(outDir, `${label}.json`);
await writeFile(out, JSON.stringify(result, null, 2));

console.log(`\n  LCP            ${Math.round(summary.lcp.median)} ms   (p95 ${Math.round(summary.lcp.p95)})`);
console.log(`  TBT            ${Math.round(summary.tbt.median)} ms   (p95 ${Math.round(summary.tbt.p95)})`);
console.log(`  max long task  ${Math.round(summary.maxLongTask.median)} ms`);
console.log(`  transfer       ${(summary.transferTotal.median / 1048576).toFixed(2)} MB`);
console.log(`  gating bytes   ${summary.gatingBytes.median.toLocaleString("en-US")} B` +
            `${summary.gatingBytes.median === 0 ? "   ! nothing matched GATES_FIRST_COLOR" : ""}`);
// What the same page would have reported under the pre-Phase-4 definition, so the
// two eras are legible side by side rather than only through their baselines.
console.log(`  (snapshot)     ${summary.gatingBytesLegacy.median.toLocaleString("en-US")} B` +
            ` — fetched, but no longer gates paint`);
if (summary.heapBytes) console.log(`  JS heap        ${(summary.heapBytes.median / 1048576).toFixed(1)} MB`);
if (summary.metricSwitchMs) console.log(`  metric switch  ${Math.round(summary.metricSwitchMs.median)} ms`);
for (const w of result.warnings) console.log(`  ! ${w}`);
if (!valid) console.log(`
  *** INVALID: ${result.invalidReason}`);
console.log(`\n  -> ${out}\n`);
