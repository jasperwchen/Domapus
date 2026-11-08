import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { matchMetros } from "@/lib/metros";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface SearchBoxProps {
  onSearch: (zipCode: string, trigger: number) => void;
  /** Metro names, biggest first. Empty until the snapshot lands; ZIP search still works. */
  metros?: readonly string[];
  /** A metro picked, or null when the box is emptied (clears the outline). */
  onMetroSearch?: (metro: string | null) => void;
  /** Open suggestions above the box (the phone's search sits at the bottom of the screen). */
  dropUp?: boolean;
}

export function SearchBox({ onSearch, metros = [], onMetroSearch, dropUp = false }: SearchBoxProps) {
  const [searchValue, setSearchValue] = useState("");
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLFormElement>(null);

  const isZip = /^\d*$/.test(searchValue.trim());
  const suggestions = useMemo(
    () => (isZip ? [] : matchMetros(metros, searchValue)),
    [isZip, metros, searchValue],
  );
  const listOpen = open && suggestions.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(/^\d*$/.test(value.trim()) ? value.replace(/\D/g, "").slice(0, 5) : value);
    setActive(0);
    setOpen(true);
    if (!value.trim()) onMetroSearch?.(null);
  };

  const pickMetro = useCallback((metro: string) => {
    setSearchValue(metro);
    setOpen(false);
    onMetroSearch?.(metro);
  }, [onMetroSearch]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const value = searchValue.trim();
    if (!value) return;
    if (!isZip) {
      if (suggestions.length > 0) pickMetro(suggestions[Math.min(active, suggestions.length - 1)]);
      else toast({ title: `No metro matches "${value}"`, description: "Try a city name, or a 5-digit ZIP code." });
      return;
    }
    onMetroSearch?.(null);
    // Increment trigger to force flyTo even if same ZIP
    const newTrigger = searchTrigger + 1;
    setSearchTrigger(newTrigger);
    // "501" means 00501: ZIPs are strings, and New England's lose their zeros when typed.
    onSearch(value.padStart(5, "0"), newTrigger);
  }, [searchValue, isZip, suggestions, active, pickMetro, onMetroSearch, searchTrigger, onSearch]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!suggestions.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    if (!open) { setOpen(true); return; }
    const step = e.key === "ArrowDown" ? 1 : -1;
    setActive((i) => (i + step + suggestions.length) % suggestions.length);
  };

  return (
    <form
      id="zip-search"
      ref={rootRef}
      onSubmit={handleSubmit}
      className="flex items-center gap-2 w-full min-w-0 group"
    >
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dashboard-text-secondary" />
        <Input
          type="text"
          placeholder="Enter ZIP code or metro..."
          value={searchValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={e => { e.currentTarget.select(); setOpen(true); }}
          onClick={e => e.currentTarget.select()}
          className="pl-10 w-full"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls="search-suggestions"
          aria-activedescendant={listOpen ? `search-opt-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Search for ZIP code or metro"
        />
        {listOpen && (
          <ul
            id="search-suggestions"
            role="listbox"
            className={cn(
              "absolute z-50 right-0 w-max min-w-full max-w-[18rem] rounded-md border border-border bg-popover py-1 shadow-lg",
              dropUp ? "bottom-full mb-1" : "top-full mt-1",
            )}
          >
            {suggestions.map((m, i) => (
              <li
                key={m}
                id={`search-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerDown={(e) => { e.preventDefault(); pickMetro(m); }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "cursor-pointer truncate px-3 py-1.5 text-sm",
                  i === active && "bg-accent text-accent-foreground",
                )}
              >
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button type="submit" variant="outline" size="sm" className="flex-shrink-0" aria-label="Search">
        Search
      </Button>
    </form>
  );
}
