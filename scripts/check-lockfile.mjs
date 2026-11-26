// Refuses a staged lockfile that CI's `npm ci` would reject. npm 11.6 writes lockfiles
// without Rolldown's optional @emnapi peers and installs from them happily; the npm that
// setup-node shipped with Node 24 on CI (11.19) refuses them, so Deploy failed on
// 2026-11-20 and again on 2026-11-21 for commits that installed fine locally. The check uses
// the npm version pinned in package.json's packageManager, which every workflow installs.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const staged = git("diff", "--cached", "--name-only").split("\n");
if (!staged.includes("package.json") && !staged.includes("package-lock.json")) process.exit(0);

const dir = mkdtempSync(join(tmpdir(), "lockcheck-"));
try {
  for (const f of ["package.json", "package-lock.json"]) writeFileSync(join(dir, f), git("show", `:${f}`));
  const npm = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).packageManager;
  const run = spawnSync(`npx --yes ${npm} ci --dry-run --ignore-scripts --no-audit --no-fund`, {
    cwd: dir,
    encoding: "utf8",
    shell: true,
  });
  if (run.status !== 0) {
    const why = (run.stderr + run.stdout).split("\n").filter((l) => /Missing|Invalid|ERR|error code/.test(l));
    console.error(`package-lock.json would fail \`npm ci\` on CI (${npm}):\n${why.join("\n")}`);
    console.error(`Fix: npx ${npm} install --package-lock-only, then stage package-lock.json.`);
    process.exit(1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
