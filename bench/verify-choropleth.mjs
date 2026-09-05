// Phase 3 acceptance check. The spec names two conditions and this asserts both:
//
//   1. `map:sourceReload` is 0 after setup.
//   2. A metric switch causes ZERO new tile requests.
//
// Both matter because the failure they guard against is invisible: calling
// setPaintProperty on a data-driven value re-sends every loaded tile to the
// MapLibre worker, re-parses it from cached PBF, rebuilds its fill bucket and
// re-uploads its GPU buffers. The map still looks right; it just costs seconds.
//
//   node bench/serve.mjs dist Domapus 4319 &
//   node bench/verify-choropleth.mjs [--cpu 4]
//
// Exits non-zero if either condition fails.
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const cpu = Number(argv[argv.indexOf("--cpu") + 1]) || 1;
const URL = process.env.BENCH_URL
  ?? "http://localhost:4319/Domapus/?lat=39.5&lng=-98.35&zoom=4&metric=zhvi";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
if (cpu > 1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
}

let tiles = 0;
page.on("request", (r) => { if (/pmtiles/.test(r.url())) tiles++; });

await page.goto(URL, { waitUntil: "load" });
await page.waitForTimeout(cpu > 1 ? 20_000 : 12_000);

const tilesBefore = tiles;
const reloadsBefore = await page.evaluate(() =>
  window.__domapusPerf?.counterValue("map:sourceReload") ?? null);

const t0 = Date.now();
await page.locator("[role=combobox]").first().click();
await page.locator("[role=option]").nth(2).click();
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const switchMs = Date.now() - t0;
await page.waitForTimeout(4000);

const reloadsAfter = await page.evaluate(() =>
  window.__domapusPerf?.counterValue("map:sourceReload") ?? null);
const marks = await page.evaluate(() =>
  performance.getEntriesByType("measure")
    .filter((m) => /^(map:|class:|data:)/.test(m.name))
    .map((m) => [m.name, Math.round(m.duration)]));

const result = {
  cpuThrottle: cpu,
  tileRequestsCausedBySwitch: tiles - tilesBefore,
  sourceReloadCounter: { before: reloadsBefore, after: reloadsAfter },
  switchMs,
  marks,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();

const failures = [];
if (reloadsAfter !== 0) {
  failures.push(`map:sourceReload is ${reloadsAfter}, must be 0 — something wrote a ` +
                `data-driven paint value and paid for a full source reload`);
}
if (tiles - tilesBefore !== 0) {
  failures.push(`a metric switch caused ${tiles - tilesBefore} tile request(s), must be 0`);
}
if (failures.length) {
  console.error("\nFAILED:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.error("\nOK: no source reload, no tile refetch on metric switch.");
