// Phase 3 acceptance check. It asserts three conditions:
//
//   1. `map:sourceReload` is 0 after setup.
//   2. A metric switch causes ZERO new tile requests.
//   3. A metric switch stays inside its time budget (median `map:metricSwitch` and the
//      longest main-thread task during the switches).
//
// 1 and 2 matter because the failure they guard against is invisible: calling
// setPaintProperty on a data-driven value re-sends every loaded tile to the
// MapLibre worker, re-parses it from cached PBF, rebuilds its fill bucket and
// re-uploads its GPU buffers. The map still looks right; it just costs seconds.
//
// 3 exists because the same cost came back another way. Any layer that reads
// feature-state on the class source is re-evaluated for every class write, and three
// metro layers plus the selection halo took a switch from 0.45 s to 3-4 s at 4x CPU
// (audit 2026-11-16, P0). Nothing failed; the page just froze.
//
//   node bench/serve.mjs dist Domapus 4319 &
//   node bench/verify-choropleth.mjs [--cpu 4] [--channel chrome]
//
// Exits non-zero if any condition fails.
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const cpu = Number(arg("--cpu")) || 1;
const channel = arg("--channel");
const URL = process.env.BENCH_URL
  ?? "http://localhost:4319/Domapus/?lat=39.5&lng=-98.35&zoom=4&metric=zhvi";
// Per unit of CPU throttle. Fill-only measured 447 ms median and a 0.3 s longest task at 4x.
const SWITCH_BUDGET_MS = 250 * cpu;
const LONG_TASK_BUDGET_MS = 250 * cpu;
const SWITCHES = 3;

const browser = await chromium.launch(channel ? { channel } : {});
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

await page.evaluate(() => {
  window.__longTasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__longTasks.push(e.duration);
  }).observe({ type: "longtask" });
});

for (let i = 0; i < SWITCHES; i++) {
  await page.locator("[role=combobox]").first().click();
  await page.locator("[role=option]").nth(i + 1).click();
  await page.waitForTimeout(cpu > 1 ? 8000 : 4000);
}

const reloadsAfter = await page.evaluate(() =>
  window.__domapusPerf?.counterValue("map:sourceReload") ?? null);
const switches = await page.evaluate(() =>
  performance.getEntriesByName("map:metricSwitch").map((m) => Math.round(m.duration)));
const longestTask = await page.evaluate(() => Math.round(Math.max(0, ...window.__longTasks)));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const result = {
  cpuThrottle: cpu,
  tileRequestsCausedBySwitch: tiles - tilesBefore,
  sourceReloadCounter: { before: reloadsBefore, after: reloadsAfter },
  metricSwitchMs: switches,
  medianSwitchMs: median(switches),
  longestTaskMs: longestTask,
  budgetMs: { switch: SWITCH_BUDGET_MS, longTask: LONG_TASK_BUDGET_MS },
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
if (switches.length !== SWITCHES) {
  failures.push(`recorded ${switches.length} map:metricSwitch measures for ${SWITCHES} switches`);
} else if (result.medianSwitchMs > SWITCH_BUDGET_MS) {
  failures.push(`median metric switch ${result.medianSwitchMs} ms, budget ${SWITCH_BUDGET_MS} ms. ` +
                `Look for a feature-state layer on the class source ("zips").`);
}
if (longestTask > LONG_TASK_BUDGET_MS) {
  failures.push(`longest task during the switches ${longestTask} ms, budget ${LONG_TASK_BUDGET_MS} ms`);
}
if (failures.length) {
  console.error("\nFAILED:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.error("\nOK: no source reload, no tile refetch, switch inside budget.");
