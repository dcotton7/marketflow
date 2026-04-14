import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { WatchlistColumnEntry, WatchlistColumnId } from "@/lib/watchlist-column-profile";
import { WATCHLIST_COLUMN_META, WATCHLIST_REQUIRED_COLUMN_IDS } from "@/lib/watchlist-column-profile";
import { Columns3, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

function columnPickerLabel(id: WatchlistColumnId): string {
  if (id === "actions") return "Row actions";
  return WATCHLIST_COLUMN_META[id].label || id;
}

export function WatchlistColumnPicker({
  columns,
  availableToAdd,
  addColumn,
  removeColumn,
  applyColumnPreset,
  triggerClassName,
}: {
  columns: WatchlistColumnEntry[];
  availableToAdd: () => WatchlistColumnId[];
  addColumn: (id: WatchlistColumnId) => void;
  removeColumn: (id: WatchlistColumnId) => void;
  applyColumnPreset?: (preset: "standard" | "simple") => void;
  triggerClassName?: string;
}) {
  const addable = availableToAdd();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("gap-1", triggerClassName)}
        >
          <Columns3 className="h-4 w-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-3">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Visible columns</p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {columns.map((c) => {
                const req = WATCHLIST_REQUIRED_COLUMN_IDS.includes(c.id);
                return (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted/50"
                  >
                    <span>{columnPickerLabel(c.id)}</span>
                    {!req ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${columnPickerLabel(c.id)}`}
                        onClick={() => removeColumn(c.id)}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">Required</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {addable.length > 0 ? (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Add column</p>
              <div className="flex flex-wrap gap-1">
                {addable.map((id) => (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => addColumn(id)}
                  >
                    <Plus className="h-3 w-3" />
                    {columnPickerLabel(id)}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {applyColumnPreset ? (
            <div className="border-t pt-2">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Layouts</p>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 flex-1 px-2 text-xs"
                  onClick={() => applyColumnPreset("standard")}
                >
                  All columns
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 flex-1 px-2 text-xs"
                  onClick={() => applyColumnPreset("simple")}
                >
                  Compact
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
