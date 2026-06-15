import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { JournalCashSetupCard } from "@/components/JournalCashSetupCard";
import { SentinelHeader } from "@/components/SentinelHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  computeAccountReturnPct,
  impliedPeriodStartEquity,
  JOURNAL_BROKER_FILTER_OPTIONS,
  resolveBrokerJournalView,
  totalEquity,
  type JournalBrokerFilter,
} from "@shared/trade-journal-invested";
import { computeCapitalFlowReturn } from "@shared/trade-journal-cash-ledger";

interface TradeJournalDayRevenue {
  total: number;
  tradeCount: number;
}

interface TradeJournalClosedTradeRow {
  id: number;
  ticker: string;
  broker?: "FIDELITY" | "SCHWAB" | null;
  accountName?: string | null;
  positionSize: number;
  positionDollars: number;
  sharesSold: number;
  sharesRemaining: number;
  profitDollars: number | null;
  profitPercent: number | null;
  datePurchased: string | null;
  holdMarketDays: number | null;
  marketConditionOnExit: string | null;
}

interface InvestedPctSnapshot {
  asOfDate: string | null;
  pct: number | null;
  changeFromPriorDay: number | null;
  changeFromWeekStart: number | null;
  changeFromMonthStart: number | null;
}

interface TradeJournalData {
  dailyRevenue: Record<string, TradeJournalDayRevenue>;
  dailyRevenueByBroker?: Record<JournalBrokerFilter, Record<string, TradeJournalDayRevenue>>;
  closedTradesByDayByBroker?: Record<
    JournalBrokerFilter,
    Record<string, TradeJournalClosedTradeRow[]>
  >;
  dailyCash: Record<string, number>;
  dailyCashByBroker?: Record<JournalBrokerFilter, Record<string, number>>;
  dailyInvestedPct?: Record<JournalBrokerFilter, Record<string, number>>;
  investedPctSnapshot?: Record<JournalBrokerFilter, InvestedPctSnapshot>;
  dailyPositionValueByBroker?: Record<JournalBrokerFilter, Record<string, number>>;
  closedTradesByDay: Record<string, TradeJournalClosedTradeRow[]>;
  latestCash: number | null;
  latestCashDate: string | null;
  positionsValue: number;
  positionsValueByBroker?: Record<JournalBrokerFilter, number>;
  positionsCostBasis: number;
  positionsCostBasisByBroker?: Record<JournalBrokerFilter, number>;
  unrealizedPnL: number;
  unrealizedPnLByBroker?: Record<JournalBrokerFilter, number>;
  activePositionCount: number;
  activePositionCountByBroker?: Record<JournalBrokerFilter, number>;
  brokerAccountsByBroker?: Record<"FIDELITY" | "SCHWAB", string[]>;
  skippedNoExit: number;
  skippedNoPnl: number;
  cashLedger?: {
    anchors: Partial<
      Record<
        "FIDELITY" | "SCHWAB",
        {
          brokerId: "FIDELITY" | "SCHWAB";
          anchorDate: string;
          anchorCash: number;
          effectiveDate?: string;
          trackedCash?: number | null;
          discrepancyAmount?: number | null;
          discrepancyNote?: string | null;
        }
      >
    >;
    events: Array<{
      id?: number;
      brokerId: "FIDELITY" | "SCHWAB";
      eventDate: string;
      amount: number;
      label?: string | null;
      eventKind?: "adjustment" | "reconciliation";
    }>;
  };
  manualCashBrokers?: Array<"FIDELITY" | "SCHWAB">;
}

/** Grid cell keys match broker YYYY-MM-DD trade dates (no timezone shift). */
function calendarCellKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatCurrency(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatCompactCurrency(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

function pnlColorClass(amount: number): string {
  return amount >= 0 ? "text-rs-green" : "text-rs-red";
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatPctDelta(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatReturnPct(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatProfitPct(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function lastCashDateInMonth(dailyCash: Record<string, number>, viewMonth: Date): string | null {
  const monthPrefix = format(viewMonth, "yyyy-MM");
  const dates = Object.keys(dailyCash)
    .filter((d) => d.startsWith(monthPrefix))
    .sort();
  return dates.length > 0 ? dates[dates.length - 1]! : null;
}

function JournalBalanceSummary({
  returnPct,
  ytdGain,
  realized,
  unrealized,
  cash,
  positions,
  cashLabel,
  openNote,
}: {
  returnPct?: number | null;
  ytdGain?: number | null;
  realized: number | null;
  unrealized: number;
  cash: number | null;
  positions: number;
  cashLabel?: string;
  openNote?: string;
}) {
  const hasCash = cash != null;
  const total = (hasCash ? cash : 0) + positions;

  return (
    <div className="space-y-3">
      {returnPct !== undefined && (
        <div>
          <p className="text-xs text-muted-foreground">Return (account)</p>
          <p
            className={cn(
              "text-2xl font-bold tabular-nums",
              returnPct != null ? pnlColorClass(returnPct) : "text-muted-foreground"
            )}
            data-testid="journal-return-pct"
          >
            {formatReturnPct(returnPct)}
          </p>
          {returnPct == null && !hasCash ? (
            <p className="text-[10px] text-muted-foreground mt-1">
              Set a cash anchor for this broker in Cash Setup — return needs cash + positions.
            </p>
          ) : null}
        </div>
      )}

      {ytdGain != null && (
        <div>
          <p className="text-xs text-muted-foreground">YTD Gain</p>
          <p className={cn("text-xl font-bold tabular-nums", pnlColorClass(ytdGain))}>
            {formatCurrency(ytdGain)}
          </p>
        </div>
      )}

      {realized != null && (
        <div>
          <p className="text-xs text-muted-foreground">Realized (closed)</p>
          <p className={cn("text-lg font-semibold tabular-nums", pnlColorClass(realized))}>
            {formatCurrency(realized)}
          </p>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground">Unrealized (open)</p>
        <p className={cn("text-lg font-semibold tabular-nums", pnlColorClass(unrealized))}>
          {formatCurrency(unrealized)}
        </p>
        {openNote ? (
          <p className="text-[10px] text-muted-foreground mt-0.5">{openNote}</p>
        ) : null}
      </div>

      <div>
        <p className="text-xs text-muted-foreground">{cashLabel ?? "Cash"}</p>
        <p className="text-lg font-semibold tabular-nums">
          {hasCash ? formatCurrency(cash) : "—"}
        </p>
      </div>

      <div>
        <p className="text-xs text-muted-foreground">Positions (market value)</p>
        <p className="text-lg font-semibold tabular-nums">{formatCurrency(positions)}</p>
      </div>

      <div className="border-t pt-3">
        <p className="text-xs text-muted-foreground">Cash + Positions</p>
        <p className="text-xl font-bold tabular-nums" data-testid="journal-cash-plus-positions">
          {hasCash ? formatCurrency(total) : "—"}
        </p>
      </div>
    </div>
  );
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function PercentageInvestedCard({
  brokerFilter,
  onBrokerFilterChange,
  snapshot,
  brokerAccountNote,
}: {
  brokerFilter: JournalBrokerFilter;
  onBrokerFilterChange: (value: JournalBrokerFilter) => void;
  snapshot: InvestedPctSnapshot | undefined;
  brokerAccountNote?: string | null;
}) {
  const pct = snapshot?.pct ?? null;

  return (
    <Card data-testid="journal-percent-invested">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Percentage Invested</CardTitle>
            <CardDescription>
              {snapshot?.asOfDate
                ? `As of ${format(new Date(snapshot.asOfDate + "T12:00:00Z"), "MMM d, yyyy")}`
                : "From imported trade history + cash"}
              {brokerAccountNote ? (
                <span className="block mt-0.5 text-[10px]">{brokerAccountNote}</span>
              ) : null}
            </CardDescription>
          </div>
          <Select value={brokerFilter} onValueChange={(v) => onBrokerFilterChange(v as JournalBrokerFilter)}>
            <SelectTrigger className="h-8 w-[110px] text-xs" data-testid="journal-broker-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOURNAL_BROKER_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-2xl font-bold tabular-nums">
            {pct != null ? `${formatPct(pct)} invested` : "—"}
          </p>
          {pct == null ? (
            <p className="text-[10px] text-muted-foreground mt-1">
              {brokerFilter === "SCHWAB"
                ? "Set a cash balance below — Schwab exports do not include cash."
                : brokerFilter === "FIDELITY"
                  ? "Recent Activity rows often show Cash Balance as Processing — set a Jan 1 cash anchor below, or re-export Activity after trades settle."
                  : "Set cash anchors per broker below, or re-import Activity with settled Cash Balance values."}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-2 text-sm border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">vs prior day</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                snapshot?.changeFromPriorDay != null
                  ? pnlColorClass(snapshot.changeFromPriorDay)
                  : "text-muted-foreground"
              )}
            >
              {formatPctDelta(snapshot?.changeFromPriorDay ?? null)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">vs week start</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                snapshot?.changeFromWeekStart != null
                  ? pnlColorClass(snapshot.changeFromWeekStart)
                  : "text-muted-foreground"
              )}
            >
              {formatPctDelta(snapshot?.changeFromWeekStart ?? null)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">vs month start</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                snapshot?.changeFromMonthStart != null
                  ? pnlColorClass(snapshot.changeFromMonthStart)
                  : "text-muted-foreground"
              )}
            >
              {formatPctDelta(snapshot?.changeFromMonthStart ?? null)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SentinelTradeJournalPage() {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);
  const [brokerFilter, setBrokerFilter] = useState<JournalBrokerFilter>("ALL");

  const { data, isLoading, error, refetch, isFetching } = useQuery<TradeJournalData>({
    queryKey: ["/api/sentinel/trade-journal"],
    staleTime: 60_000,
  });

  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;

  const brokerView = useMemo(
    () => resolveBrokerJournalView(data, brokerFilter),
    [data, brokerFilter]
  );

  const {
    dailyRevenue,
    dailyCash,
    closedTradesByDay,
    positionsValue,
    positionsCostBasis,
    unrealizedPnL,
    activePositionCount,
    investedSnapshot,
    capitalFlows,
  } = brokerView;

  const openNote = `${activePositionCount} open position${activePositionCount === 1 ? "" : "s"} · live quotes`;

  const brokerAccountNote = useMemo(() => {
    if (brokerFilter === "ALL") return null;
    const accounts = data?.brokerAccountsByBroker?.[brokerFilter];
    if (!accounts?.length) return null;
    if (accounts.length === 1) return `Account: ${accounts[0]}`;
    return `Combined: ${accounts.join(" + ")}`;
  }, [brokerFilter, data?.brokerAccountsByBroker]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    return eachDayOfInterval({
      start: startOfWeek(monthStart),
      end: endOfWeek(monthEnd),
    });
  }, [viewMonth]);

  const monthSummary = useMemo(() => {
    let realized = 0;
    let tradingDays = 0;
    let tradeCount = 0;
    const monthPrefix = format(viewMonth, "yyyy-MM");

    for (const [dayKey, dayData] of Object.entries(dailyRevenue)) {
      if (!dayKey.startsWith(monthPrefix)) continue;
      realized += dayData.total;
      tradingDays += 1;
      tradeCount += dayData.tradeCount;
    }

    const eomCashDate = lastCashDateInMonth(dailyCash, viewMonth);
    const cash = eomCashDate ? dailyCash[eomCashDate] ?? null : null;

    return { realized, tradingDays, tradeCount, cash, eomCashDate };
  }, [dailyRevenue, dailyCash, viewMonth]);

  const selectedKey = selectedDay ? calendarCellKey(selectedDay) : null;
  const selectedRevenue = selectedKey ? dailyRevenue[selectedKey] : undefined;
  const selectedCash = selectedKey ? dailyCash[selectedKey] ?? null : null;
  const selectedTrades = selectedKey ? closedTradesByDay[selectedKey] ?? [] : [];

  const ytdYear = format(new Date(), "yyyy");

  const ytdSummary = useMemo(() => {
    let realized = 0;
    let tradingDays = 0;
    let tradeCount = 0;
    const yearPrefix = `${ytdYear}-`;

    for (const [dayKey, dayData] of Object.entries(dailyRevenue)) {
      if (!dayKey.startsWith(yearPrefix)) continue;
      realized += dayData.total;
      tradingDays += 1;
      tradeCount += dayData.tradeCount;
    }

    return { realized, tradingDays, tradeCount };
  }, [dailyRevenue, ytdYear]);

  const filteredLatestCash = useMemo(() => {
    const dates = Object.keys(dailyCash).sort();
    if (dates.length === 0) return { cash: null as number | null, date: null as string | null };
    const date = dates[dates.length - 1]!;
    return { cash: dailyCash[date] ?? null, date };
  }, [dailyCash]);

  const todayKey = calendarCellKey(new Date());
  const todayRevenue = dailyRevenue[todayKey];
  const todayCash = dailyCash[todayKey] ?? null;

  const currentTotalEquity = useMemo(
    () => totalEquity(filteredLatestCash.cash, positionsValue),
    [filteredLatestCash.cash, positionsValue]
  );

  const hasCapitalFlows = capitalFlows.length > 0;

  const ytdReturnPct = useMemo(() => {
    if (currentTotalEquity == null) return null;
    if (hasCapitalFlows && brokerFilter !== "ALL") {
      return computeCapitalFlowReturn(currentTotalEquity, capitalFlows);
    }
    if (hasCapitalFlows && brokerFilter === "ALL") {
      const hasFidelityFlows = capitalFlows.some((f) => f.brokerId === "FIDELITY");
      const hasSchwabFlows = capitalFlows.some((f) => f.brokerId === "SCHWAB");
      if (hasFidelityFlows && hasSchwabFlows) {
        return computeCapitalFlowReturn(currentTotalEquity, capitalFlows);
      }
    }
    const startEquity = impliedPeriodStartEquity(
      currentTotalEquity,
      ytdSummary.realized,
      unrealizedPnL
    );
    return computeAccountReturnPct(currentTotalEquity, startEquity);
  }, [currentTotalEquity, ytdSummary.realized, unrealizedPnL, capitalFlows, hasCapitalFlows, brokerFilter]);

  const ytdGain = useMemo(() => {
    if (!hasCapitalFlows || currentTotalEquity == null) return null;
    const totalCapital = capitalFlows.reduce((sum, f) => {
      if (f.kind === "starting_equity" || f.kind === "capital_injection") return sum + f.amount;
      if (f.kind === "withdrawal") return sum - f.amount;
      return sum;
    }, 0);
    if (totalCapital <= 0) return null;
    return currentTotalEquity - totalCapital;
  }, [hasCapitalFlows, capitalFlows, currentTotalEquity]);

  const monthReturnPct = useMemo(() => {
    const monthCash = monthSummary.cash ?? filteredLatestCash.cash;
    const endEquity = totalEquity(monthCash, positionsValue);
    if (endEquity == null) return null;
    const startEquity = impliedPeriodStartEquity(
      endEquity,
      monthSummary.realized,
      unrealizedPnL
    );
    return computeAccountReturnPct(endEquity, startEquity);
  }, [monthSummary, filteredLatestCash.cash, positionsValue, unrealizedPnL]);

  const todayReturnPct = useMemo(() => {
    // If no cash data exists for today or the most recent trading day close
    // to today, the daily return is unreliable — show nothing.
    const cashDates = Object.keys(dailyCash).sort();
    const latestCashDate = cashDates.length > 0 ? cashDates[cashDates.length - 1]! : null;
    if (!latestCashDate) return null;
    const daysSinceCash = Math.floor(
      (new Date(todayKey).getTime() - new Date(latestCashDate).getTime()) / 86400000
    );
    if (daysSinceCash > 4) return null;

    const endEquity = totalEquity(todayCash ?? filteredLatestCash.cash, positionsValue);
    if (endEquity == null) return null;

    // For single-day returns, only attribute today's realized trades.
    // Total cumulative unrealized can't be decomposed into a daily change
    // without prior-day position values, so omit it (pass 0).
    const todayRealized = todayRevenue?.total ?? 0;
    const startEquity = endEquity - todayRealized;
    if (startEquity <= 0) return null;
    return computeAccountReturnPct(endEquity, startEquity);
  }, [
    todayKey,
    todayCash,
    filteredLatestCash.cash,
    positionsValue,
    dailyCash,
    todayRevenue,
  ]);

  const selectedReturnPct = useMemo(() => {
    if (!selectedKey) return null;
    const selectedEndEquity = totalEquity(selectedCash ?? filteredLatestCash.cash, positionsValue);
    if (selectedEndEquity == null) return null;
    const dayRealized = selectedRevenue?.total ?? 0;
    const selectedStart = selectedEndEquity - dayRealized;
    if (selectedStart <= 0) return null;
    return computeAccountReturnPct(selectedEndEquity, selectedStart);
  }, [
    selectedKey,
    selectedCash,
    filteredLatestCash.cash,
    positionsValue,
    selectedRevenue,
  ]);

  const showSelectedDayCard =
    selectedDay != null && !isSameDay(selectedDay, new Date());

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SentinelHeader showSentiment={false} />

      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-muted-foreground" />
            Trade Journal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Realized P&amp;L by close date, unrealized on open positions, cash from Activity imports, and account equity.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading journal…
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-destructive font-medium">Failed to load trade journal.</p>
              {errorMessage ? (
                <p className="text-xs text-muted-foreground break-all max-w-lg mx-auto">{errorMessage}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                If you just pulled code changes, restart the dev server ({`npm run dev`}) so the new API route loads.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? "Retrying…" : "Try again"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>{format(viewMonth, "MMMM yyyy")}</CardTitle>
                    <CardDescription>Click a day — close dates use broker trade dates (Mon–Fri)</CardDescription>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMonth((m) => subMonths(m, 1))}
                      data-testid="journal-prev-month"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        setViewMonth(startOfMonth(new Date()));
                        setSelectedDay(new Date());
                      }}
                      data-testid="journal-today"
                    >
                      Today
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMonth((m) => addMonths(m, 1))}
                      data-testid="journal-next-month"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {WEEKDAY_LABELS.map((label) => (
                    <div
                      key={label}
                      className="text-center text-xs font-medium text-muted-foreground py-1"
                    >
                      {label}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1" data-testid="journal-calendar-grid">
                  {calendarDays.map((day) => {
                    const dayKey = calendarCellKey(day);
                    const dayData = dailyRevenue[dayKey];
                    const inMonth = isSameMonth(day, viewMonth);
                    const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                    const hasRevenue = !!dayData && dayData.tradeCount > 0;
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6;

                    return (
                      <button
                        key={dayKey}
                        type="button"
                        onClick={() => setSelectedDay(day)}
                        className={cn(
                          "flex flex-col items-center justify-center rounded-md border min-h-[4.5rem] p-1 transition-colors",
                          inMonth ? "bg-card" : "bg-muted/30 text-muted-foreground",
                          isToday(day) && inMonth && "border-primary/50",
                          isSelected && "ring-2 ring-primary border-primary",
                          hasRevenue && inMonth && "hover:bg-accent/40",
                          !hasRevenue && inMonth && "hover:bg-muted/50",
                          hasRevenue && isWeekend && inMonth && "border-amber-500/40"
                        )}
                        data-testid={`journal-day-${dayKey}`}
                      >
                        <span className={cn("text-sm font-medium leading-none", !inMonth && "opacity-50")}>
                          {format(day, "d")}
                        </span>
                        {hasRevenue && inMonth && (
                          <>
                            <span
                              className={cn(
                                "text-[10px] font-semibold leading-tight mt-1",
                                pnlColorClass(dayData.total)
                              )}
                            >
                              {formatCompactCurrency(dayData.total)}
                            </span>
                            <span className="text-[9px] text-muted-foreground leading-none">
                              {dayData.tradeCount} {dayData.tradeCount === 1 ? "trade" : "trades"}
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>

                {((data?.skippedNoExit ?? 0) > 0 || (data?.skippedNoPnl ?? 0) > 0) && (
                  <p className="text-xs text-muted-foreground mt-4">
                    {(data?.skippedNoExit ?? 0) > 0 &&
                      `${data!.skippedNoExit} closed trade(s) missing exit date. `}
                    {(data?.skippedNoPnl ?? 0) > 0 &&
                      `${data!.skippedNoPnl} closed trade(s) missing P&L.`}
                  </p>
                )}
              </CardContent>
            </Card>

            {selectedDay ? (
              <Card data-testid="journal-day-trades">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Trades closed {format(selectedDay, "EEEE, MMM d, yyyy")}
                  </CardTitle>
                  <CardDescription>
                    {selectedTrades.length > 0
                      ? `${selectedTrades.length} position${selectedTrades.length === 1 ? "" : "s"}`
                      : "No closed positions on this day"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedTrades.length > 0 ? (
                    <div className="overflow-x-auto -mx-1">
                      <table className="w-full text-sm min-w-[900px]">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="pb-2 pr-3 font-medium">Ticker</th>
                            <th className="pb-2 pr-3 font-medium text-right"># Shares</th>
                            <th className="pb-2 pr-3 font-medium text-right">POS $</th>
                            <th className="pb-2 pr-3 font-medium text-right">Shares Sold</th>
                            <th className="pb-2 pr-3 font-medium text-right">Shares Remaining</th>
                            <th className="pb-2 pr-3 font-medium text-right">Profit $</th>
                            <th className="pb-2 pr-3 font-medium text-right">Profit %</th>
                            <th className="pb-2 pr-3 font-medium">Date Purchased</th>
                            <th className="pb-2 pr-3 font-medium text-right">Hold (mkt days)</th>
                            <th className="pb-2 font-medium">Market Condition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTrades.map((trade) => (
                            <tr key={trade.id} className="border-b last:border-0">
                              <td className="py-2 pr-3 font-medium">{trade.ticker}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {trade.positionSize > 0 ? trade.positionSize.toLocaleString() : "—"}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {trade.positionDollars > 0 ? formatCurrency(trade.positionDollars) : "—"}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {trade.sharesSold > 0 ? trade.sharesSold.toLocaleString() : "—"}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {trade.sharesRemaining.toLocaleString()}
                              </td>
                              <td
                                className={cn(
                                  "py-2 pr-3 text-right tabular-nums font-medium",
                                  trade.profitDollars != null ? pnlColorClass(trade.profitDollars) : ""
                                )}
                              >
                                {trade.profitDollars != null ? formatCurrency(trade.profitDollars) : "—"}
                              </td>
                              <td
                                className={cn(
                                  "py-2 pr-3 text-right tabular-nums font-medium",
                                  trade.profitPercent != null ? pnlColorClass(trade.profitPercent) : ""
                                )}
                              >
                                {formatProfitPct(trade.profitPercent)}
                              </td>
                              <td className="py-2 pr-3 whitespace-nowrap">
                                {trade.datePurchased
                                  ? format(
                                      new Date(trade.datePurchased + "T12:00:00Z"),
                                      "MMM d, yyyy"
                                    )
                                  : "—"}
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {trade.holdMarketDays != null ? trade.holdMarketDays : "—"}
                              </td>
                              <td className="py-2 text-xs">
                                {trade.marketConditionOnExit ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No closed trades on this day. Cash or other Activity data may still appear in the summary.
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : null}
            </div>

            <div className="space-y-4">
              <PercentageInvestedCard
                brokerFilter={brokerFilter}
                onBrokerFilterChange={setBrokerFilter}
                snapshot={investedSnapshot}
                brokerAccountNote={brokerAccountNote}
              />

              <JournalCashSetupCard
                brokerFilter={brokerFilter}
                cashLedger={data?.cashLedger}
                manualCashBrokers={data?.manualCashBrokers}
              />

              <Card data-testid="journal-today-summary">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Today</CardTitle>
                  <CardDescription>
                    {format(new Date(), "EEEE, MMM d, yyyy")}
                    {brokerFilter !== "ALL"
                      ? ` · ${JOURNAL_BROKER_FILTER_OPTIONS.find((o) => o.value === brokerFilter)?.label}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <JournalBalanceSummary
                    returnPct={todayReturnPct}
                    realized={todayRevenue?.total ?? 0}
                    unrealized={unrealizedPnL}
                    cash={todayCash ?? filteredLatestCash.cash}
                    positions={positionsValue}
                    openNote={openNote}
                    cashLabel={todayCash != null ? "Cash (EOD)" : `Cash (as of ${filteredLatestCash.date ? new Date(filteredLatestCash.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "last known"})`}
                  />
                  {todayRevenue ? (
                    <p className="text-xs text-muted-foreground mt-3">
                      {todayRevenue.tradeCount}{" "}
                      {todayRevenue.tradeCount === 1 ? "trade" : "trades"} closed
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Month</CardTitle>
                  <CardDescription>
                    {format(viewMonth, "MMMM yyyy")}
                    {brokerFilter !== "ALL"
                      ? ` · ${JOURNAL_BROKER_FILTER_OPTIONS.find((o) => o.value === brokerFilter)?.label}`
                      : ""}
                    {monthSummary.eomCashDate
                      ? ` · cash as of ${format(new Date(monthSummary.eomCashDate + "T12:00:00Z"), "MMM d")}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <JournalBalanceSummary
                    returnPct={monthReturnPct}
                    realized={monthSummary.realized}
                    unrealized={unrealizedPnL}
                    cash={monthSummary.cash}
                    positions={positionsValue}
                    openNote={openNote}
                    cashLabel="Cash (month-end)"
                  />
                  <div className="grid grid-cols-2 gap-3 text-sm border-t pt-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Trading days</p>
                      <p className="font-medium">{monthSummary.tradingDays}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Trades closed</p>
                      <p className="font-medium">{monthSummary.tradeCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {showSelectedDayCard ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {format(selectedDay!, "EEEE, MMM d")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedRevenue || selectedCash != null ? (
                      <>
                        <JournalBalanceSummary
                          returnPct={selectedReturnPct}
                          realized={selectedRevenue?.total ?? 0}
                          unrealized={unrealizedPnL}
                          cash={selectedCash}
                          positions={positionsValue}
                          openNote={openNote}
                          cashLabel="Cash (EOD)"
                        />
                        {selectedRevenue ? (
                          <p className="text-xs text-muted-foreground mt-3">
                            {selectedRevenue.tradeCount}{" "}
                            {selectedRevenue.tradeCount === 1 ? "trade" : "trades"} closed
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No closed trades or cash data on this day.
                      </p>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">YTD</CardTitle>
                  <CardDescription>
                    {ytdYear}
                    {brokerFilter !== "ALL"
                      ? ` · ${JOURNAL_BROKER_FILTER_OPTIONS.find((o) => o.value === brokerFilter)?.label}`
                      : ""}
                    {filteredLatestCash.date
                      ? ` · cash as of ${format(new Date(filteredLatestCash.date + "T12:00:00Z"), "MMM d")}`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <JournalBalanceSummary
                    returnPct={ytdReturnPct}
                    ytdGain={ytdGain}
                    realized={ytdSummary.realized}
                    unrealized={unrealizedPnL}
                    cash={filteredLatestCash.cash}
                    positions={positionsValue}
                    openNote={openNote}
                  />
                  <div className="grid grid-cols-2 gap-3 text-sm border-t pt-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Trading days</p>
                      <p className="font-medium">{ytdSummary.tradingDays}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Trades closed</p>
                      <p className="font-medium">{ytdSummary.tradeCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
