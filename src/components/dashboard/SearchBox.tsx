import { useState, useCallback } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBoxProps {
  onSearch: (zipCode: string, trigger: number) => void;
}

export function SearchBox({ onSearch }: SearchBoxProps) {
  const [searchValue, setSearchValue] = useState("");
  const [searchTrigger, setSearchTrigger] = useState(0);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "");
    setSearchValue(value);
  };

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      // Increment trigger to force flyTo even if same ZIP
      const newTrigger = searchTrigger + 1;
      setSearchTrigger(newTrigger);
      // "501" means 00501: ZIPs are strings, and New England's lose their zeros when typed.
      onSearch(searchValue.trim().padStart(5, "0"), newTrigger);
    }
  }, [searchValue, searchTrigger, onSearch]);

  return (
    <form id="zip-search" onSubmit={handleSubmit} className="flex items-center gap-2 w-full min-w-0 group">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-dashboard-text-secondary" />
        <Input
          type="text"
          pattern="[0-9]*"
          inputMode="numeric"
          placeholder="Enter ZIP code..."
          value={searchValue}
          onChange={handleInputChange}
          className="pl-10 w-full"
          maxLength={5}
          aria-label="Search for ZIP code"
        />
      </div>
      <Button type="submit" variant="outline" size="sm" className="flex-shrink-0" aria-label="Search">
        Search
      </Button>
    </form>
  );
}
