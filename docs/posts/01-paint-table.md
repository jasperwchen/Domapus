# Colouring 33,771 ZIP codes from 33 KB

Draft. Figures from `bench/results/` (slow 4G, 4x CPU throttle, 1440x900, median of 5 runs
unless noted) and `docs/CHANGES.md`.

## The problem

Domapus is a static site: a map of U.S. housing data by ZIP code, with no server behind it. A
monthly pipeline writes files; the browser reads them. The obvious design is one file holding
every number for every ZIP, which the browser downloads, parses, classifies into colours, and
paints.

That file is the snapshot: 33,771 ZIPs by 49 columns, 2.67 MB compressed. In the obvious
design the map shows no colour until all of it has arrived and been processed. On a slow
phone connection that is several seconds of grey.

The first version of the site was worse still: a Leaflet map fed GeoJSON, 221 MB transferred
and 649 MB of browser memory (3 runs). That version is the floor this post climbs from.

## The idea

The map does not need the numbers to colour itself. It needs one small fact per ZIP: which
of the 14 colour classes it falls in. So the pipeline computes that fact ahead of time and
publishes it separately, as a paint table.

A paint table is one byte per ZIP, for one metric. The array is indexed by the ZIP code read
as a base-10 integer, so ZIP 80202 is byte 80202. There is no lookup table, no hash, and no
parsing: the ZIP is the address. The low four bits hold the class plus one (zero means no
data), and the next two hold a reliability tier for the ZIP's sales sample.

A paint table is about 24 KB on the wire. The snapshot still loads, in a background worker,
for hover, search, the detail panel and export. Nothing about the map's colour waits for it.

## Making the two downloads start together

Paint tables change every month, so their filenames carry a content hash; that lets browsers
cache them forever. But it creates a chain: fetch the manifest to learn the filename, then
fetch the paint table. Two round trips on a slow link before 24 KB can start.

The build breaks the chain. At build time Vite reads the manifest and writes the
metric-to-filename map straight into `index.html`, so the manifest and the paint table are
requested in the same tick.

## Painting without re-laying out the map

The second cost was switching metric. The original code called MapLibre's
`setPaintProperty` with a data-driven expression on every switch. MapLibre treats that as a
layout change: every loaded tile went back to the worker, its geometry was re-bucketed and its
GPU buffers re-uploaded. A metric switch took 3,375 ms.

Now the fill colour is a constant expression set once, and it reads a class from each
feature's state. A metric switch only writes feature state, which never triggers a relayout.
Two measurements shaped the details:

- `setFeatureState` costs about 0.14 microseconds per call, not the 30 assumed earlier. The
  writes had been chunked across frames to avoid jank, and each chunk caused a full map
  render. One chunk instead of five took the write from 579 ms to 9 ms.
- About half the ZIPs keep the same class when the metric changes, so the painter skips
  writes that would not change anything.

A tripwire keeps the old path from coming back: the benchmark wraps `setPaintProperty` and
fails if anything calls it on a ZIP layer.

## Result

| | Before | Now |
|---|---|---|
| Data downloaded before the map shows colour | 2.67 MB | 33 KB |
| Switching metric | 3,375 ms | 22 ms |
| Page weight | 221 MB (first version) | 5.6 MB |
| Browser memory | 649 MB (first version) | 29 MB |

The 33 KB is the manifest plus one paint table.

## What it cost

Two halves now describe the same data: the paint table and the snapshot. If they disagree,
the map shows one colour and the tooltip another. The pipeline asserts after writing that
every paint byte agrees with the snapshot's value for that ZIP, and a set of golden fixtures is
checked by both the Python writers and the TypeScript readers, so a wire-format change breaks
tests on both sides at once.
