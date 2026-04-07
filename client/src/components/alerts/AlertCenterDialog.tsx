import { Bell, Play, Pause, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAlerts, useAlertEvents, useEvaluateAlert, useToggleAlert } from "@/hooks/use-alerts";

interface AlertCenterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlertCenterDialog({ open, onOpenChange }: AlertCenterDialogProps) {
  const { data: alerts, isLoading: alertsLoading } = useAlerts();
  const { data: events, isLoading: eventsLoading } = useAlertEvents();
  const toggleAlert = useToggleAlert();
  const evaluateAlert = useEvaluateAlert();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Alert Center
          </DialogTitle>
          <DialogDescription>
            Centralized alert subsystem state across charts, Market Flow, and watchlists.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="alerts" className="space-y-4">
          <TabsList>
            <TabsTrigger value="alerts">Active Alerts</TabsTrigger>
            <TabsTrigger value="events">Recent Hits</TabsTrigger>
          </TabsList>

          <TabsContent value="alerts" className="space-y-3">
            {alertsLoading ? (
              <div className="text-sm text-muted-foreground">Loading alerts…</div>
            ) : !alerts?.length ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                No alerts yet. Create one from a chart, theme, or watchlist.
              </div>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium">{alert.name}</div>
                        <Badge variant={alert.enabled ? "default" : "secondary"}>
                          {alert.enabled ? "Active" : "Paused"}
                        </Badge>
                        <Badge variant="outline">{alert.sourceClient.replaceAll("_", " ")}</Badge>
                      </div>
                      {alert.description && (
                        <div className="text-sm text-muted-foreground">{alert.description}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Last triggered: {alert.lastTriggeredAt ? new Date(alert.lastTriggeredAt).toLocaleString() : "never"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => evaluateAlert.mutate({ id: alert.id, persist: true })}
                        disabled={evaluateAlert.isPending}
                      >
                        <Zap className="w-4 h-4" />
                        Run now
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => toggleAlert.mutate(alert.id)}
                        disabled={toggleAlert.isPending}
                      >
                        {alert.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        {alert.enabled ? "Pause" : "Resume"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-3">
            {eventsLoading ? (
              <div className="text-sm text-muted-foreground">Loading event history…</div>
            ) : !events?.length ? (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                No alert hits recorded yet.
              </div>
            ) : (
              events.map((event, index) => (
                <div key={event.id}>
                  {index > 0 && <Separator className="mb-3" />}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium">{event.summary ?? `Alert #${event.alertId}`}</div>
                      <Badge variant="outline">{event.deliveryMode}</Badge>
                      <Badge variant="secondary">{event.matchedCount} match{event.matchedCount === 1 ? "" : "es"}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {event.sourceGroupLabel ? `${event.sourceGroupLabel} · ` : ""}
                      {event.matchedSymbols.join(", ")}
                    </div>
                    {event.triggerReason && (
                      <div className="text-xs text-muted-foreground">{event.triggerReason}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {event.createdAt ? new Date(event.createdAt).toLocaleString() : "Unknown time"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
