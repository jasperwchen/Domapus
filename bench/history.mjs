// Benchmarks historical builds, each with the data it shipped. The geometry
// format changed with the architecture (GeoJSON -> PMTiles), so there is no
// "same app, different data" to hold constant. See docs/ENGINEERING-LOG.md Part 5.
//
//   node bench/history.mjs                    # the default checkpoint set
//   node bench/history.mjs <sha> <sha> ...    # explicit commits
//   node bench/history.mjs --keep             # leave worktrees for inspection
//
// Then:  node bench/compare.mjs bench/results/hist-*.json
import { execFileSync, spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createGzip } from "node:zlib";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";

const BASE_SEG = "Domapus";
const BASE = `/${BASE_SEG}/`;
const PORT = 4319;

// One representative per meaningful architectural step. Resolved at runtime so
// this list survives rebases; a sha that no longer exists is skipped with a note.
const DEFAULT_CHECKPOINTS = [
  // Chosen by what actually changed load cost, not by the calendar. Each entry
  // is the commit whose message names a data-path or rendering change.
  // Broken commits are not excluded up front: run.mjs flags them invalid and
  // compare.mjs leaves a gap, which is more honest than pretending they ran.
  // runs is lower for the heavy early builds — the Leaflet era transfers
  // 177 MB per load and 9 of those exhausted the process.
  ["01-leaflet-geojson",   "87ca825", 3],  // v1.0.0, Leaflet + raw GeoJSON
  ["02-uncompressed-data", "65f9b2a", 4],  // "Serve data files uncompressed"
  ["03-pmtiles",           "87308f8", 5],  // "Unify metrics and implement PMTiles"
  ["04-d3-scales",         "ee9ea65", 5],  // "migrate to d3"
  ["05-web-worker",        "252ab1b", 5],  // "Web worker optimization"
  ["06-columnar-json",     "8e1c9fe", 5],  // "Implement columnar JSON format"
  ["07-lite-progressive",  "ac5e548", 5],  // "zcta lite data load"
  ["08-drop-legacy",       "740e927", 5],  // "drop legacy keyed format in worker"
  ["09-head",              "HEAD",    5],
];

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const explicit = argv.filter((a) => !a.startsWith("--"));
const checkpoints = explicit.length
  ? explicit.map((sha) => [`hist-${sha.slice(0, 7)}`, sha, 5])
  : DEFAULT_CHECKPOINTS;

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".pmtiles": "application/octet-stream", ".gz": "application/gzip",
  ".csv": "text/csv", ".txt": "text/plain", ".xml": "application/xml",
};
// GitHub Pages gzips text but not compressed binaries; match it or transfer lies.
const GZIP = new Set([".html", ".js", ".css", ".json", ".svg", ".csv", ".txt", ".xml", ".webmanifest"]);

/** Mirrors GitHub Pages: BASE prefix, gzip on text, Range support for PMTiles. */
function serve(root) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!path.startsWith(BASE)) return void res.writeHead(404).end();
    const rel = normalize(path.slice(BASE.length)) || "index.html";
    if (rel.includes("..")) return void res.writeHead(403).end();
    let file = join(root, rel);
    if (!existsSync(file) || (await stat(file)).isDirectory()) file = join(root, "index.html");
    if (!existsSync(file)) return void res.writeHead(404).end();

    const ext = extname(file);
    const info = await stat(file);
    const headers = { "content-type": MIME[ext] || "application/octet-stream", "accept-ranges": "bytes" };

    if (req.headers.range) {
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range);
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : info.size - 1;
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${info.size}`,
                           "content-length": end - start + 1 });
      return void createReadStream(file, { start, end }).pipe(res);
    }
    if (GZIP.has(ext) && /gzip/.test(req.headers["accept-encoding"] || "")) {
      res.writeHead(200, { ...headers, "content-encoding": "gzip" });
      return void createReadStream(file).pipe(createGzip()).pipe(res);
    }
    res.writeHead(200, { ...headers, "content-length": info.size });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

const done = [];
const skipped = [];

for (const [label, ref, nRuns = 5] of checkpoints) {
  let sha;
  try {
    sha = git("rev-parse", "--short", ref);
  } catch {
    skipped.push([label, ref, "commit not found"]);
    continue;
  }

  console.log(`\n=== ${label} (${sha}) ===`);
  // Resume: a finished checkpoint keeps its result file, so a crash costs one entry.
  if (existsSync(join("bench/results", label + ".json")) && !argv.includes("--force")) {
    console.log(`  ${label} (${sha}): already measured, skipping`);
    done.push(label);
    continue;
  }

  const wt = await mkdtemp(join(tmpdir(), `domapus-${label}-`));
  let server;
  try {
    // --detach: never move a branch. --force: the path is fresh each time.
    git("worktree", "add", "--detach", "--force", wt, sha);

    const has = (p) => existsSync(join(wt, p));
    if (!has("package.json")) throw new Error("no package.json at this commit");

    console.log("  installing…");
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: wt, stdio: "pipe", shell: true });

    console.log("  building…");
    // Old commits predate the prune step, so call vite directly.
    execFileSync("npx", ["vite", "build"], { cwd: wt, stdio: "pipe", shell: true,
                                             env: { ...process.env, NODE_ENV: "production" } });

    const dist = join(wt, "dist");
    if (!existsSync(dist)) throw new Error("build produced no dist/");

    server = await serve(dist);
    console.log(`  serving http://localhost:${PORT}${BASE}`);

    // URL-state params did not exist in every era; run.mjs records whether pinning applied.
    await new Promise((ok, no) => {
      const p = spawn("node", ["bench/run.mjs", "--url", `http://localhost:${PORT}${BASE}`,
                               "--label", label, "--runs", String(nRuns)],
                      { stdio: "inherit", shell: false });
      p.on("exit", (c) => (c === 0 ? ok() : no(new Error(`run.mjs exited ${c}`))));
    });
    done.push(label);
  } catch (err) {
    const msg = (err.stderr?.toString() || err.message || "").split("\n").slice(-3).join(" ").trim();
    console.log(`  SKIPPED: ${msg.slice(0, 200)}`);
    skipped.push([label, sha, msg.slice(0, 200)]);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (!keep) {
      try { git("worktree", "remove", "--force", wt); } catch { await rm(wt, { recursive: true, force: true }); }
    } else {
      console.log(`  worktree kept at ${wt}`);
    }
  }
}

console.log(`\n${done.length} benchmarked, ${skipped.length} skipped`);
for (const [l, s, why] of skipped) console.log(`  skip ${l} (${s}): ${why}`);
if (done.length > 1) {
  console.log(`\nnode bench/compare.mjs ${done.map((l) => `bench/results/${l}.json`).join(" ")}`);
}
