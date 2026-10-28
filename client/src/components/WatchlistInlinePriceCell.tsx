import { useState, useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

export interface WatchlistInlinePriceCellProps {
  value: number | null | undefined;
  onSave: (value: number | null) => void;
  /** When true, empty input on blur / save clears the value (sends `null`). */
  allowClear?: boolean;
  className?: string;
  /** "count" (shares): no $ and no fixed decimals. */
  format?: "price" | "count";
  "data-testid"?: string;
}

export function WatchlistInlinePriceCell({
  value,
  onSave,
  allowClear = false,
  className = "",
  format = "price",
  "data-testid": testId = "watchlist-inline-price",
}: WatchlistInlinePriceCellProps) {
  const editText = (v: number | null | undefined) =>
    v != null && Number.isFinite(v) ? (format === "count" ? String(v) : v.toFixed(2)) : "";
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(() =>
    editText(value)
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(editText(value));
    }
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const trySave = (): boolean => {
    const trimmed = editValue.trim();
    if (trimmed === "" && allowClear) {
      onSave(null);
      return true;
    }
    const numValue = parseFloat(trimmed);
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
      setEditValue(editText(value));
      setIsEditing(false);
    }
  };

  const handleBlur = () => {
    const trimmed = editValue.trim();
    if (trimmed === "" && allowClear) {
      onSave(null);
    } else {
      const numValue = parseFloat(trimmed);
      if (!isNaN(numValue) && numValue > 0) {
        onSave(numValue);
      }
    }
    setIsEditing(false);
  };

  const displayPrice =
    value != null && Number.isFinite(value) && value > 0
      ? format === "count" ? value.toLocaleString("en-US", { maximumFractionDigits: 4 }) : `$${value.toFixed(2)}`
      : "Set";

  return (
    <div
      className={`inline-flex max-w-full min-w-0 items-center justify-end gap-0.5 ${className}`}
      data-testid={testId}
      onClick={(e) => e.stopPropagation()}
    >
      {isEditing ? (
        <>
          <input
            ref={inputRef}
            type="number"
            step={format === "count" ? "any" : "0.01"}
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
              setEditValue(editText(value));
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
          className="max-w-full min-w-0 truncate text-right font-mono text-sm text-muted-foreground hover:text-foreground hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setEditValue(editText(value));
            setIsEditing(true);
          }}
          data-testid={`${testId}-value`}
          title={displayPrice}
        >
          {displayPrice}
        </button>
      )}
    </div>
  );
}
