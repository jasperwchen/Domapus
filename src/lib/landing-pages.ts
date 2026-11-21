import { useEffect, useState } from "react";

// Links into the static landing pages that scripts/build-pages.mjs writes at build time.
let list: Promise<Record<string, string>> | null = null;

/** The metro's landing-page URL, or null while the list loads and for metros with no page. */
export function useMetroPageUrl(metro: string | null | undefined): string | null {
  const [pages, setPages] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    (list ??= import("./metro-pages").then((m) => m.METRO_PAGES)).then((p) => { if (live) setPages(p); });
    return () => { live = false; };
  }, []);
  const slug = metro && pages ? pages[metro] : undefined;
  return slug ? `${import.meta.env.BASE_URL}metro/${slug}/` : null;
}
