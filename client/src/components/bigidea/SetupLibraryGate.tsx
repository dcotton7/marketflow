import type { ReactNode } from "react";
import { useSetupLibraryEnabled } from "@/lib/setup-library";

/** Shows the Setup Library only when the server has it switched on; otherwise a plain "turned off" note. */
export function SetupLibraryGate({ children }: { children: ReactNode }) {
  const enabled = useSetupLibraryEnabled();
  if (!enabled) {
    return (
      <div className="p-8 text-sm text-muted-foreground" data-testid="setup-library-disabled">
        The Setup Library is turned off.
      </div>
    );
  }
  return <>{children}</>;
}
