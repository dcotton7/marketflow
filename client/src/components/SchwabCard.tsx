/**
 * Schwab read-only link: Connect / Sign in again, the link's state, the 7-day sign-in expiry, the stream and the
 * last quote's age, Sync now and Disconnect (docs/schwab-readonly.md). Hidden when the server has the link off.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SchwabStatus {
  enabled: boolean;
  configured: boolean;
  state: "off" | "not_configured" | "disconnected" | "connected" | "expiring" | "expired";
  message: string;
  refreshExpiresAt: string | null;
  refreshHoursLeft: number | null;
  stream: { state: string; symbols: number; lastMessageAt: string | null; reconnects: number };
  lastQuoteAgeSec: number | null;
  realtime: boolean | null;
  lastSyncAt: string | null;
  lastSync: { inserted: number; updated: number; removed: number; skipped: string[] } | null;
}

const KEY = ["/api/schwab/status"];

export function SchwabCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SchwabStatus>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await fetch("/api/schwab/status", { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    refetchInterval: 30_000,
    retry: false,
  });
  const sync = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/schwab/sync")).json(),
    onSuccess: (r: any) => {
      toast({ title: "Schwab positions synced", description: `${r.inserted} added, ${r.updated} updated, ${r.removed} closed` });
      queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });
  const disconnect = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/schwab/disconnect")).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  if (isLoading || !data || !data.enabled) return null;
  const live = data.state === "connected" || data.state === "expiring";
  const connect = () => { window.location.href = "/api/schwab/connect"; };
  const badge = data.state === "connected" ? "default" : data.state === "expiring" ? "secondary" : "destructive";

  return (
    <Card data-testid="card-schwab">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          Schwab (read only)
        </CardTitle>
        <CardDescription>Positions, balances and real-time quotes for alerts. MarketFlow never places or changes orders.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant={badge as any}>{data.state.replace("_", " ")}</Badge>
          <span className="text-sm">{data.message}</span>
        </div>
        {live && (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Sign-in expires {data.refreshExpiresAt ? new Date(data.refreshExpiresAt).toLocaleString() : "?"}
              {data.refreshHoursLeft !== null ? ` (${data.refreshHoursLeft} h left)` : ""}</p>
            <p>Stream: {data.stream.state}, {data.stream.symbols} symbols
              {data.lastQuoteAgeSec !== null ? `, last quote ${data.lastQuoteAgeSec}s ago` : ""}
              {data.realtime === false ? " (delayed quotes)" : data.realtime ? " (real time)" : ""}</p>
            {data.lastSyncAt && <p>Positions synced {new Date(data.lastSyncAt).toLocaleString()} into "Schwab positions"
              {data.lastSync?.skipped.length ? `; already in your lists: ${data.lastSync.skipped.map((k) => k.split(":")[0]).join(", ")}` : ""}</p>}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {data.state === "not_configured" ? null : !live ? (
            <Button onClick={connect} data-testid="button-schwab-connect">
              {data.state === "expired" ? "Sign in again" : "Connect Schwab"}
            </Button>
          ) : (
            <>
              {data.state === "expiring" && <Button onClick={connect}>Sign in again</Button>}
              <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Sync now
              </Button>
              <Button variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                <Unplug className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
