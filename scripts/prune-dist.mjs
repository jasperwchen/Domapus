// Drops files Vite copies out of public/ that the deployed site never fetches.
// preview.png (og:image) and the README screenshots are published on purpose.
//
// Usage: node scripts/prune-dist.mjs [dir] [--preview]
import { rm, stat, readdir } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const isPreview = args.includes("--preview");
const DIST = args.find((a) => !a.startsWith("--")) ?? "dist";

const ALWAYS = [
  "data/archive",       // monthly snapshots; no code path reads them
  "data/zcta-meta.csv", // pipeline input, read by pipeline/dim.py; the site never fetches it
];

// Linked only from the production URL, so a preview copy is dead weight.
const PREVIEW_ONLY = [
  "show.png",
  "readme",
];

let freed = 0;
for (const rel of isPreview ? [...ALWAYS, ...PREVIEW_ONLY] : ALWAYS) {
  const path = join(DIST, rel);
  try {
    const info = await stat(path);
    freed += info.isDirectory() ? await dirSize(path) : info.size;
    await rm(path, { recursive: true, force: true });
    console.log(`pruned ${rel}`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
console.log(`prune-dist: freed ${(freed / 1048576).toFixed(1)} MB from ${DIST}`);

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}
