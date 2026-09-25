#!/usr/bin/env bash
# The whole geometry workflow: simplify, tile, sidecar, verify.
#
# This script plus Dockerfile.tippecanoe is the reproducibility record the release
# notes carry. Do not paraphrase the invocations below into the notes; paste them.
#
# tippecanoe does not build natively on Windows, so it runs in the committed container.
# mapshaper runs on the host. Both are version-pinned.
#
#   bash scripts/geometry/build_geometry.sh
#   SKIP_MASTER=1 bash scripts/geometry/build_geometry.sh   # reuse build/zcta-master.json
set -euo pipefail

SHP="temp-data/temp-geo/cb_2020_us_zcta520_500k/cb_2020_us_zcta520_500k.shp"
MS="npx --yes --package=mapshaper@0.7.58"
IMAGE="domapus/tippecanoe:2.78.0"
LOCK="geometry.lock.json"

# Guam (144°E), the Northern Marianas and American Samoa (14°S) would force the tileset bounds
# to span the globe. Puerto Rico and the USVI are inside this box and are kept — they have real
# market data. This is the coded replacement for an undocumented hand-edit that used to be
# baked into the binary with no record of what it removed.
TERRITORY='this.bounds[0] >= -180 && this.bounds[2] <= -64 && this.bounds[1] >= 17 && this.bounds[3] <= 72'

# Docker Desktop on Windows wants a drive-letter path; `pwd -W` is what Git Bash gives it.
# MSYS_NO_PATHCONV stops Git Bash rewriting the *in-container* /work paths into Windows ones
# — without it tippecanoe is handed "C:/Program Files/Git/work/..." and cannot open it.
HOSTDIR="$(pwd -W 2>/dev/null || pwd)"
tippecanoe_run() { MSYS_NO_PATHCONV=1 docker run --rm -v "${HOSTDIR}:/work" "$IMAGE" "$@"; }

command -v docker >/dev/null || { echo "docker not found — see Dockerfile.tippecanoe" >&2; exit 1; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "building $IMAGE (first run only)"
  docker build -f Dockerfile.tippecanoe -t "$IMAGE" .
}

mkdir -p build

# --- source, bounds, simplify -------------------------------------------------------------------------
# Bounds are captured BEFORE any point conversion: after `-points inner` the geometry is a
# point and `this.bounds` is degenerate, which would silently zero every bbox column.
#
# Visvalingam, not Douglas-Peucker: DP preserves spikes, Visvalingam removes least-area
# vertices so a shape degrades evenly. A choropleth reader reads filled area as quantity, so
# even degradation is the correct failure mode.
#
# 20 m against a 30.1 m pixel at z12/lat38 is 0.67 px — invisible, and it removes the 1-10 m
# vertex spacing TIGER-derived boundaries carry. `keep-shapes` is mandatory or the
# single-building Manhattan and DC ZCTAs collapse out of existence.
#
# Simplify ONCE here, not per-zoom in tippecanoe: mapshaper builds an arc topology, so a
# border shared by two ZCTAs is a single arc that simplifies identically for both. Slivers
# and gaps become impossible by construction rather than merely unlikely.
if [ "${SKIP_MASTER:-0}" != "1" ]; then
  echo "== record the territory-filtered features before dropping them =="
  $MS mapshaper-xl 8gb "$SHP" -proj wgs84 \
    -filter "ZCTA5CE20 != null" \
    -filter "$TERRITORY" invert \
    -filter-fields ZCTA5CE20 \
    -o build/zcta-territory-dropped.csv format=csv

  echo "== bounds, then simplify =="
  $MS mapshaper-xl 8gb "$SHP" -proj wgs84 \
    -filter "ZCTA5CE20 != null" \
    -filter "$TERRITORY" \
    -each 'var b=this.bounds; bw=+b[0].toFixed(4); bs=+b[1].toFixed(4); be=+b[2].toFixed(4); bn=+b[3].toFixed(4)' \
    -simplify visvalingam interval=20 keep-shapes \
    -clean \
    -o build/zcta-master.json format=geojson precision=0.00001
  echo "== source count and the dropped list, against $LOCK =="
  node -e '
    const fs = require("fs");
    const lock = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const dropped = fs.readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/).slice(1)
      .map(s => s.trim()).filter(Boolean).sort();
    const kept = JSON.parse(fs.readFileSync(process.argv[3], "utf8")).features.length;
    const expectDropped = [...lock.territory_filter.dropped].sort();
    const source = kept + dropped.length;
    const drift = Math.abs(source - lock.source.feature_count) / lock.source.feature_count;
    let bad = 0;
    if (drift > 0.005) { console.error(`source count FAIL: source ${source} vs lock ${lock.source.feature_count} (${(drift*100).toFixed(2)}%)`); bad = 1; }
    if (String(dropped) !== String(expectDropped)) { console.error(`dropped list FAIL: dropped [${dropped}] != lock [${expectDropped}]`); bad = 1; }
    if (kept !== lock.tileset.feature_count) { console.error(`source count FAIL: kept ${kept} vs lock ${lock.tileset.feature_count}`); bad = 1; }
    if (bad) process.exit(1);
    console.log(`source count ok: ${source} source, ${kept} kept. dropped list ok: ${dropped.length} territory features dropped.`);
  ' "$LOCK" build/zcta-territory-dropped.csv build/zcta-master.json
else
  echo "== simplify: SKIPPED, reusing build/zcta-master.json =="
fi

echo "== drop everything but the id for tiling =="
$MS mapshaper build/zcta-master.json -filter-fields ZCTA5CE20 \
  -o build/zcta-tiles.json format=geojson

# --- tile --------------------------------------------------------------------------------
# -Z2 because underzoom does not exist: MapLibre renders NOTHING below a vector source's
#     minzoom, unlike the maxzoom side where overzoom is native. The export insets fit Alaska
#     and Hawaii below z3 and rendered blank because of it.
# -z10 because z11+z12 were 58.3 MB of the old 92 MB archive. z10 quantization is 7.5 m
#     against a 30 m pixel at the app's maxZoom 12 — 0.25 px of display error.
# --no-tiny-polygon-reduction (NOT the ...-at-maximum-zoom variant the old archive used,
#     which left tiny polygons merged into representative squares at every zoom but the
#     deepest — that is Bug 2, and the old tileset's own metadata records it happening).
# NOT --drop-densest-as-needed: it drops the densest features first, i.e. urban.
# NOT --coalesce-densest-as-needed: coalescing only merges features with identical
#     attributes, and every ZCTA has a unique id, so it degenerates to dropping.
echo "== tippecanoe =="
rm -f build/us_zip_codes.pmtiles
tippecanoe_run tippecanoe \
  -o /work/build/us_zip_codes.pmtiles \
  -l us_zip_codes \
  -n "Domapus US ZCTA (2020 vintage, CB 1:500k)" \
  -Z2 -z10 \
  --no-tiny-polygon-reduction \
  --no-simplification-of-shared-nodes \
  --no-feature-limit \
  --no-tile-size-limit \
  --simplification=2 \
  --hilbert \
  --force \
  /work/build/zcta-tiles.json

# The sidecar metadata file is documentation — nothing reads it at runtime — but it is the
# record of what flags produced the archive, and the OLD one is how Bug 2 was finally pinned
# down: it carried `dropped_by_rate` and `tiny_polygons` counts at every zoom. Regenerate it
# here so it can never describe a different tileset than the one shipped.
echo "== tileset metadata sidecar =="
node -e '
  const fs = require("fs"), zlib = require("zlib");
  const { bytesToHeader } = require("pmtiles");
  const fd = fs.openSync("build/us_zip_codes.pmtiles", "r");
  const rd = (o, l) => { const b = Buffer.alloc(l); fs.readSync(fd, b, 0, l, o); return b; };
  const hb = rd(0, 127);
  const h = bytesToHeader(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.length));
  let m = rd(h.jsonMetadataOffset, h.jsonMetadataLength);
  if (h.internalCompression === 2) m = zlib.gunzipSync(m);
  const meta = JSON.parse(m.toString("utf8"));
  meta.minzoom = String(h.minZoom);
  meta.maxzoom = String(h.maxZoom);
  meta.bounds = [h.minLon, h.minLat, h.maxLon, h.maxLat].map(v => v.toFixed(6)).join(",");
  fs.writeFileSync("public/data/us_zip_codes.pmtiles.metadata.json", JSON.stringify(meta, null, 4) + "\n");
  console.log("strategies:", JSON.stringify(meta.strategies ?? null), "(null = nothing was dropped)");
'

# --- geometry sidecar --------------------------------------------------------------------------------
# `-points inner` is mapshaper's ST_PointOnSurface: guaranteed inside the polygon. The
# lat/lng in zcta-meta.csv are centroids, which for a C-shaped or multipart ZCTA land in the
# neighbouring ZIP or in open water.
echo "== geometry sidecar =="
$MS mapshaper build/zcta-master.json -points inner \
  -each 'lon = +this.x.toFixed(6), lat = +this.y.toFixed(6)' \
  -filter-fields ZCTA5CE20,lon,lat,bw,bs,be,bn \
  -o public/data/zcta-geom.csv format=csv

# --- verify --------------------------------------------------------------------------------
# awk, not `wc -l`: mapshaper writes the CSV with no trailing newline, so wc undercounts by
# one and the coverage check would compare against 33,779 while the archive correctly carries 33,780.
EXPECT=$(awk 'END{print NR-1}' public/data/zcta-geom.csv)
echo "== coverage against ${EXPECT} source features =="
# --sizes: below z7 tile quantisation drops ZCTAs smaller than a pixel (567 at z2, 207 at z3,
# none at z7+, all under 0.12 px across). The gate allows an absence only under 0.5 px, so a
# ZCTA big enough to see can never go missing.
# --max-tile-bytes 1000000: the original 500 KB cap was written when the tileset still dropped features
# to stay small. Carrying every ZCTA at low zoom is the point of this rebuild, and the
# measured worst tile is 806,400 B raw at z2 (0.71 MB stored across all three z2 tiles). The
# cap stays a tripwire against a genuinely pathological future vintage, with ~24% headroom
# over what we actually produce.
node scripts/geometry/verify_coverage.mjs build/us_zip_codes.pmtiles \
  --expect "$EXPECT" --min 2 --max 10 --max-tile-bytes 1000000 \
  --sizes public/data/zcta-geom.csv \
  --report build/coverage-after.json

echo
echo "== sizes =="
ls -l build/us_zip_codes.pmtiles public/data/zcta-geom.csv
echo
echo "Lock file to update: $LOCK"
