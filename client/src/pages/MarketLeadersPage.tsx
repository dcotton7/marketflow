import { SentinelHeader } from "@/components/SentinelHeader";
import { MarketLeadersBoard } from "@/components/market-leaders/MarketLeadersBoard";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { useSystemSettings } from "@/context/SystemSettingsContext";

export default function MarketLeadersPage() {
  const { isLoading } = useSentinelAuth();
  const { pageShellStyle } = useSystemSettings();

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex h-screen flex-col" style={pageShellStyle}>
      <SentinelHeader />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MarketLeadersBoard mode="page" />
      </div>
    </div>
  );
}
