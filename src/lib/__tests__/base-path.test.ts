import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// GitHub Pages has no server-side rewrite. Every route below the site root is
// served public/404.html, which stashes the requested path and bounces to the
// app shell; a script at the top of index.html puts the path back before React
// Router reads the URL.
//
// Nothing else covers that chain. `npm run dev` and `vite preview` both serve
// index.html for any path, so no bounce happens and the scripts never run;
// bench/serve.mjs falls back to index.html too. The chain therefore only
// executes in production, where it silently sent /Domapus/methodology to the
// map for as long as the restore lived in a React effect — React Router reads
// window.location once at mount and no popstate fires for history.replaceState.
//
// These tests run the SHIPPED script bodies rather than a copy of their logic,
// so rewriting either file without rewriting the other fails here.

function scriptContaining(file: string, needle: string): string {
  const html = readFileSync(file, "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes(needle));
  if (!found) throw new Error(`${file} has no inline script containing ${needle}`);
  return found;
}

const BOUNCE = scriptContaining("public/404.html", "spaPath");
const RESTORE = scriptContaining("index.html", "spaPath");

/** Run 404.html's script against a requested URL. Returns where it sent the browser. */
function bounce(requested: string) {
  const [pathname, rest = ""] = [requested.replace(/[?#].*$/, ""), requested.match(/[?#].*$/)?.[0]];
  const search = /\?[^#]*/.exec(rest ?? "")?.[0] ?? "";
  const hash = /#.*/.exec(rest ?? "")?.[0] ?? "";
  const store = new Map<string, string>();
  let replaced: string | null = null;
  const win = {
    location: {
      pathname,
      search,
      hash,
      replace: (url: string) => { replaced = url; },
    },
  };
  const storage = {
    setItem: (k: string, v: string) => void store.set(k, v),
    getItem: (k: string) => store.get(k) ?? null,
    removeItem: (k: string) => void store.delete(k),
  };
  new Function("window", "sessionStorage", BOUNCE)(win, storage);
  return { redirectedTo: replaced as string | null, stored: store.get("spaPath") ?? null };
}

/** Run index.html's script on a shell served at `shellPath` with `stored` in storage. */
function restore(shellPath: string, stored: string | null, throwOnStorage = false) {
  const store = new Map<string, string>();
  if (stored !== null) store.set("spaPath", stored);
  let url = shellPath;
  const win = {
    location: { pathname: shellPath },
    history: { replaceState: (_s: unknown, _t: string, next: string) => { url = next; } },
  };
  const storage = {
    getItem: (k: string) => { if (throwOnStorage) throw new Error("blocked"); return store.get(k) ?? null; },
    removeItem: (k: string) => void store.delete(k),
  };
  new Function("window", "sessionStorage", RESTORE)(win, storage);
  return { url, leftInStorage: store.get("spaPath") ?? null };
}

/** The full production journey: request a URL, get bounced, get restored. */
function journey(requested: string) {
  const b = bounce(requested);
  if (b.redirectedTo === null) return requested;
  const shellPath = b.redirectedTo.replace(/[?#].*$/, "");
  const tail = b.redirectedTo.slice(shellPath.length);
  return restore(shellPath, b.stored).url.replace(tail, "") + tail;
}

describe("deep links survive the GitHub Pages 404 bounce", () => {
  it.each([
    ["production", "/Domapus/methodology"],
    ["production, unknown route", "/Domapus/nope"],
    ["PR preview", "/Domapus/pr-preview/pr-5/methodology"],
    ["PR preview, nested", "/Domapus/pr-preview/pr-42/a/b"],
  ])("%s: %s round-trips to itself", (_label, path) => {
    expect(journey(path)).toBe(path);
  });

  it("keeps the query string and hash", () => {
    const b = bounce("/Domapus/methodology?metric=median_sale_price#reliability");
    expect(b.redirectedTo).toBe("/Domapus/?metric=median_sale_price#reliability");
    expect(b.stored).toBe("methodology?metric=median_sale_price#reliability");
  });

  it("bounces a preview deep link into that preview, not production", () => {
    expect(bounce("/Domapus/pr-preview/pr-5/methodology").redirectedTo)
      .toBe("/Domapus/pr-preview/pr-5/");
  });

  it.each(["/Domapus/", "/Domapus/index.html", "/Domapus/pr-preview/pr-5/", "/Domapus/pr-preview/pr-5/index.html"])(
    "does not bounce the app shell itself: %s",
    (shell) => {
      expect(bounce(shell).redirectedTo).toBeNull();
    },
  );
});

describe("the restore refuses anything it should not act on", () => {
  it("consumes the key so a reload does not re-navigate", () => {
    const r = restore("/Domapus/", "methodology");
    expect(r.url).toBe("/Domapus/methodology");
    expect(r.leftInStorage).toBeNull();
  });

  it.each([
    ["nothing stored", "/Domapus/", null],
    ["an absolute path from an older format", "/Domapus/", "/Domapus/methodology"],
    ["a protocol-relative URL", "/Domapus/", "//example.invalid/x"],
    ["an empty value", "/Domapus/", ""],
  ])("ignores %s", (_label, shell, stored) => {
    expect(restore(shell, stored).url).toBe(shell);
  });

  it("survives sessionStorage throwing, as it does in some privacy modes", () => {
    expect(restore("/Domapus/", "methodology", true).url).toBe("/Domapus/");
  });

  // The path is stored relative to the base, so an entry left by one deployment
  // resolves against whichever shell actually loaded instead of navigating to a
  // route that build cannot serve.
  it.each([
    ["production", "/Domapus/", "/Domapus/methodology"],
    ["a PR preview", "/Domapus/pr-preview/pr-5/", "/Domapus/pr-preview/pr-5/methodology"],
    ["the dev server", "/", "/methodology"],
    ["index.html named explicitly", "/Domapus/index.html", "/Domapus/methodology"],
  ])("resolves a stored path against %s", (_label, shell, expected) => {
    expect(restore(shell, "methodology").url).toBe(expected);
  });
});

describe("the restore runs before anything reads the URL", () => {
  const html = readFileSync("index.html", "utf8");

  it("sits ahead of Google Tag Manager, so the pageview reports the real path", () => {
    expect(html.indexOf("spaPath")).toBeLessThan(html.indexOf("googletagmanager.com/gtm.js"));
  });

  it("sits ahead of the data boot script, which reads location.search", () => {
    expect(html.indexOf("spaPath")).toBeLessThan(html.indexOf("__domapusBoot"));
  });

  it("is inline in <head>, not a module, which would defer past the router", () => {
    expect(html.slice(0, html.indexOf("spaPath"))).not.toMatch(/<body/i);
    expect(RESTORE).not.toContain("import ");
  });
});
