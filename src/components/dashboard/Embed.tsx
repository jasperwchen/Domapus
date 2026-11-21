import { Code2, ExternalLink } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { track } from "@/lib/analytics";
import { embedCode } from "@/lib/embed";

const BASE_PATH = import.meta.env.BASE_URL;

/** In the export panel: the embed is the live map rather than a picture, so it copies the
 *  main map's view, not the export's region. */
export function EmbedSection({ metric }: { metric: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(embedCode(window.location.href));
      toast({
        title: "Embed code copied",
        description: "Paste it into your page's HTML. It shows the metric and view you have open now.",
      });
      track("embed_copy", { metric });
    } catch {
      toast({ title: "Could not copy the embed code", description: "Your browser blocked clipboard access." });
    }
  };
  return (
    <div className="p-2 md:p-3 rounded-md border bg-muted/20 space-y-2">
      <div className="flex items-center gap-2 text-xs md:text-sm font-medium">
        <Code2 className="h-3.5 w-3.5 shrink-0" />
        <span>Embed</span>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Put the live map on your own page. It opens on the metric and view the main map has now.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={copy} className="w-full">
        Copy embed code
      </Button>
    </div>
  );
}

/** The embed's only chrome: names the site and the data source, and opens the same view on it.
 *  Embeds sit on other people's pages, where the source is otherwise never named. Phone-width
 *  frames put the legend top-left, so the chip moves to the bottom there, above the attribution. */
export function EmbedCredit({ label, source, bottom }: { label: string; source: string; bottom: boolean }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.delete("embed");
  const query = params.size ? `?${params}` : "";
  return (
    <a
      href={`${BASE_PATH}${query}`}
      target="_blank"
      rel="noopener"
      className={`absolute ${bottom ? "bottom-10" : "top-3"} left-3 z-[10] flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-md border border-border bg-card/95 px-2.5 py-1.5 text-xs shadow-md backdrop-blur-sm hover:bg-card`}
      aria-label="Open this map on Domapus (opens in a new tab)"
    >
      <img src={`${BASE_PATH}Logo.svg`} alt="" width="18" height="18" className="h-[18px] w-[18px] shrink-0" />
      <span className="shrink-0 font-semibold text-foreground">Domapus</span>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 text-muted-foreground">Data: {source}</span>
      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
    </a>
  );
}
