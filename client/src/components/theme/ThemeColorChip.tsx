import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { useThemeEditorOptional } from "@/context/ThemeEditorContext";
import { getLocalThemeSlot } from "@shared/theme-registry";
import { cn } from "@/lib/utils";

interface ThemeColorChipProps {
  /** `${surfaceId}:${regionId}` — see shared/theme-registry.ts */
  slotId: string;
  className?: string;
  color?: string;
}

/**
 * Color chip — square matching control BG with white "c".
 * Opens theme overlay (Local tab). All signed-in users can set personal colors;
 * admins can also save global local defaults from the overlay.
 */
export function ThemeColorChip({ slotId, className, color }: ThemeColorChipProps) {
  const { user } = useSentinelAuth();
  const editor = useThemeEditorOptional();

  if (!user || !editor) return null;

  const slot = getLocalThemeSlot(slotId);
  const swatch = color ?? editor.getSlotColor(slotId);
  const tooltip = slot
    ? slot.kind === "header"
      ? `Edit ${slot.label} (header)`
      : `Edit ${slot.label} (background)`
    : "Edit colors for this control";

  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip}
      data-theme-slot={slotId}
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-white/25",
        "text-[10px] font-bold leading-none text-white shadow-sm transition-opacity hover:opacity-90",
        className
      )}
      style={{ backgroundColor: swatch }}
      onClick={(e) => {
        e.stopPropagation();
        editor.openThemeEditor({ slotId, tab: "local" });
      }}
    >
      c
    </button>
  );
}
