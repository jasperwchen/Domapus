/**
 * The router's basename, keeping Vite's trailing slash: "/Domapus/", "/Domapus/pr-preview/pr-N/",
 * or "/" in dev. React Router writes the basename itself as the URL of "/", so "/Domapus" made
 * every URL the app wrote "/Domapus?zip=...", which GitHub Pages answers with a 301 to
 * "/Domapus/?zip=..." on each shared link.
 */
export function routerBasename(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
