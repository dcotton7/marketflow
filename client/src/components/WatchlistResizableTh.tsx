import type { PointerEvent, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function WatchlistResizableTh({
  widthPx,
  columnIndex,
  onResizeStart,
  showResizeHandle,
  className,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & {
  widthPx: number;
  columnIndex: number;
  onResizeStart: (columnIndex: number, e: PointerEvent<HTMLButtonElement>) => void;
  showResizeHandle?: boolean;
}) {
  return (
    <th
      className={cn("relative align-middle", className)}
      style={{
        width: widthPx,
        minWidth: widthPx,
        maxWidth: widthPx,
        boxSizing: "border-box",
      }}
      {...props}
    >
      <div className="flex min-w-0 items-center overflow-hidden">{children}</div>
      {showResizeHandle ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Resize column"
          data-watchlist-col-resize=""
          className="absolute right-0 top-0 z-[3] h-full w-3 min-w-[12px] cursor-col-resize border-0 bg-transparent p-0 hover:bg-primary/25"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* disconnected node / unsupported */
            }
            onResizeStart(columnIndex, e);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
    </th>
  );
}
