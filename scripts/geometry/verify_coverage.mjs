#!/usr/bin/env node
// Coverage and max raw tile size checks on the finished tileset.
//
// A choropleth whose tiles quietly dropped 6% of its polygons still renders, still passes a
// build, and still looks plausible — the missing ZIPs read as "no data". Nothing in the old
// pipeline ever opened the finished archive and counted what was actually in it. This does.
//
// Decodes the .pmtiles directly: header -> directories -> every tile -> MVT -> the id
// attribute, and asserts every source feature is present at EVERY zoom. With --sizes, a
// feature may be absent at a zoom where its bounding box is under --max-dropped-px across:
// tile quantisation drops those, and at that size nothing on screen can show the difference.
//
//   node scripts/geometry/verify_coverage.mjs build/us_zip_codes.pmtiles --expect 33780
//   node scripts/geometry/verify_coverage.mjs <file> --expect N --min 2 --max 10 \
//     --sizes public/data/zcta-geom.csv --max-dropped-px 0.5
//
// Exits non-zero on any shortfall, so it is usable as a workflow gate.

import fs from "node:fs";
import zlib from "node:zlib";
import { bytesToHeader, tileIdToZxy } from "pmtiles";

const MAX_RAW_TILE_BYTES = 500_000;
// Measured 2026-09-24: every ZCTA the tileset drops, at any zoom, is under 0.12 CSS px.
const MAX_DROPPED_PX = 0.5;
const ID_ATTRIBUTE = "ZCTA5CE20";

// ---------------------------------------------------------------- byte plumbing

// Node pools small Buffers, so a bare `.buffer` hands back the whole pool rather than this
// buffer's bytes. Every Buffer -> ArrayBuffer conversion in this file goes through here.
const own = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, offset + read);
    if (n === 0) throw new Error(`short read at ${offset}+${read}, wanted ${length}`);
    read += n;
  }
  return buf;
}

// pmtiles Compression: 0 unknown, 1 none, 2 gzip, 3 brotli, 4 zstd.
function decompress(buf, compression) {
  switch (compression) {
    case 0:
    case 1:
      return buf;
    case 2:
      return zlib.gunzipSync(buf);
    case 3:
      return zlib.brotliDecompressSync(buf);
    case 4:
      if (typeof zlib.zstdDecompressSync !== "function") {
        throw new Error("archive is zstd-compressed and this Node has no zstdDecompressSync");
      }
      return zlib.zstdDecompressSync(buf);
    default:
      throw new Error(`unknown compression id ${compression}`);
  }
}

// ---------------------------------------------------------------- varints

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  get done() {
    return this.pos >= this.buf.length;
  }
  // Tile ids and offsets exceed 2^32 in a large archive, so this returns a Number via
  // float accumulation rather than shifting, which would wrap at 32 bits.
  varint() {
    let result = 0;
    let shift = 1;
    for (;;) {
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) return result;
      shift *= 128;
    }
  }
  skipVarint() {
    while (this.buf[this.pos++] & 0x80);
  }
  bytes(n) {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

// ---------------------------------------------------------------- pmtiles directory

// PMTiles v3 directory: numEntries, then four delta/plain varint columns.
// runLength 0 marks a leaf-directory pointer rather than a tile.
function deserializeDirectory(buf) {
  const r = new Reader(buf);
  const n = r.varint();
  const entries = new Array(n);

  let lastId = 0;
  for (let i = 0; i < n; i++) {
    lastId += r.varint();
    entries[i] = { tileId: lastId, offset: 0, length: 0, runLength: 0 };
  }
  for (let i = 0; i < n; i++) entries[i].runLength = r.varint();
  for (let i = 0; i < n; i++) entries[i].length = r.varint();
  for (let i = 0; i < n; i++) {
    const v = r.varint();
    // 0 is the "contiguous with the previous entry" encoding, not a real offset.
    entries[i].offset = v === 0 && i > 0
      ? entries[i - 1].offset + entries[i - 1].length
      : v - 1;
  }
  return entries;
}

function collectTiles(fd, header) {
  const tiles = [];
  const walk = (offset, length, depth) => {
    if (depth > 4) throw new Error("directory nesting deeper than 4 — malformed archive");
    const raw = decompress(readAt(fd, offset, length), header.internalCompression);
    for (const e of deserializeDirectory(raw)) {
      if (e.runLength === 0) {
        walk(header.leafDirectoryOffset + e.offset, e.length, depth + 1);
      } else {
        tiles.push(e);
      }
    }
  };
  walk(header.rootDirectoryOffset, header.rootDirectoryLength, 0);
  return tiles;
}

// ---------------------------------------------------------------- MVT

// Tile.layers = 3. Layer: 1 name, 2 features, 3 keys, 4 values, 5 extent.
// Feature: 1 id, 2 tags (packed), 3 type, 4 geometry (packed). Value: 1 string.
function idsInTile(buf, attribute, out) {
  const r = new Reader(buf);
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 3 && wire === 2) {
      readLayer(r.bytes(r.varint()), attribute, out);
    } else {
      skipField(r, wire);
    }
  }
}

function readLayer(buf, attribute, out) {
  const r = new Reader(buf);
  const keys = [];
  const values = [];
  const featureTagSpans = [];

  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire !== 2) {
      skipField(r, wire);
      continue;
    }
    const body = r.bytes(r.varint());
    if (field === 3) keys.push(body.toString("utf8"));
    else if (field === 4) values.push(readValue(body));
    else if (field === 2) featureTagSpans.push(readFeatureTags(body));
    // field 1 (name) and anything else is not needed for a coverage count.
  }

  const keyIndex = keys.indexOf(attribute);
  if (keyIndex < 0) return; // handled by the caller: a layer with no id attribute contributes 0

  for (const tags of featureTagSpans) {
    for (let i = 0; i + 1 < tags.length; i += 2) {
      if (tags[i] === keyIndex) {
        const v = values[tags[i + 1]];
        if (v !== undefined) out.add(v);
        break;
      }
    }
  }
}

function readFeatureTags(buf) {
  const r = new Reader(buf);
  let tags = [];
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 2 && wire === 2) {
      const inner = new Reader(r.bytes(r.varint()));
      while (!inner.done) tags.push(inner.varint());
    } else {
      skipField(r, wire);
    }
  }
  return tags;
}

function readValue(buf) {
  const r = new Reader(buf);
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) return r.bytes(r.varint()).toString("utf8");
    // A non-string id would itself be the bug (leading zeros must survive), so
    // surface the type rather than coercing it into something that compares equal.
    if (field === 4 || field === 5) return `#int:${r.varint()}`;
    skipField(r, wire);
  }
  return undefined;
}

function skipField(r, wire) {
  if (wire === 0) r.skipVarint();
  else if (wire === 1) r.pos += 8;
  else if (wire === 2) {
    // Not `r.pos += r.varint()`. JS reads the left-hand `r.pos` before evaluating the
    // right-hand call, so the length prefix's own bytes get skipped twice over — the
    // reader lands short and the next tag byte is read out of the middle of a field.
    const n = r.varint();
    r.pos += n;
  } else if (wire === 5) r.pos += 4;
  else throw new Error(`unsupported wire type ${wire}`);
}

// ---------------------------------------------------------------- main

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: verify_coverage.mjs <archive.pmtiles> --expect <feature-count> [--min z] [--max z]");
  process.exit(2);
}

const fd = fs.openSync(file, "r");
const header = bytesToHeader(own(readAt(fd, 0, 127)));

const expect = Number(arg("expect", NaN));
const minZoom = Number(arg("min", header.minZoom));
const maxZoom = Number(arg("max", header.maxZoom));
const tileCap = Number(arg("max-tile-bytes", MAX_RAW_TILE_BYTES));
const maxDroppedPx = Number(arg("max-dropped-px", MAX_DROPPED_PX));

if (!Number.isFinite(expect)) {
  console.error("--expect <feature-count> is required: coverage compares against the source count.");
  process.exit(2);
}

console.log(`archive   ${file}`);
console.log(`header    z${header.minZoom}..z${header.maxZoom}, tileCompression=${header.tileCompression}, ${fs.statSync(file).size.toLocaleString()} B`);
console.log(`expecting ${expect.toLocaleString()} distinct ${ID_ATTRIBUTE} at every zoom z${minZoom}..z${maxZoom}\n`);

// Bounding boxes from the geometry sidecar (absolute degrees), keyed by ZCTA.
const boxes = new Map();
const sizesPath = arg("sizes", "");
if (sizesPath) {
  const [head, ...rows] = fs.readFileSync(sizesPath, "utf8").trim().split(/\r?\n/);
  const col = Object.fromEntries(head.split(",").map((n, i) => [n, i]));
  for (const line of rows) {
    const c = line.split(",");
    boxes.set(c[col[ID_ATTRIBUTE]].padStart(5, "0"), {
      w: +c[col.be] - +c[col.bw], h: +c[col.bn] - +c[col.bs], lat: +c[col.lat],
    });
  }
  console.log(`sizes     ${sizesPath}: ${boxes.size.toLocaleString()} boxes, absent allowed under ${maxDroppedPx} px\n`);
}

/** Larger side of a feature's bounding box in CSS px at zoom z (512 px tiles), or Infinity
 *  when its size is unknown, so an unmeasured absence always fails. */
function pxAt(id, z) {
  const b = boxes.get(id);
  if (!b) return Infinity;
  const perDeg = (512 * 2 ** z) / 360;
  return Math.max(b.w * perDeg, (b.h * perDeg) / Math.cos((b.lat * Math.PI) / 180));
}

const perZoom = new Map(); // z -> { ids:Set, tiles, rawBytes, maxRaw, maxRawAt }
// Identical tile bytes can back a run of tile ids; decode each distinct blob once.
const decoded = new Map(); // offset -> Set of ids

for (const e of collectTiles(fd, header)) {
  for (let k = 0; k < e.runLength; k++) {
    const [z, x, y] = tileIdToZxy(e.tileId + k);
    if (z < minZoom || z > maxZoom) continue;

    let bucket = perZoom.get(z);
    if (!bucket) {
      bucket = { ids: new Set(), tiles: 0, rawBytes: 0, storedBytes: 0, maxRaw: 0, maxRawAt: "" };
      perZoom.set(z, bucket);
    }

    let ids = decoded.get(e.offset);
    let rawLen;
    if (ids === undefined) {
      const raw = decompress(readAt(fd, header.tileDataOffset + e.offset, e.length), header.tileCompression);
      ids = new Set();
      idsInTile(raw, ID_ATTRIBUTE, ids);
      decoded.set(e.offset, ids);
      decoded.set(`len:${e.offset}`, raw.length);
      rawLen = raw.length;
    } else {
      rawLen = decoded.get(`len:${e.offset}`);
    }

    bucket.tiles++;
    bucket.rawBytes += rawLen;
    bucket.storedBytes += e.length;
    if (rawLen > bucket.maxRaw) {
      bucket.maxRaw = rawLen;
      bucket.maxRawAt = `${z}/${x}/${y}`;
    }
    for (const id of ids) bucket.ids.add(id);
  }
}

// The id universe is whatever the deepest zoom carries: at maxzoom nothing is dropped, so
// that set IS the source. Taking it from the tileset rather than from a count means the two
// sides of the comparison cannot drift apart in different files.
const universe = new Set();
for (const b of perZoom.values()) for (const id of b.ids) universe.add(id);

let failed = false;
const summary = [];

if (universe.size !== expect) {
  console.error(
    `FAIL: the archive carries ${universe.size.toLocaleString()} distinct ${ID_ATTRIBUTE} ` +
      `across all zooms, but the source has ${expect.toLocaleString()}.`,
  );
  failed = true;
}

console.log("  z |    tiles | polygons |  absent | largest absent px | visible absent |  raw MB | stored MB | max raw tile | at");
console.log("----+----------+----------+---------+-------------------+----------------+---------+-----------+--------------+------------");
for (let z = minZoom; z <= maxZoom; z++) {
  const b = perZoom.get(z);
  if (!b) {
    console.log(`  ${String(z).padStart(2)} | ${"NO TILES".padStart(8)}`);
    failed = true;
    summary.push({ zoom: z, tiles: 0, polygons: 0, absent: expect, visible_absent: expect, max_raw_tile_bytes: 0 });
    continue;
  }
  const absent = [...universe].filter((id) => !b.ids.has(id));
  const sizes = absent.map((id) => pxAt(id, z));
  const visible = absent.filter((_, i) => sizes[i] >= maxDroppedPx);
  const largest = sizes.length ? Math.max(...sizes) : 0;
  const overCap = b.maxRaw >= tileCap;
  if (visible.length) failed = true;
  console.log(
    `  ${String(z).padStart(2)} | ${b.tiles.toLocaleString().padStart(8)} | ` +
      `${b.ids.size.toLocaleString().padStart(8)} | ${String(absent.length).padStart(7)} | ` +
      `${(sizes.length ? largest.toFixed(3) : "-").padStart(17)} | ${String(visible.length).padStart(14)} | ` +
      `${(b.rawBytes / 1048576).toFixed(2).padStart(7)} | ` +
      `${(b.storedBytes / 1048576).toFixed(2).padStart(9)} | ${b.maxRaw.toLocaleString().padStart(12)} | ` +
      `${b.maxRawAt}${visible.length ? "  <-- FAIL" : overCap ? "  (over raw cap)" : ""}`,
  );
  summary.push({
    zoom: z,
    tiles: b.tiles,
    polygons: b.ids.size,
    absent: absent.length,
    largest_absent_px: sizes.length ? +largest.toFixed(3) : null,
    visible_absent: visible.length,
    visible_absent_ids: visible.slice(0, 50),
    raw_bytes: b.rawBytes,
    stored_bytes: b.storedBytes,
    max_raw_tile_bytes: b.maxRaw,
    max_raw_tile_at: b.maxRawAt,
    over_raw_cap: overCap,
  });
}

const outPath = arg("report", "");
if (outPath) {
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        archive: file, expect, min_zoom: minZoom, max_zoom: maxZoom, tile_cap: tileCap,
        max_dropped_px: sizesPath ? maxDroppedPx : 0, per_zoom: summary,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport -> ${outPath}`);
}

if (failed) {
  const worst = summary.filter((s) => s.visible_absent > 0).sort((a, b) => b.visible_absent - a.visible_absent)[0];
  if (worst) {
    console.error(
      `\nFAIL (coverage): z${worst.zoom} is missing ${worst.visible_absent} ${ID_ATTRIBUTE}` +
        `${sizesPath ? ` at least ${maxDroppedPx} px across` : ""}, ` +
        `e.g. ${(worst.visible_absent_ids ?? []).slice(0, 8).join(" ")}`,
    );
  }
  process.exit(1);
}
const dropped = summary.filter((s) => s.absent > 0);
console.log(
  dropped.length
    ? `\nOK (coverage): every ${ID_ATTRIBUTE} at least ${maxDroppedPx} px across is drawn at every zoom ` +
        `z${minZoom}..z${maxZoom}. Smaller ones are absent at ` +
        `${dropped.map((s) => `z${s.zoom} (${s.absent})`).join(", ")}.`
    : `\nOK (coverage): every one of the ${expect.toLocaleString()} ${ID_ATTRIBUTE} is drawn at every ` +
        `zoom z${minZoom}..z${maxZoom}.`,
);
const capped = summary.filter((s) => s.over_raw_cap).map((s) => `z${s.zoom}`);
if (capped.length) {
  console.log(
    `NOTE (tile size): raw tile size exceeds ${tileCap.toLocaleString()} B at ${capped.join(", ")}. ` +
      `Raw is the decode cost, not the wire cost — see stored MB above.`,
  );
}
