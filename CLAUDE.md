# Global instructions

agent: Maintain `docs/TODOS.md` updating your current objective, active subagent tasks, completed files, and next immediate steps. Update this file before launching parallel batches. this is to prevent lost when limit reached and everything shutdown.

## Short, plain, and easy to understand

Terse does not mean stilted. Write like a smart person talking to another smart person, not like an audit report.

- Lead with the answer. Do not make me read through setup before telling me what matters.
- Use plain English. Prefer simple, common words unless technical terminology adds necessary precision.
- Optimize for comprehension, not completeness. Include detail when it helps me understand the issue or changes what I should do. Cut detail that does neither.
- Keep sentences reasonably short and direct. Avoid packing several ideas, qualifications, and conclusions into one sentence.
- One main idea per paragraph.
- Explain technical concepts in plain English when they first matter. Do not assume I want a textbook explanation.
- Do not restate my question.
- No preamble. No "Sure, here's..." or "Let's break this down."
- No narration of what you are about to do.
- No recap or summary of your own answer unless I explicitly ask for one.
- Do not repeat the same point in different words.
- Do not turn every response into a formal report.
- Avoid excessive headings, nested sections, and rigid templates.
- Use bullets only when they make the information materially easier to scan. Normal explanations should usually be prose.
- Use examples when an abstract explanation would be harder to understand.
- If there is a clear recommendation, state it directly. Do not give every possible option equal weight when one is clearly better.
- If something is uncertain, say so briefly. Explain what is uncertain only if it matters.
- Do not use sophisticated wording merely to sound intelligent.
- Prefer "use" over "utilize", "because" over "due to the fact that", and similarly simple phrasing.
- Avoid unnecessary qualifiers such as "it is important to note that", "in terms of", "with regard to", and "it should be noted".
- Do not dump raw logs, tool output, search results, or intermediate work. Extract the useful information.
- Do not expose the investigation process unless I explicitly ask for it.

## When the answer is complex

If a topic genuinely requires a long explanation, make it easy to scan.

Use short paragraphs, descriptive headings, bullets, or a table only where they improve comprehension.

Do not make an answer long merely because more information is available.

The goal is not maximum detail. The goal is the minimum amount of clear information needed to fully answer the question correctly.

---

# Project context

## What Domapus is

A static site that renders U.S. housing-market data as a ZIP-code choropleth. Two halves that
meet only through files on disk:

- **`pipeline/`** — Python 3.14. Downloads Redfin and Zillow ZHVI, computes statistics, and
  writes a small set of published artifacts into `public/data/`.
- **`src/`** — React 18 + TypeScript + Vite SPA. Reads those artifacts at runtime. No server,
  no API. Deployed to GitHub Pages at `https://jasperwchen.github.io/Domapus/`.

There is no backend. Anything the site "knows" was computed by the pipeline and baked into a
file before deploy.

## Commands

```bash
npm run dev            # Vite dev server on http://localhost:3677. The correct local dev url is actually http://localhost:3677/ without the /Domapus/ at the end which returns 404
npm run build          # tsc -b, vite build, then scripts/prune-dist.mjs
npm test               # vitest (frontend)
npm run lint           # eslint
npm run tree           # regenerate tree.txt (the pre-commit hook does this)
npm run geometry       # rebuild the ZCTA tileset (Docker + tippecanoe); geometry:verify checks it
pytest                 # pipeline tests in tests/
python -m pipeline     # full data run; --redfin-csv / --zhvi-csv reuse a local download
```

Enable the repo hooks once: `git config core.hooksPath .githooks`. The pre-commit hook keeps
`tree.txt` current and refuses a commit whose workflow YAML does not parse.

## Routes

Two real pages, both under the `/Domapus/` base path:

| Route | Component | URL |
|---|---|---|
| `/` | `src/pages/Index.tsx` | `https://jasperwchen.github.io/Domapus/` |
| `/methodology` | `src/pages/Methodology.tsx` | `https://jasperwchen.github.io/Domapus/methodology` |

The base path is not optional. `vite.config.ts` sets `base: "/Domapus/"` in production and the
router takes its `basename` from `import.meta.env.BASE_URL`, so every published URL, sitemap
entry, and canonical link includes it. A URL without `/Domapus/` is a different site.

GitHub Pages cannot rewrite unknown paths to the app shell, so `public/404.html` does it in the
browser: it stashes the requested path in `sessionStorage`, bounces to `/Domapus/`, and
`App.tsx` restores the path with `history.replaceState`. Any new route depends on that
mechanism working.

The methodology page reads every figure it prints from `manifest.json` at runtime rather than
having them typed in, so it cannot drift from the release that built the map. If the pipeline
stops publishing a figure, the section quoting it disappears instead of going stale.

## The load path (why the first paint is fast)

The thing that colours the map is **not** the snapshot. It is a **paint table**: one byte per
ZIP, indexed by the ZIP read as a base-10 integer, so the ZIP itself is the array index — no
hash, no parse, no worker. The low nibble is the colour class, the next two bits are a
reliability tier. That is ~24 KB on the wire against the snapshot's ~2.5 MB.

- `src/lib/paint-table.ts` — the byte layout and its readers.
- Paint filenames carry a content hash, so `vite.config.ts` inlines the metric → filename map
  at build time. `index.html` can then start the manifest and paint fetches in the same tick
  instead of chaining two round trips in front of a 24 KB download.
- `src/workers/data-processor.ts` fetches the full snapshot off the critical path, transposes
  it into typed arrays, and posts them with a transfer list. `src/lib/zip-table.ts` holds the
  columns and materializes a `ZipData` object only when something hovers or clicks one.

Do not reintroduce a path where the map waits on the snapshot to show colour.

## Rules the code depends on

**The pipeline never writes `public/data/` from a stage.** Every stage writes `build/` plus a
`build/<stage>_report.json` receipt, and the next stage refuses to start unless the previous
receipt says `ok`. Publishing is a separate copy of a verified build. This rule exists because
a bug once let a run that passed weak validators overwrite the last known-good published data.

**The colour ramp has one definition.** `src/lib/choropleth.generated.ts`, re-derived by
`scripts/palette/derive_ramp.mjs`. The map, the legend, and the PNG/PDF export all import from
it. They used to carry three different lists, so the legend showed colours the map never painted.

**The class count is measured, not chosen, and 14 is the answer.** The ramp has a fixed arc
length under simulated colour blindness — about 84 dE76, bounded by the usable L* range,
because tritanopia collapses the yellow-blue axis its chroma lives on. So `derive_ramp.mjs`
does not check whether adjacent swatches separate. It measures the SEPARABLE SPAN (how many
classes apart two ZIPs must be before every reader can tell them apart) and rejects any count
whose span/classes ratio is worse than the 14.3% of range the old 7-class ramp gave. 14 passes
at a span of 2; 13 and 15 do not. The byte imposes a second, independent ceiling of 15 — the
class field is the low nibble holding `class + 1` — and `pipeline/paint.py` raises on it rather
than leaving it to the palette script. Do not raise the count without re-running both.

**A class-count change must be published before it is deployed.** `PaintTable.from` refuses to
build when the manifest's class count and the ramp length disagree, so a frontend at 14 against
published data at 7 is a grey map — and `deploy.yml` runs on push. `classing.test.ts` fails
loudly on that mismatch, which is the gate. The order is: push the branch, dispatch
`update_data.yml` against it, merge once the data commit lands.

**`map:sourceReload` is a real tripwire.** `countZipPaintRewrites` wraps `setPaintProperty` on
the map and counts any call on a `zips-*` layer; `bench/run.mjs` and `bench/verify-choropleth.mjs`
assert it stays 0. It replaced a wrapper nothing called, which made that assertion vacuous.

**Workflow inputs never go inside `run:` as `${{ }}`.** Pass them through `env:` and quote the
variable. `--override-reason ${{ toJSON(...) }}` let a reason containing `$(...)` execute.

**The goldens have a producer now.** `python scripts/make_golden.py --write` recomputes
`tests/golden/*.json` from `build/zip-data.json` using the real `classify` and `paint`, changing
only the class-dependent parts and leaving the hand-chosen ZIP selection alone. `paint_50.json`
keys its bytes by LONG metric name and `snapshot_50.json` keys its breaks by SHORT wire name;
swapping them reads as an empty fixture rather than an error.

**The reliability nibble is metric-invariant.** It always carries the ZIP's median-sale-price
tier, a property of the transaction sample rather than of whatever is being painted. Listing-
side metrics are exempt from the fade; fading a listings map by a sales statistic would be
wrong exactly where there were no sales.

**The publish decision is a digest, never a count.** `manifest.content_digest` is a sha256
over the snapshot's content columns plus every paint table's own hash, with timestamps
excluded, so a rebuild over unchanged input reproduces it exactly. `update_data.yml` gates
the commit and the deploy on `content_changed`. A missing digest means CHANGED — a redundant
deploy is cheap, a skipped one is the deploy bug. The old gate counted moved data points; it
compared a key with no wire column and so could never say "unchanged", and had it been fixed
naively a missing baseline returned 0 and would have skipped publication.

**The change report and the diff gate read the same file and want different things from it.**
`decode_live` divides by the wire scale, which is right for the gate ("did this move 25%") and
wrong for the report ("did this move at all"). `diff` encodes both sides through
`encode_columns` instead. It runs on a FINISHED build, after S5c — seven wire columns have no
producer until then — and refuses one where every `rel` is null.

**`build/paint/` is published and committed like the snapshot, not fetched like history.**
The filenames carry a content hash and `vite.config.ts` inlines them into `index.html` at
build time, so a manifest naming a file that was not committed is a 404 on the critical path
and a grey map. `update_data.yml` replaces `public/data/paint` wholesale, verifies every
declared sha256 before the commit, and stages with `git add -A` so last month's files are
staged as deletions.

**`SNAPSHOT_COLUMNS` in the pipeline and `FIELD_OF` in `src/lib/zip-table.ts` are two halves of
one wire format.** Change them together.

**`fitBreaks` in `src/lib/classing.ts` is the only thing allowed to re-cut class boundaries.**
It reads the scheme and the break gate out of the manifest, so a re-cut sample reproduces the
pipeline's own cuts. A plain-quantile cutter used to live beside it; classing the same national
extent the pipeline classed, it put 28.6% of ZIPs in the two darkest classes against the fixed
scale's 6.0%. It was deleted 2026-09-12. Do not reintroduce one. `quantiles.ts` itself was
deleted 2026-09-16: its last consumer computed legend percentiles that were never rendered.

**A class can be legitimately empty, and the legend says so by geometry.** `homes_sold` and
`active_listings` break at 1.0 first and nothing reports under one sale, so class 0 draws nobody.
The break is correct; ties collapsing classes is a real property of the distribution. The legend
shrinks an unused band to a sliver and keeps its WIDTH, because the tick labels are positioned
from `(i + 1) / CLASSES` and dropping a band would move every label off the boundary it names.
Height rather than lightness, for the same reason the reliability fade came off the map.
`classCounts` is withheld in auto-scale: the viewport re-cut has different boundaries, so the
published counts would mislabel it.

**Forecast tier 1 is never assigned, deliberately.** The ladder is 3 (>=60 obs), 2 (24-59) and 0
(under 24, no forecast). Tier 1 was documented as a metro growth path that was never written, so
it would have labelled an ordinary shrunk AR(1) forecast as something weaker. Collapsed into
tier 0 on 2026-09-12. Implementing the metro path is still open; restoring the label without the
branch is not.

**The 46.9 MB tileset stays committed in git.** `public/data/us_zip_codes.pmtiles` is tracked
on purpose (user decision, 2026-09-06), so `deploy.yml` needs no download step and cannot
publish a blank map through a silent fetch failure. The accepted cost is that every geometry
rebuild adds a permanent ~47 MB blob to history, which is roughly an annual event. **Do not
re-open this as a "cleanup" without asking.** `geometry.yml` still cuts a `geometry-vN`
release when handed a tag, so the release-asset path stays available if repo size ever does
become the problem.

## Data flow and deploy

`update_data.yml` runs on the 18th of each month. It probes upstream first (~0.2 s) and exits 0
without downloading if nothing changed. A diff gate can block publication; overriding it
requires a reason that is recorded verbatim in the manifest.

The 18th is set by the later of the two publishers. Zillow ships ZHVI on the 16th and does not
slide for weekends; Redfin ships the monthly file earlier, on a date it announces on its own
tracker page. Redfin's S3 `Last-Modified` is not a publish signal — the object gets touched
without its content changing — which is why `sources.fingerprint` excludes it. Because S0 starts
a run when *either* feed moves, a run landing between the two publishes half a release, so
`serialize.validate` compares the two period ends: a one-month gap warns and publishes, two
months fails.

`deploy.yml` is invoked through `workflow_call` from inside the data run, not by `on: push`.
A push made with the default `GITHUB_TOKEN` does not trigger workflows, so the data commit used
to sit on `main` unpublished. A miswired `workflow_call` looks exactly like that original bug,
so verify a Deploy job actually appears in the run graph rather than that the YAML parses.

## Docs

- `docs/TODOS.md` — open work only. Read before starting work.
- `docs/CHANGES.md` — decision history and reference facts moved out of the todos.
- `docs/METHODOLOGY.md` — developer reference: stage-to-manifest map, constants, wire format,
  break populations, invariants and what enforces each.
- `tree.txt` — generated file list. Never edit by hand.


## Where things live

| Path | What it is |
|---|---|
| `pipeline/` | Python 3.14 data pipeline. One module per stage, driven by `__main__.py`. |
| `src/lib/` | Frontend logic with no React in it: wire formats, colour, paint table, classing, perf marks. |
| `src/components/dashboard/` | The map UI. `HousingDashboard.tsx` is the container everything hangs off. |
| `src/components/ui/` | shadcn/Radix primitives. Generated, rarely edited by hand. |
| `src/workers/` | The snapshot worker. Runs off the critical path. |
| `src/pages/` | `Index` (the map), `Methodology`, `NotFound`. |
| `public/data/` | Published artifacts the site fetches at runtime, plus two CSVs the pipeline reads as input. |
| `build/` | Where every pipeline stage writes. Never published directly; gitignored. |
| `scripts/` | Build and maintenance scripts (tree, dist pruning, palette derivation, workflow lint). |
| `bench/` | Cold-load benchmark harness. Playwright-driven, results checked in. |
| `tests/` | pytest for the pipeline, plus golden fixtures and the diff-gate baseline. |
| `docs/` | Open todos, change history, methodology reference. |

`@/` is a path alias for `src/`, defined in both `vite.config.ts` and `vitest.config.ts`.

## The pipeline, stage by stage

`python -m pipeline` runs these in order. Each writes `build/<stage>_report.json`, and the
next stage calls `_require()` on the one before it and refuses to start unless the receipt
says `ok`. Nothing here touches `public/data/`.

| Stage | Module | What happens |
|---|---|---|
| S0 probe | `sources.py` | HEAD plus a 1 MB shape probe, ~0.2 s. If the fingerprint matches the live manifest, exit 0 and download nothing. |
| S1 acquire | `sources.py` | The 1.33 GB Redfin CSV, into a temp dir outside the working tree. Single-part ETag is verified as an MD5; multipart is not. |
| S2 ingest | `redfin.py`, `zhvi.py`, `panel.py` | Stream both feeds once, write `panel.parquet` and `zhvi-panel.parquet`, and measure P×Z rather than recalling it. |
| S3 assemble | `serialize.py`, `dim.py`, `geom.py`, `changes.py` | Join the latest period to the ZCTA dimension and polygon bounds, recompute every YoY from published levels at lag 12, validate. |
| S4 gate | `gate.py` | Refuse to publish a snapshot that moved more than a real month can. Runs before anything is written. |
| S5 noise | `noise.py` | Fit K on the panel; write `msp_rse` and the `rel` tier into every record. |
| S5b forecast | `forecast.py` | AR(1) on log ZHVI growth plus an 82-origin backtest. Fills `f_h12`, `f_sigma`, `f_tier`. |
| S5c spatial | `spatial.py` | Local Moran's I over the rankable set only. Fills `lisa`. Hand-rolled numpy + KD-tree; `libpysal`/`esda` are deliberately refused. |
| S6 classify | `classify.py` | Derive the diverging bound from the pooled ZHVI panel this release, compute breaks, assign classes. |
| S7 paint | `paint.py` | One byte per ZIP per painted metric, then assert the paint bytes agree with the snapshot. |
| S8 history | `history.py` | Per-ZIP time series, bucketed 4 deep by ZIP prefix, into `build/history/`. ~6,100 files, ~121 MB. |

Supporting modules: `units.py` maps Redfin headers to our keys and the scale each column
arrives on; `contracts.py` holds the declared invariants and raises `PipelineError`.

Outputs land in `build/`: `zip-data.json`, `manifest.json`, `last_updated.json`,
`orphans.json`, `paint/*.u8`, `history/<zip4>.json`, the two parquet panels, and the stage
receipts. Publishing is a separate copy of a verified build.

**The history buckets do not travel through git.** `public/data/history/` is gitignored
because it is ~121 MB regenerated every month. `update_data.yml` tars it onto that period's
`data-*` release and `deploy.yml` unpacks it back into the tree before building, so a CI
checkout — which has none of it — still publishes a working sidebar chart. `deploy.yml` only
*warns* if the tarball is missing, on the reasoning that a chart falling back to its error
state beats blocking a deploy; the geometry asset, whose absence would publish a blank map,
fails hard instead. The consequence is that a standalone deploy against a release with no
`history-*.tar.gz` succeeds and ships without history.

Two files in `public/data/` are pipeline *inputs*, not outputs: `zcta-meta.csv` (city,
county, state, metro, lat, lng per ZIP) and `zcta-geom.csv` (real polygon bounds per ZCTA,
which is what makes the map's auto-scale mode correct).

## The frontend, module by module

**Load path.** `index.html` fires the manifest and paint fetches in the same tick →
`src/lib/manifest.ts` and `src/lib/paint-table.ts` → the map paints. Separately,
`useDataWorker` starts `src/workers/data-processor.ts`, which fetches `zip-data.json`,
transposes it into typed arrays, and transfers them to `src/lib/zip-table.ts`.

- `snapshot.ts` — the shape of `zip-data.json`. Column-major: `d[j]` is column `j` for every
  ZIP, not ZIP `j`'s row.
- `zip-table.ts` — the columns as `Int32Array`s. `materialize(row)` builds one `ZipData`
  object on hover or click, so nothing downstream had to change when the format did.
  `FIELD_OF` here and `SNAPSHOT_COLUMNS` in `serialize.py` are one wire format in two halves.
- `metrics.ts` — metric metadata (label, format, YoY/MoM companions, whether it is painted).
  Keys are `ZipData` field names, which `FIELD_OF` maps from the wire names in `serialize.COLUMNS`.
- `choropleth.generated.ts` / `choropleth.ts` — the one colour ramp. Re-derive with
  `node scripts/palette/derive_ramp.mjs --write`.
- `class-source.ts` — which authority decides a ZIP's class. Exactly one is live at a time.
- `choropleth-painter.ts` — turns classes into MapLibre's constant `match` expression.
- `data-url.ts` — resolves data URLs against `VITE_DATA_BASE`. PR previews point this at
  production so they don't ship their own 92 MB tileset.
- `history.ts` — fetches one `history/<zip4>.json` bucket per click and reads the per-ZIP
  series out of it. The bucket carries ~6 neighbouring ZIPs, so panning nearby is free.
  Feeds `Sparkline.tsx` in the sidebar.
- `perf.ts` — `performance.mark`/`measure` wrappers. Every performance claim about the live
  site goes through here.

**Components.** `HousingDashboard.tsx` owns state and wires the rest: `MapLibreMap` (MapLibre
GL + PMTiles), `Legend`, `MetricSelector`, `SearchBox`, `Sidebar` (the detail panel),
`ZipComparison`, `TopBar`, `MobileBottomSheet`, and the export pair
`export/ExportSidebar.tsx` + `export/PrintStage.tsx` (PNG via canvas, PDF via jsPDF).

**Hooks.** `useDataWorker` (worker lifecycle), `useUrlState` (metric and selected ZIP in the
query string), `use-mobile` (768 px breakpoint), `use-toast`.

## Tests and benchmarks

`npm test` runs vitest (jsdom, setup in `src/test/setup.ts`). The interesting ones are
`src/lib/__tests__/golden.test.ts`, which checks the frontend readers against
`tests/golden/snapshot_50.json` and `paint_50.json` — the same fixtures pytest checks the
pipeline writers against, so a wire-format change that breaks the contract fails on both
sides rather than neither.

`pytest` runs `tests/test_pipeline.py` and `tests/test_gate.py`.
`tests/baselines/diff_gate.json` holds the gate thresholds; recalibrate with
`scripts/calibrate_diff_gate.py`. `tests/fixtures/redfin_sample.csv` is the small feed.

Benchmarks measure cold load under pinned conditions:

```bash
npm run build
node bench/serve.mjs dist Domapus 4319 &
node bench/run.mjs --url http://localhost:4319/Domapus/ --label candidate
node bench/compare.mjs bench/results/baseline.json bench/results/candidate.json
```

Pass the base path without slashes (`Domapus`, not `/Domapus/`) — Git Bash rewrites a leading
slash into a Windows path. `bench/results/` is checked in, one file per measured era, so
before/after claims stay comparable.

## Workflows

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR, push to main | Two jobs: frontend (lint, `tsc -b`, vitest, license-year check) and pipeline (`check_workflows.py`, pytest). |
| `update_data.yml` | 18th monthly, or dispatch | The data run. Probes, builds, gates, publishes, then calls Deploy. Dispatch takes `override_diff_gate` + `override_reason` and `force_deploy`. |
| `deploy.yml` | `workflow_call` from the data run, dispatch, push | Builds and publishes to `gh-pages`. |
| `preview.yml` | PR opened/updated/closed | Per-PR preview on `gh-pages`. Shares the `gh-pages-write` concurrency group with Deploy. |
| `geometry.yml` | dispatch | Rebuilds the ZCTA tileset and verifies it. Given a `release_tag` it also cuts a `geometry-vN` release. |
| `license_year.yml` | 1 January | Rolls the end year in `LICENSE.md`. |

The pre-commit hook regenerates `tree.txt` and runs `scripts/check_workflows.py`, because a
workflow GitHub cannot parse starts no jobs and annotates nothing — a broken `ci.yml` cannot
run the job that would have caught it.

## Conventions

- TypeScript strict, React function components, hooks only.
- Tailwind plus shadcn/Radix primitives in `src/components/ui/`. `components.json` configures
  the shadcn generator.
- Prose comments explain *why*, usually with the measurement or the bug that forced the
  decision. Match that when editing; do not add comments that restate the code.
- `tree.txt` is generated. `src/lib/choropleth.generated.ts` is generated. Never hand-edit
  either.
- Windows is the primary dev machine. Both PowerShell and Git Bash are in play; watch for path
  rewriting in Git Bash when an argument starts with `/`.
