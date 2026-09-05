// Keep the copyright range's END year current. The START year never moves.
//
//     node scripts/update_license_year.mjs           # rewrite if needed
//     node scripts/update_license_year.mjs --check    # exit 1 if stale, write nothing
//     node scripts/update_license_year.mjs --year 2030
//
// "Copyright 2025-2026 Jasper Chen" becomes "Copyright 2025-2031 Jasper Chen" in
// 2031 and so on. 2025 is when the work was first published and is a statement of
// fact about the past, so it is never rewritten; the end year is the last year the
// work was modified, which is what has to advance.
//
// A single-year notice is widened rather than replaced: "Copyright 2025 X" in 2026
// becomes "Copyright 2025-2026 X", because dropping 2025 would shorten the term
// claimed rather than extend it.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every file carrying a copyright line. Add here, not to a glob: a glob would
// sweep node_modules and dist and rewrite third-party notices, which is both
// wrong and a licence violation.
const FILES = ["LICENSE.md"];

// `Copyright <start>[-<end>] <holder>`. The holder is captured so the rewrite
// cannot silently change it.
const NOTICE = /(Copyright\s+)(\d{4})(?:\s*[-–]\s*(\d{4}))?(\s+\S)/g;

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const yearArg = argv.indexOf("--year");
const target = yearArg >= 0 ? Number(argv[yearArg + 1]) : new Date().getFullYear();

if (!Number.isInteger(target) || target < 2000 || target > 2999) {
  console.error(`refusing to write an implausible year: ${target}`);
  process.exit(2);
}

const changed = [];
const problems = [];

for (const rel of FILES) {
  const path = join(ROOT, rel);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    problems.push(`${rel}: not found`);
    continue;
  }

  let found = 0;
  const next = text.replace(NOTICE, (whole, prefix, start, end, tail) => {
    found++;
    const startYear = Number(start);
    if (startYear > target) {
      // The file claims a start year in the future. Something is wrong with the
      // file or the clock; do not "fix" it by inventing a backwards range.
      problems.push(`${rel}: start year ${startYear} is after the target year ${target}`);
      return whole;
    }
    if (startYear === target) return `${prefix}${start}${tail}`;
    return `${prefix}${start}-${target}${tail}`;
  });

  if (found === 0) {
    problems.push(`${rel}: no "Copyright <year>" notice found — has the file changed shape?`);
    continue;
  }
  if (next !== text) {
    changed.push(rel);
    if (!check) writeFileSync(path, next, "utf8");
  }
}

if (problems.length) {
  console.error("PROBLEMS:\n  " + problems.join("\n  "));
  process.exit(2);
}

if (changed.length === 0) {
  console.log(`Copyright year already ${target} in ${FILES.join(", ")}.`);
  process.exit(0);
}

if (check) {
  console.error(`Copyright year is stale (should end ${target}): ${changed.join(", ")}`);
  console.error("Run: node scripts/update_license_year.mjs");
  process.exit(1);
}

console.log(`Updated copyright end year to ${target} in ${changed.join(", ")}.`);
