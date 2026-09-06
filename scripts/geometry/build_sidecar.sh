#!/usr/bin/env bash
# Spec 5.2 step 1 + 5.5: the geometry sidecar. No tiling, no tippecanoe.
# Produces build/zcta-master.json and public/data/zcta-geom.csv.
set -euo pipefail

SHP="public/data/temp-geo/cb_2020_us_zcta520_500k/cb_2020_us_zcta520_500k.shp"
MS="npx --yes --package=mapshaper@0.7.58"
TERRITORY='this.bounds[0] >= -180 && this.bounds[2] <= -64 && this.bounds[1] >= 17 && this.bounds[3] <= 72'

echo "== A4: capture the territory-filtered features before dropping them =="
$MS mapshaper-xl 8gb "$SHP" -proj wgs84 \
  -filter "ZCTA5CE20 != null" \
  -filter "$TERRITORY" invert \
  -filter-fields ZCTA5CE20 \
  -o build/zcta-territory-dropped.csv format=csv

echo "== 5.2 step 1: bounds captured BEFORE any point conversion, then simplify =="
$MS mapshaper-xl 8gb "$SHP" -proj wgs84 \
  -filter "ZCTA5CE20 != null" \
  -filter "$TERRITORY" \
  -each 'var b=this.bounds; bw=+b[0].toFixed(4); bs=+b[1].toFixed(4); be=+b[2].toFixed(4); bn=+b[3].toFixed(4)' \
  -simplify visvalingam interval=20 keep-shapes \
  -clean \
  -o build/zcta-master.json format=geojson precision=0.00001

echo "== 5.5: point-on-surface anchor + the bbox columns =="
$MS mapshaper build/zcta-master.json -points inner \
  -each 'lon = +this.x.toFixed(6), lat = +this.y.toFixed(6)' \
  -filter-fields ZCTA5CE20,lon,lat,bw,bs,be,bn \
  -o public/data/zcta-geom.csv format=csv

echo "== done =="
