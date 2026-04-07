import { useState, useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

export interface WatchlistInlinePriceCellProps {
  value: number | null | undefined;
  onSave: (value: number) => void;
  className?: string;
  "data-testid"?: string;
}

export function WatchlistInlinePriceCell({
  value,
  onSave,
  className = "",
  "data-testid": testId = "watchlist-inline-price",
}: WatchlistInlinePriceCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(() =>
    value != null && Number.isFinite(value) ? value.toFixed(2) : ""
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(value != null && Number.isFinite(value) ? value.toFixed(2) : "");
    }
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const trySave = (): boolean => {
    const numValue = parseFloat(editValue);
    if (!isNaN(numValue) && numValue > 0) {
      onSave(numValue);
      return true;
    }
    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      trySave();
      setIsEditing(false);
    } else if (e.key === "Escape") {
      setEditValue(value != null && Number.isFinite(value) ? value.toFixed(2) : "");
      setIsEditing(false);
    }
  };

  const handleBlur = () => {
    const numValue = parseFloat(editValue);
    if (!isNaN(numValue) && numValue > 0) {
      onSave(numValue);
    }
    setIsEditing(false);
  };

  const displayPrice =
    value != null && Number.isFinite(value) && value > 0 ? `$${value.toFixed(2)}` : "Set";

  return (
    <div
      className={`inline-flex items-center justify-end gap-0.5 ${className}`}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
    >
      {isEditing ? (
        <>
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="h-7 w-[5.5rem] rounded border bg-background px-1 text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid={`${testId}-input`}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              trySave();
              setIsEditing(false);
            }}
            className="p-0.5 text-green-500 hover:text-green-600"
            data-testid={`${testId}-save`}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditValue(value != null && Number.isFinite(value) ? value.toFixed(2) : "");
              setIsEditing(false);
            }}
            className="p-0.5 text-red-500 hover:text-red-600"
            data-testid={`${testId}-cancel`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="font-mono text-sm text-muted-foreground hover:text-foreground hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setEditValue(value != null && Number.isFinite(value) ? value.toFixed(2) : "");
            setIsEditing(true);
          }}
          data-testid={`${testId}-value`}
        >
          {displayPrice}
        </button>
      )}
    </div>
  );
}
