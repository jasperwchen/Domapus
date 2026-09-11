// Diffs benchmark results into markdown. Two files give before/after with
// deltas; three or more give a timeline.
//
//   node bench/compare.mjs results/baseline.json results/candidate.json
import { readFile } from "node:fs/promises";
import { SCHEMA_VERSION } from "./scenarios.mjs";

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error("need at least two result files");
  process.exit(1);
}

const results = [];
const invalid = [];
for (const f of files) {
  const r = JSON.parse(await readFile(f, "utf8"));
  // valid === undefined predates the gate: keep it, but don't claim it was checked.
  if (r.valid === false) invalid.push(r);
  else results.push(r);
}
if (invalid.length) {
  console.log(`
> **Excluded as invalid:**`);
  for (const r of invalid) console.log(`> - \`${r.label}\` — ${r.invalidReason}`);
}
if (results.length < 2) {
  console.error(`
Only ${results.length} valid result(s); nothing to compare.`);
  process.exit(1);
}

// A result written before the interaction suite has no schemaVersion; that is
// version 1 by definition.
const schemaOf = (r) => r.schemaVersion ?? 1;
const schemas = [...new Set(results.map(schemaOf))];
if (schemas.length > 1) {
  console.error(`
Refusing to compare across metric-set versions: ${schemas.sort().join(" and ")}.

${results.map((r) => `  ${r.label.padEnd(24)} schema ${schemaOf(r)}`).join("\n")}

The two sets do not contain the same measurements, so a table lining them up
side by side would present "this metric did not exist then" as a change. This is
the guard the repo lacked when phase 0 and phase 3 stopped being comparable.

Re-run the older build with the current harness to get a schema ${SCHEMA_VERSION}
result for it, or compare only files that share a version.`);
  process.exit(1);
}

const ROWS = [
  ["TTFB", (s) => s.ttfb?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["FCP", (s) => s.fcp?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["LCP", (s) => s.lcp?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["Total Blocking Time", (s) => s.tbt?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["Max long task", (s) => s.maxLongTask?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["Long task count", (s) => s.longTaskCount?.median, (v) => String(Math.round(v)), "lower"],
  ["Transfer", (s) => s.transferTotal?.median, (v) => `${(v / 1048576).toFixed(2)} MB`, "lower"],
  ["Bytes before first colour", (s) => s.gatingBytes?.median,
   (v) => `${v.toLocaleString("en-US")} B`, "lower"],
  ["Requests", (s) => s.requestCount?.median, (v) => String(Math.round(v)), "lower"],
  ["JS heap", (s) => s.heapBytes?.median, (v) => `${(v / 1048576).toFixed(1)} MB`, "lower"],
  ["JS heap after interaction", (s) => s.heapBytesAfterInteraction?.median,
   (v) => `${(v / 1048576).toFixed(1)} MB`, "lower"],
  ["Metric switch", (s) => s.metricSwitchMs?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["Worst interaction", (s) => s.worstInteractionMs?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["LoAF blocking", (s) => s.loafBlockingMs?.median, (v) => `${Math.round(v)} ms`, "lower"],
  ["CLS", (s) => s.cls?.median, (v) => v.toFixed(3), "lower"],
  ["Source reloads (must be 0)", (s) => s.sourceReloads?.max, (v) => String(v), "lower"],
];

/** Interaction rows, rendered as their own table so the load numbers stay
 *  readable. Dropped frames is the headline: it is what "laggy" means. */
function scenarioTable(results) {
  const ids = [...new Set(results.flatMap((r) => Object.keys(r.summary.scenarios || {})))];
  const rows = ids.filter((id) => results.some((r) => r.summary.scenarios?.[id]?.durationMs));
  if (!rows.length) return;
  console.log(`\n**Interaction** — dropped frames (a frame over 25 ms), then worst frame\n`);
  console.log(`| Scenario | ${results.map((r) => esc(r.label)).join(" | ")} |`);
  console.log(`|---|${results.map(() => "---:").join("|")}|`);
  for (const id of rows) {
    const cells = results.map((r) => {
      const v = r.summary.scenarios?.[id];
      if (!v?.durationMs) return "—";
      const dropped = v.dropped?.median;
      const worst = v.longestFrameMs?.median;
      return `${dropped ?? "—"} dropped, ${worst == null ? "—" : Math.round(worst) + " ms"}`;
    });
    console.log(`| \`${esc(id)}\` | ${cells.join(" | ")} |`);
  }
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");

if (results.length === 2) {
  const [a, b] = results;
  console.log(`\n### ${esc(a.label)} → ${esc(b.label)}\n`);
  console.log(
    `Conditions: net=${a.conditions.net} cpu=${a.conditions.cpu}x ` +
      `${a.conditions.viewport}, median of ${a.conditions.runs} runs\n`
  );
  if (JSON.stringify(a.conditions) !== JSON.stringify(b.conditions)) {
    console.log(`> **Conditions differ between the two runs — the comparison is not valid.**\n`);
  }
  console.log("| Metric | Before | After | Change |");
  console.log("|---|---:|---:|---:|");
  for (const [name, get, fmt] of ROWS) {
    const av = get(a.summary), bv = get(b.summary);
    if (av == null || bv == null) continue;
    const pct = av === 0 ? null : ((bv - av) / av) * 100;
    const arrow = pct == null ? "" : pct < -1 ? "faster" : pct > 1 ? "SLOWER" : "flat";
    const delta = pct == null ? "—"
      : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}% ${arrow}${av / (bv || 1) >= 2 ? ` (${(av / bv).toFixed(1)}x)` : ""}`;
    console.log(`| ${name} | ${fmt(av)} | ${fmt(bv)} | ${delta} |`);
  }
  const marks = new Set([...Object.keys(a.summary.marks || {}), ...Object.keys(b.summary.marks || {})]);
  if (marks.size) {
    console.log("\n| Instrumented mark | Before | After |");
    console.log("|---|---:|---:|");
    for (const m of [...marks].sort()) {
      const av = a.summary.marks?.[m]?.median, bv = b.summary.marks?.[m]?.median;
      console.log(`| \`${esc(m)}\` | ${av == null ? "—" : Math.round(av) + " ms"} | ${bv == null ? "—" : Math.round(bv) + " ms"} |`);
    }
  }
} else {
  console.log(`\n### Timeline — ${results.length} builds\n`);
  console.log(
    `Conditions: net=${results[0].conditions.net} cpu=${results[0].conditions.cpu}x ` +
      `${results[0].conditions.viewport}, median of ${results[0].conditions.runs} runs\n`
  );
  console.log(`| Metric | ${results.map((r) => esc(r.label)).join(" | ")} |`);
  console.log(`|---|${results.map(() => "---:").join("|")}|`);
  for (const [name, get, fmt] of ROWS) {
    const cells = results.map((r) => {
      const v = get(r.summary);
      return v == null ? "—" : fmt(v);
    });
    if (cells.every((c) => c === "—")) continue;
    console.log(`| ${name} | ${cells.join(" | ")} |`);
  }
}

scenarioTable(results);

const allWarnings = results.flatMap((r) => (r.warnings || []).map((w) => `${r.label}: ${w}`));
if (allWarnings.length) {
  console.log(`\n**Caveats**\n`);
  for (const w of [...new Set(allWarnings)]) console.log(`- ${w}`);
}
console.log();
