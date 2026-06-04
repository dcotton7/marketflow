/**
 * Standalone Live Theme Charts window — draggable outside the main browser tab.
 * URL: /sentinel/live-theme-charts?popout=true&instanceId=…&startId=… (optional)
 */
import { useEffect } from "react";
import { useSearch } from "wouter";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { StartHereProvider } from "@/components/start-here/StartHereContext";
import { LiveThemeChartsWidget } from "@/components/start-here/LiveThemeChartsWidget";

function LiveThemeChartsPopoutShell({ instanceId }: { instanceId: string }) {
  const { cssVariables } = useSystemSettings();

  return (
    <div
      className="flex h-dvh min-h-0 flex-col p-2"
      style={{ backgroundColor: cssVariables.backgroundColor }}
      data-testid="live-theme-charts-popout-page"
    >
      <LiveThemeChartsWidget
        mode="window"
        cssVariables={cssVariables}
        instanceId={instanceId}
        groupId=""
        accentColor={undefined}
        onClose={() => window.close()}
      />
    </div>
  );
}

export default function LiveThemeChartsPopoutPage() {
  const { user } = useSentinelAuth();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const instanceId = urlParams.get("instanceId")?.trim() ?? "";

  useEffect(() => {
    document.title = "Live Theme Charts";
  }, []);

  if (!user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-sm text-muted-foreground">
        Sign in to view Live Theme Charts.
      </div>
    );
  }

  if (!instanceId) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-sm text-muted-foreground">
        Missing widget id — close this window and use Pop out from Start Here again.
      </div>
    );
  }

  return (
    <StartHereProvider userId={user.id}>
      <LiveThemeChartsPopoutShell instanceId={instanceId} />
    </StartHereProvider>
  );
}
