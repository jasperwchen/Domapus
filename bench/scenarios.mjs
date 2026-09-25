// The interaction suite.
//
// WHY THIS EXISTS. Everything in bench/results up to this point measures cold
// load, and every performance claim in the repo is therefore about the first
// paint. "The map feels laggy" is a complaint about the seconds AFTER that, and
// the harness had no way to answer it — so an interaction fix could not be
// defended with a number the way a load fix could.
//
// THE SET IS FIXED, NOT GROWING. Metrics were added to `run.mjs` as they became
// interesting, which is why phase 0 and phase 3 results cannot be compared on
// anything but a handful of shared fields. Every scenario below is declared here
// once, runs on every invocation, and reports `null` rather than being omitted
// when a build cannot support it. Adding a scenario bumps SCHEMA_VERSION in
// run.mjs and `compare.mjs` refuses to compare across the bump, which is the
// mechanism that keeps this from happening a third time.

/**
 * Bump on ANY change to `run.mjs`'s METRIC_KEYS, to SCENARIO_IDS below, or to
 * what an existing key means.
 *
 * It lives here rather than in `run.mjs` because `compare.mjs` needs to read it,
 * and `run.mjs` exits on import when `--url` is missing. A version constant that
 * cannot be imported without side effects is a version constant nobody checks.
 *
 * 1 is every result file written before the interaction suite existed. Those have
 * no `schemaVersion` field at all, which `compare.mjs` reads as 1.
 */
export const SCHEMA_VERSION = 2;

/** Every scenario id, in report order. A build that cannot run one reports null
 *  for it; the key is always present. */
export const SCENARIO_IDS = [
  "pan.z4", "pan.z7", "pan.z10",
  "zoom.in", "zoom.out",
  "hover.sweep",
  "click.sidebar",
  "metric.cycle",
  "search.flyTo",
  "toggle.autoScale",
  "toggle.outliers",
];

const EMPTY = {
  durationMs: null, frames: null, dropped: null,
  longestFrameMs: null, p95FrameMs: null, loafCount: null, loafBlockingMs: null,
};

/** Run `fn` with frame recording on, and return its timing envelope. */
async function timed(page, fn) {
  const loafBefore = await page.evaluate(() => window.__bench.loafs.length);
  await page.evaluate(() => window.__benchFrames.start());
  const t0 = Date.now();
  await fn();
  const durationMs = Date.now() - t0;
  const frames = await page.evaluate(() => window.__benchFrames.stop());
  const loaf = await page.evaluate((n) => {
    const rest = window.__bench.loafs.slice(n);
    return {
      count: window.__bench.loafSupported ? rest.length : null,
      blocking: window.__bench.loafSupported
        ? rest.reduce((s, l) => s + l.blocking, 0)
        : null,
    };
  }, loafBefore);
  return {
    durationMs,
    frames: frames?.frames ?? null,
    dropped: frames?.dropped ?? null,
    longestFrameMs: frames?.longestFrameMs ?? null,
    p95FrameMs: frames?.p95FrameMs ?? null,
    loafCount: loaf.count,
    loafBlockingMs: loaf.blocking,
  };
}

/** Settle: two animation frames, then let any moveend work finish. */
const settle = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(
    () => setTimeout(r, 400)))));

/** Drag the map canvas by (dx, dy) in a straight line, in steps, so the browser
 *  produces real intermediate pointer events rather than one teleport. */
async function drag(page, dx, dy, steps = 20) {
  const box = await page.locator("canvas.maplibregl-canvas").first().boundingBox();
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + (dx * i) / steps, cy + (dy * i) / steps);
  }
  await page.mouse.up();
}

/**
 * EVERY `page.evaluate` THAT DRIVES THE MAP MUST HAVE A BLOCK BODY.
 *
 * MapLibre's camera methods return `this` for chaining, and `page.evaluate`
 * serialises whatever the function returns. A concise arrow body therefore hands
 * Playwright the entire `Map` — style, every source, every loaded tile, the
 * canvas and its WebGL context — to walk and stringify over the CDP pipe. The
 * first run died with `ERR_STRING_TOO_LONG`: the serialised object exceeded
 * Node's 512 MB string ceiling before it ever produced a number.
 *
 * The braces are the fix, and they are load-bearing rather than style.
 */
async function setZoom(page, zoom) {
  await page.evaluate((z) => { window.__map?.jumpTo({ zoom: z }); }, zoom);
  await settle(page);
}

/**
 * Run every scenario once against an already-loaded page.
 *
 * Never throws. A scenario whose control is absent — an old build, a changed
 * selector — leaves its row null and adds a note, because a harness that dies
 * halfway through measures nothing at all.
 */
export async function runScenarios(page, { onNote }) {
  const out = {};
  for (const id of SCENARIO_IDS) out[id] = { ...EMPTY };
  const note = (m) => onNote?.(m);

  const canvas = page.locator("canvas.maplibregl-canvas").first();
  if (!(await canvas.count())) {
    note("no MapLibre canvas — interaction suite skipped entirely");
    return out;
  }

  // --- Pan, at three zooms ------------------------------------------------
  // Three, because the cost is not zoom-invariant: the number of loaded tiles
  // and the size of the feature set behind `moveend` both change with it, and a
  // regression that only bites at z4 is the one a national view would show.
  for (const [id, zoom] of [["pan.z4", 4], ["pan.z7", 7], ["pan.z10", 10]]) {
    try {
      await setZoom(page, zoom);
      out[id] = await timed(page, async () => {
        await drag(page, -300, -180);
        await settle(page);
      });
    } catch (e) { note(`${id}: ${e.message}`); }
  }

  // --- Zoom ---------------------------------------------------------------
  try {
    await setZoom(page, 5);
    out["zoom.in"] = await timed(page, async () => {
      await page.evaluate(() => { window.__map?.zoomTo(8, { duration: 800 }); });
      await page.waitForTimeout(1200);
      await settle(page);
    });
    out["zoom.out"] = await timed(page, async () => {
      await page.evaluate(() => { window.__map?.zoomTo(5, { duration: 800 }); });
      await page.waitForTimeout(1200);
      await settle(page);
    });
  } catch (e) { note(`zoom: ${e.message}`); }

  // --- Hover ---------------------------------------------------------------
  // A straight sweep across the middle of the map. This is the scenario that
  // caught the popup being torn down and rebuilt on every animation frame: the
  // work is proportional to pointer MOVES, not to ZIPs crossed, so a slow
  // handler shows up here and nowhere else.
  try {
    await setZoom(page, 6);
    const box = await canvas.boundingBox();
    out["hover.sweep"] = await timed(page, async () => {
      const y = box.y + box.height / 2;
      for (let i = 0; i <= 200; i++) {
        await page.mouse.move(box.x + 40 + (i * (box.width - 80)) / 200, y);
      }
      await settle(page);
    });
  } catch (e) { note(`hover.sweep: ${e.message}`); }

  // --- Click to detail panel ----------------------------------------------
  try {
    const box = await canvas.boundingBox();
    out["click.sidebar"] = await timed(page, async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      // The history bucket is fetched on click, so the panel is not "open" until
      // its chart has something to draw. Bounded: a ZIP with no history is a
      // legitimate outcome, not a hang.
      await page.waitForTimeout(2500);
    });
  } catch (e) { note(`click.sidebar: ${e.message}`); }

  // --- Metric switch, all eight -------------------------------------------
  // Every painted metric, so the number covers the slowest paint tables to fetch
  // and not just one neighbour in the list.
  try {
    const combo = page.locator("[role=combobox]").first();
    if (await combo.count()) {
      out["metric.cycle"] = await timed(page, async () => {
        await combo.click({ timeout: 5000 });
        const n = await page.locator("[role=option]").count();
        await page.keyboard.press("Escape");
        for (let i = 0; i < n; i++) {
          await combo.click({ timeout: 5000 });
          await page.locator("[role=option]").nth(i).click({ timeout: 5000 });
          await settle(page);
        }
      });
      out["metric.cycle"].switches = await page.evaluate(
        () => performance.getEntriesByName("map:metricSwitch").length || null,
      );
    } else {
      note("metric.cycle: no combobox in this build");
    }
  } catch (e) { note(`metric.cycle: ${e.message}`); }

  // --- Search and fly ------------------------------------------------------
  try {
    const search = page.locator('input[type="text"], input[type="search"]').first();
    if (await search.count()) {
      out["search.flyTo"] = await timed(page, async () => {
        await search.fill("90210");
        await search.press("Enter");
        await page.waitForTimeout(2200);
      });
    } else {
      note("search.flyTo: no search input in this build");
    }
  } catch (e) { note(`search.flyTo: ${e.message}`); }

  // --- Legend toggles ------------------------------------------------------
  // Auto-scale is the one interaction that deliberately does expensive work on
  // every subsequent moveend; the outlier toggle should be nearly free, and this
  // row is here to notice if it ever stops being.
  for (const [id, selector] of [
    ["toggle.autoScale", "#legend-auto-scale"],
    ["toggle.outliers", "#legend-outliers"],
  ]) {
    try {
      const el = page.locator(selector);
      if (!(await el.count())) { note(`${id}: control not present`); continue; }
      out[id] = await timed(page, async () => {
        await el.click({ force: true });
        await settle(page);
        await drag(page, -150, -90);
        await settle(page);
        await el.click({ force: true });
        await settle(page);
      });
    } catch (e) { note(`${id}: ${e.message}`); }
  }

  return out;
}
