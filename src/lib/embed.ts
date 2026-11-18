const BASE_PATH = import.meta.env.BASE_URL;

export function isEmbed(search: string): boolean {
  return new URLSearchParams(search).get("embed") === "1";
}

/** The iframe snippet for the current metric and camera. The selected ZIP is dropped: an
 *  embed is a map, and a ZIP in the URL would open the detail panel over it. */
export function embedCode(href: string, basePath: string = BASE_PATH): string {
  const url = new URL(href);
  url.searchParams.delete("zip");
  url.searchParams.set("embed", "1");
  const src = `${url.origin}${basePath}?${url.searchParams}`.replace(/&/g, "&amp;");
  return `<iframe src="${src}" width="100%" height="520" style="border:0" loading="lazy" title="Domapus housing map"></iframe>`;
}
