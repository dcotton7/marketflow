import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  defaultYtdAnchorDate,
  effectiveCashStartDate,
  type CashLedgerAnchor,
  type CashLedgerEvent,
} from "@shared/trade-journal-cash-ledger";
import type { JournalBrokerFilter } from "@shared/trade-journal-invested";

interface JournalCashSetup {
  anchors: Partial<Record<"FIDELITY" | "SCHWAB", CashLedgerAnchor>>;
  events: CashLedgerEvent[];
}

function formatMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parseCashInput(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function JournalCashSetupCard({
  brokerFilter,
  cashLedger,
  manualCashBrokers,
}: {
  brokerFilter: JournalBrokerFilter;
  cashLedger?: JournalCashSetup;
  manualCashBrokers?: Array<"FIDELITY" | "SCHWAB">;
}) {
  const broker = brokerFilter === "FIDELITY" || brokerFilter === "SCHWAB" ? brokerFilter : null;
  const anchor = broker ? cashLedger?.anchors[broker] : undefined;
  const brokerEvents = useMemo(
    () =>
      broker
        ? (cashLedger?.events ?? []).filter((e) => e.brokerId === broker)
        : [],
    [broker, cashLedger?.events]
  );

  const [anchorDate, setAnchorDate] = useState(defaultYtdAnchorDate());
  const [cashInput, setCashInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (anchor) {
      setAnchorDate(anchor.anchorDate);
      setCashInput(String(anchor.anchorCash));
    }
  }, [anchor?.anchorDate, anchor?.anchorCash]);

  const saveAnchorMutation = useMutation({
    mutationFn: async () => {
      if (!broker) throw new Error("Select a broker");
      const cash = parseCashInput(cashInput);
      if (cash == null) throw new Error("Enter a valid cash balance");
      const res = await apiRequest("PUT", "/api/sentinel/trade-journal/cash-setup/anchor", {
        brokerId: broker,
        anchorDate,
        anchorCash: cash,
      });
      return res.json() as Promise<CashLedgerAnchor>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[0] === "/api/sentinel/trade-journal",
      });
      setConfirmOpen(false);
      setConfirmText("");
    },
  });

  if (!broker) return null;

  const showCard =
    broker === "SCHWAB" ||
    manualCashBrokers?.includes(broker) ||
    anchor != null ||
    brokerEvents.length > 0;

  if (!showCard) return null;

  const effectiveDate = effectiveCashStartDate(anchorDate);
  const parsedCash = parseCashInput(cashInput);
  const confirmReady = confirmText.trim().toUpperCase() === "CASH";

  return (
    <Card data-testid="journal-cash-setup">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Cash Balance</CardTitle>
        <CardDescription>
          {broker === "SCHWAB"
            ? "Schwab exports have no cash — set opening balance here."
            : "Override or supplement imported Activity cash."}{" "}
          Tagged date applies from the next trading day.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="cash-anchor-date" className="text-xs">
              Tagged date
            </Label>
            <Input
              id="cash-anchor-date"
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              className="h-9"
              data-testid="cash-anchor-date"
            />
            <p className="text-[10px] text-muted-foreground">
              Effective {format(new Date(`${effectiveDate}T12:00:00Z`), "MMM d, yyyy")} (start of day)
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cash-anchor-amount" className="text-xs">
              Opening cash balance
            </Label>
            <Input
              id="cash-anchor-amount"
              type="text"
              inputMode="decimal"
              placeholder="50000.00"
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              className="h-9 tabular-nums"
              data-testid="cash-anchor-amount"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={parsedCash == null || saveAnchorMutation.isPending}
            onClick={() => setConfirmOpen(true)}
            data-testid="cash-anchor-save"
          >
            Save cash balance
          </Button>
        </div>

        {anchor?.discrepancyAmount != null && Math.abs(anchor.discrepancyAmount) > 0.01 ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
            <div>
              <p className="font-medium text-amber-600 dark:text-amber-400">Latest discrepancy flagged</p>
              <p className="text-muted-foreground mt-0.5">{anchor.discrepancyNote}</p>
            </div>
          </div>
        ) : null}

        {brokerEvents.length > 0 ? (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Cash ledger history</p>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs min-w-[280px]">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-1.5 pr-2 font-medium">Date</th>
                    <th className="pb-1.5 pr-2 font-medium">Type</th>
                    <th className="pb-1.5 pr-2 font-medium text-right">Amount</th>
                    <th className="pb-1.5 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {brokerEvents.map((event) => (
                    <tr
                      key={event.id}
                      className={cn(
                        "border-b last:border-0",
                        event.eventKind === "reconciliation" && "bg-amber-500/5"
                      )}
                    >
                      <td className="py-1.5 pr-2 whitespace-nowrap tabular-nums">
                        {format(new Date(`${event.eventDate}T12:00:00Z`), "MMM d, yyyy")}
                      </td>
                      <td className="py-1.5 pr-2">
                        {event.eventKind === "reconciliation" ? (
                          <span className="text-amber-600 dark:text-amber-400">Reconcile</span>
                        ) : (
                          "Adjustment"
                        )}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right tabular-nums font-medium",
                          event.amount >= 0 ? "text-rs-green" : "text-rs-red"
                        )}
                      >
                        {formatMoney(event.amount)}
                      </td>
                      <td className="py-1.5 text-muted-foreground">{event.label ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm cash balance</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  You are setting <strong className="text-foreground">{broker}</strong> opening cash to{" "}
                  <strong className="text-foreground">
                    {parsedCash != null ? formatMoney(parsedCash) : "—"}
                  </strong>{" "}
                  effective{" "}
                  <strong className="text-foreground">
                    {format(new Date(`${effectiveDate}T12:00:00Z`), "MMM d, yyyy")}
                  </strong>{" "}
                  (tagged {format(new Date(`${anchorDate}T12:00:00Z`), "MMM d, yyyy")}).
                </p>
                <p>
                  This updates the cash baseline used for Return % and % Invested. It does not change
                  realized trade P&amp;L on the calendar.
                </p>
                <p className="text-amber-600 dark:text-amber-400">
                  If this differs from tracked cash, a reconciliation row will be saved.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="cash-confirm" className="text-xs text-foreground">
                    Type <span className="font-mono font-semibold">CASH</span> to confirm
                  </Label>
                  <Input
                    id="cash-confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="CASH"
                    className="font-mono"
                    data-testid="cash-confirm-input"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveAnchorMutation.isPending}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              disabled={!confirmReady || saveAnchorMutation.isPending}
              onClick={() => saveAnchorMutation.mutate()}
              data-testid="cash-confirm-submit"
            >
              {saveAnchorMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Saving…
                </>
              ) : (
                "Confirm"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
