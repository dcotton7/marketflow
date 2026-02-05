import { useState, useRef, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSentinelAuth } from "@/context/SentinelAuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, LogOut, TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle, Eye, Crosshair, BookOpen, X, DollarSign, Brain, Sparkles, Lightbulb, ChevronRight, MoreHorizontal, Trash2, Edit3, XCircle, Check, Target, CircleDot, Search, ArrowUpDown, LayoutGrid, LayoutList } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SentinelHeader } from "@/components/SentinelHeader";

interface TradeLabel {
  id: number;
  name: string;
  color: string;
  isAdminOnly?: boolean;
}

interface TradeWithEvaluation {
  id: number;
  symbol: string;
  direction: string;
  entryPrice: number;
  entryDate?: string;
  stopPrice?: number;
  partialPrice?: number;
  targetPrice?: number;
  exitPrice?: number;
  positionSize?: number;
  status: string;
  actualPnL?: number;
  notes?: string;
  createdAt: string;
  labels?: TradeLabel[];
  lotEntries?: LotEntry[]; // Order grid lot entries for FIFO tracking
  source?: string; // 'hand' for manual entry, 'import' for CSV imports
  importBatchId?: string; // UUID of the import batch if source is 'import'
  importName?: string; // Display name for import batch (e.g., "FILE xxxx" or custom name)
  latestEvaluation?: {
    score: number;
    recommendation: string;
    riskFlags: string[];
  };
}

interface TradeSource {
  id: string; // 'hand' or batchId UUID
  name: string; // 'Hand Entered' or batch file name with date
  count: number;
}

interface TradeEvent {
  id: number;
  tradeId: number;
  eventType: string;
  description: string;
  createdAt: string;
  trade?: { symbol: string };
}

interface WatchlistItem {
  id: number;
  symbol: string;
  targetEntry?: number;
  stopPlan?: number;
  targetPlan?: number;
  alertPrice?: number;
  thesis?: string;
  priority: string;
  status: string;
  createdAt: string;
}

interface TradingRule {
  id: number;
  name: string;
  description?: string;
  category?: string;
  isActive: boolean;
  order: number;
  source?: string;
  severity?: string;
  isAutoReject?: boolean;
  ruleCode?: string;
  formula?: string;
}

interface DashboardData {
  considering: TradeWithEvaluation[];
  active: TradeWithEvaluation[];
  closed: TradeWithEvaluation[];
  recentEvents: TradeEvent[];
}

interface RuleSuggestion {
  id: number;
  name: string;
  description?: string;
  category?: string;
  source: string;
  severity?: string;
  isAutoReject?: boolean;
  ruleCode?: string;
  formula?: string;
  confidenceScore?: number;
  adoptionCount?: number;
  supportingData?: {
    totalTrades?: number;
    winRate?: number;
    avgPnL?: number;
    sampleSize?: number;
    patternDescription?: string;
  };
  status: string;
}

interface LotEntry {
  id: string;
  dateTime: string;
  qty: string;
  buySell: "buy" | "sell";
  price: string; // Cost Basis for buys, Sell Price for sells
}

// Calculate running total for lot entries (buys positive, sells negative)
function calculateRunningTotal(entries: LotEntry[]): number {
  return entries.reduce((total, entry) => {
    const qty = parseInt(entry.qty) || 0;
    if (entry.buySell === "buy") {
      return total + qty;
    } else {
      return total - qty;
    }
  }, 0);
}

// FIFO lot tracking - track remaining shares per buy lot and which sells depleted them
interface FifoLotInfo {
  lotId: string;
  originalQty: number;
  remainingQty: number;
  price: number;
  dateTime: string;
  depleted: boolean;
}

interface FifoSellInfo {
  sellId: string;
  qty: number;
  price: number;
  dateTime: string;
  depletedFrom: { lotId: string; qtyTaken: number }[];
}

interface FifoResult {
  buyLots: FifoLotInfo[];
  sells: FifoSellInfo[];
  totalRemaining: number;
  avgCostBasis: number;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  realizedProfit: number; // Total profit/loss from closed lots (sum of each sell's P&L)
  // Per-lot open P&L calculation function - takes current price, returns sum of (currentPrice - lotCost) × lotRemaining
  calculateOpenPnL: (currentPrice: number, isLong: boolean) => number;
}

function calculateFifoTracking(entries: LotEntry[]): FifoResult {
  // Sort entries by dateTime chronologically
  const sortedEntries = [...entries]
    .filter(e => e.dateTime && e.qty)
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
  
  const buyLots: FifoLotInfo[] = [];
  const sells: FifoSellInfo[] = [];
  
  // First pass: identify all buy lots
  sortedEntries.forEach(entry => {
    if (entry.buySell === 'buy') {
      buyLots.push({
        lotId: entry.id,
        originalQty: parseInt(entry.qty) || 0,
        remainingQty: parseInt(entry.qty) || 0,
        price: parseFloat(entry.price) || 0,
        dateTime: entry.dateTime,
        depleted: false,
      });
    }
  });
  
  // Second pass: apply sells using FIFO and track realized profit
  let realizedProfit = 0;
  
  sortedEntries.forEach(entry => {
    if (entry.buySell === 'sell') {
      let remainingToSell = parseInt(entry.qty) || 0;
      const sellPrice = parseFloat(entry.price) || 0;
      const sellInfo: FifoSellInfo = {
        sellId: entry.id,
        qty: remainingToSell,
        price: sellPrice,
        dateTime: entry.dateTime,
        depletedFrom: [],
      };
      
      // Apply FIFO - decrement from oldest lots first
      for (const lot of buyLots) {
        if (remainingToSell <= 0) break;
        if (lot.remainingQty > 0) {
          const qtyTaken = Math.min(lot.remainingQty, remainingToSell);
          lot.remainingQty -= qtyTaken;
          remainingToSell -= qtyTaken;
          sellInfo.depletedFrom.push({ lotId: lot.lotId, qtyTaken });
          
          // Calculate realized profit for this portion: (sell price - buy cost) * qty
          realizedProfit += (sellPrice - lot.price) * qtyTaken;
          
          if (lot.remainingQty === 0) {
            lot.depleted = true;
          }
        }
      }
      
      sells.push(sellInfo);
    }
  });
  
  // Calculate final position
  const totalRemaining = buyLots.reduce((sum, lot) => sum + lot.remainingQty, 0);
  
  // Calculate weighted average cost basis of remaining shares
  let totalCost = 0;
  buyLots.forEach(lot => {
    totalCost += lot.remainingQty * lot.price;
  });
  const avgCostBasis = totalRemaining > 0 ? totalCost / totalRemaining : 0;
  
  // Per-lot Open PnL calculation: sum of (currentPrice - lotCost) × lotRemaining for each lot
  const calculateOpenPnL = (currentPrice: number, isLong: boolean): number => {
    let openPnL = 0;
    for (const lot of buyLots) {
      if (lot.remainingQty > 0) {
        // For each lot still open: (Current Price - Lot Cost) × Remaining Qty
        const lotPnL = isLong
          ? (currentPrice - lot.price) * lot.remainingQty
          : (lot.price - currentPrice) * lot.remainingQty;
        openPnL += lotPnL;
      }
    }
    return openPnL;
  };

  return {
    buyLots,
    sells,
    totalRemaining,
    avgCostBasis,
    direction: totalRemaining > 0 ? 'LONG' : totalRemaining < 0 ? 'SHORT' : 'FLAT',
    realizedProfit,
    calculateOpenPnL,
  };
}

function getScoreColor(score: number): string {
  if (score >= 70) return "text-green-500";
  if (score >= 50) return "text-yellow-500";
  return "text-red-500";
}

// Inline editable price row component for click-to-edit
interface EditablePriceRowProps {
  label: string;
  icon: typeof XCircle;
  value: number | null | undefined;
  distance: number | null;
  isAlert?: boolean;
  alertColor?: "red" | "orange" | "green" | "yellow";
  onSave: (value: number) => void;
  testId: string;
}

function EditablePriceRow({ label, icon: Icon, value, distance, isAlert = false, alertColor = "red", onSave, testId }: EditablePriceRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value?.toFixed(2) || "");
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const numValue = parseFloat(editValue);
      if (!isNaN(numValue) && numValue > 0) {
        onSave(numValue);
      }
      setIsEditing(false);
    } else if (e.key === "Escape") {
      setEditValue(value?.toFixed(2) || "");
      setIsEditing(false);
    }
  };
  
  const handleSave = () => {
    const numValue = parseFloat(editValue);
    if (!isNaN(numValue) && numValue > 0) {
      onSave(numValue);
    }
    setIsEditing(false);
  };
  
  const handleCancel = () => {
    setEditValue(value?.toFixed(2) || "");
    setIsEditing(false);
  };
  
  const alertBgMap = { red: "bg-red-500/10", orange: "bg-orange-500/10", green: "bg-green-500/10", yellow: "bg-yellow-500/10" };
  const alertTextMap = { red: "text-red-500", orange: "text-orange-500", green: "text-green-500", yellow: "text-yellow-500" };
  const alertBg = alertBgMap[alertColor] || "bg-red-500/10";
  const alertText = alertTextMap[alertColor] || "text-red-500";
  
  return (
    <div 
      className={`flex items-center justify-between px-2 py-1 rounded ${isAlert ? alertBg : "bg-muted/30"}`} 
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 flex-1">
        <Icon className={`w-3 h-3 ${isAlert ? alertText : "text-muted-foreground"}`} />
        <span className={isAlert ? `${alertText} font-medium` : "text-muted-foreground"}>{label}</span>
        
        {isEditing ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              type="number"
              step="0.01"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                const numValue = parseFloat(editValue);
                if (!isNaN(numValue) && numValue > 0) {
                  onSave(numValue);
                }
                setIsEditing(false);
              }}
              className="w-20 h-5 px-1 text-xs bg-background border rounded focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid={`${testId}-input`}
            />
            <button 
              onClick={(e) => { e.stopPropagation(); handleSave(); }}
              className="p-0.5 text-green-500 hover:text-green-600"
              data-testid={`${testId}-save`}
            >
              <Check className="w-3 h-3" />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); handleCancel(); }}
              className="p-0.5 text-red-500 hover:text-red-600"
              data-testid={`${testId}-cancel`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <span 
            className="text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setEditValue(value?.toFixed(2) || "");
              setIsEditing(true);
            }}
            data-testid={`${testId}-value`}
          >
            {value ? `$${value.toFixed(2)}` : "Set"}
          </span>
        )}
      </div>
      
      {distance !== null && !isEditing && (
        <span className={`font-mono ${isAlert ? `${alertText} font-bold` : "text-muted-foreground"}`}>
          {distance > 0 ? "+" : ""}{distance.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function getShortRiskFlag(flag: string): { short: string; full: string } {
  const flagLower = flag.toLowerCase();
  if (flagLower.includes("stop") && flagLower.includes("day")) return { short: "STOP_LOD", full: flag };
  if (flagLower.includes("stop") && flagLower.includes("wide")) return { short: "WIDE_STOP", full: flag };
  if (flagLower.includes("stop")) return { short: "STOP_RISK", full: flag };
  if (flagLower.includes("concentration") || flagLower.includes("correlated")) return { short: "CORR_RISK", full: flag };
  if (flagLower.includes("late entry") || flagLower.includes("extended")) return { short: "LATE_ENTRY", full: flag };
  if (flagLower.includes("thesis") && (flagLower.includes("vague") || flagLower.includes("unclear"))) return { short: "WEAK_THESIS", full: flag };
  if (flagLower.includes("risk") && flagLower.includes("reward")) return { short: "POOR_RR", full: flag };
  if (flagLower.includes("volume")) return { short: "VOL_ISSUE", full: flag };
  if (flagLower.includes("trend") && flagLower.includes("down")) return { short: "DOWNTREND", full: flag };
  if (flagLower.includes("resistance")) return { short: "AT_RESIST", full: flag };
  if (flagLower.includes("support")) return { short: "SUPPORT", full: flag };
  if (flagLower.includes("chop") || flagLower.includes("choppy")) return { short: "CHOPPY_MKT", full: flag };
  if (flagLower.includes("market") && flagLower.includes("weak")) return { short: "WEAK_MKT", full: flag };
  if (flagLower.includes("size") || flagLower.includes("position")) return { short: "SIZE_ISSUE", full: flag };
  if (flagLower.includes("no stop") || flagLower.includes("without stop")) return { short: "NO_STOP", full: flag };
  if (flag.length <= 10) return { short: flag.toUpperCase(), full: flag };
  return { short: flag.substring(0, 8).toUpperCase() + "..", full: flag };
}

function getScoreBadgeVariant(score: number): "default" | "secondary" | "destructive" | "outline" {
  if (score >= 70) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

// Simple sparkline component based on % change direction
function MiniSparkline({ positive, className = "" }: { positive: boolean; className?: string }) {
  // Generate a simple upward or downward trend line
  const points = positive 
    ? "0,14 8,12 16,10 24,8 32,6 40,4 48,6 56,3 64,2"  // Upward trend
    : "0,2 8,4 16,6 24,8 32,10 40,12 48,10 56,13 64,14"; // Downward trend
  
  return (
    <svg 
      viewBox="0 0 64 16" 
      className={`h-4 w-16 ${className}`}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke={positive ? "#22c55e" : "#ef4444"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Compact Ticker Widget component
interface TickerWidgetProps {
  symbol: string;
  price: number;
  pctChange?: number;
  direction: string;
  status?: string; // "active", "considering", "watch"
  profitClosed?: number; // MTD realized P&L (for closed trades)
  openPnL?: number; // Unrealized P&L (for active trades)
  breakEven?: { shares: number; price: number }; // Break-even position info
}

function TickerWidget({ symbol, price, pctChange = 0, direction, status, profitClosed, openPnL, breakEven }: TickerWidgetProps) {
  const isPositive = pctChange >= 0;
  
  // Determine label based on status
  let statusLabel: string;
  let statusColor: string;
  
  if (status === "watch") {
    statusLabel = "WATCH";
    statusColor = "bg-yellow-600 text-white";
  } else {
    // Active or considering - show direction
    statusLabel = direction === "long" ? "LONG" : "SHORT";
    statusColor = direction === "long" ? "bg-green-600 text-white" : "bg-red-600 text-white";
  }
  
  return (
    <div className="flex items-center justify-between gap-1.5 flex-wrap w-full" data-testid={`ticker-widget-${symbol}`}>
      <div className="flex items-center gap-1.5">
        {/* Ticker Box - compact without sparkline */}
        <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1 border" data-testid={`ticker-box-${symbol}`}>
          <span className="font-bold text-sm" data-testid={`text-ticker-${symbol}`}>{symbol}</span>
          <span className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-red-500"}`} data-testid={`text-price-${symbol}`}>${price.toFixed(2)}</span>
          <span className={`text-sm font-semibold px-1.5 py-0.5 rounded ${isPositive ? "bg-green-500/20 text-green-500" : "bg-red-500/20 text-red-500"}`} data-testid={`text-pct-${symbol}`}>
            {isPositive ? "+" : ""}{pctChange.toFixed(2)}%
          </span>
        </div>
        {/* Direction/Status Badge - larger */}
        <Badge className={`${statusColor} text-sm px-3 py-1 font-semibold`} data-testid={`badge-status-${symbol}`}>
          {statusLabel}
        </Badge>
      </div>

      {/* P&L Metrics - stacked vertically, right justified with larger text */}
      <div className="flex flex-col items-end text-right">
        {(profitClosed !== undefined || openPnL !== undefined) && (
          <>
            {profitClosed !== undefined && (
              <span className={`text-base font-bold ${profitClosed >= 0 ? "text-green-500" : "text-red-500"}`} data-testid={`text-profit-closed-${symbol}`}>
                Closed: {profitClosed >= 0 ? "+" : ""}${profitClosed.toFixed(0)}
              </span>
            )}
            {openPnL !== undefined && (
              <span className={`text-base font-bold ${openPnL >= 0 ? "text-green-500" : "text-red-500"}`} data-testid={`text-open-pnl-${symbol}`}>
                Open: {openPnL >= 0 ? "+" : ""}${openPnL.toFixed(0)}
              </span>
            )}
          </>
        )}
        {breakEven && breakEven.shares > 0 && (
          <span 
            className={`text-sm font-medium ${price >= breakEven.price ? "text-green-500" : "text-red-500"}`} 
            data-testid={`text-breakeven-${symbol}`}
          >
            BreakEven: {breakEven.shares} shares @ ${breakEven.price.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

interface TradeCardProps {
  trade: TradeWithEvaluation;
  isActive?: boolean;
  isClosed?: boolean;
  onEdit?: (trade: TradeWithEvaluation) => void;
  onClose?: (trade: TradeWithEvaluation) => void;
  onCancel?: (trade: TradeWithEvaluation) => void;
  onPriceUpdate?: (tradeId: number, field: "stopPrice" | "partialPrice" | "targetPrice", value: number) => void;
}

function TradeCard({ trade, isActive = false, isClosed = false, onEdit, onClose, onCancel, onPriceUpdate, isExpanded = true }: TradeCardProps & { isExpanded?: boolean }) {
  const [, setLocation] = useLocation();
  
  // Fetch current market price for accurate P&L
  const tickerQuery = useQuery<{ symbol: string; price: number; name?: string }>({
    queryKey: ["/api/sentinel/ticker", trade.symbol],
    enabled: trade.status !== "closed", // Only fetch for active trades
    refetchInterval: 60000, // Refresh every minute
  });
  
  const handleOpenIvyAI = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLocation(`/sentinel/evaluate?tradeId=${trade.id}`);
  };

  const handleMenuAction = (action: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    switch (action) {
      case 'edit':
        onEdit?.(trade);
        break;
      case 'close':
        onClose?.(trade);
        break;
      case 'cancel':
        onCancel?.(trade);
        break;
      case 'ivyai':
        setLocation(`/sentinel/evaluate?tradeId=${trade.id}`);
        break;
    }
  };

  const handleCardClick = () => {
    setLocation(`/sentinel/evaluate?tradeId=${trade.id}`);
  };

  // Use live market price if available, otherwise fall back to entry price
  const currentPrice = tickerQuery.data?.price ?? trade.entryPrice;
  
  // Calculate actual % change from entry price using live market data
  const pctChange = currentPrice && trade.entryPrice 
    ? ((currentPrice - trade.entryPrice) / trade.entryPrice * 100) 
    : 0;
  
  // Calculate P&L from lot entries using FIFO method
  const fifoData = trade.lotEntries && Array.isArray(trade.lotEntries) && trade.lotEntries.length > 0
    ? calculateFifoTracking(trade.lotEntries as LotEntry[])
    : null;
  
  const isLongDirection = trade.direction === "long";
  
  // Calculate breakeven - use FIFO avgCostBasis if available, otherwise fall back to entry_price
  // For trades with lot entries: use weighted average cost from FIFO
  // For trades without lot entries: use entry_price (which is the broker's avg cost at import time)
  let breakEvenData: { shares: number; price: number } | undefined = undefined;
  if (fifoData && fifoData.totalRemaining > 0 && fifoData.avgCostBasis > 0) {
    breakEvenData = { shares: fifoData.totalRemaining, price: fifoData.avgCostBasis };
  } else if (!fifoData && trade.positionSize && trade.positionSize > 0 && trade.entryPrice > 0) {
    // Fallback for trades without lot entries: use entry_price as breakeven
    breakEvenData = { shares: trade.positionSize, price: trade.entryPrice };
  }
  
  // Open PnL (unrealized) - per-lot calculation: sum of (Current Price - Lot Cost) × Lot Remaining for each lot
  let openPnL: number | undefined = undefined;
  if (trade.status !== "closed" && fifoData && fifoData.totalRemaining > 0) {
    // Use per-lot calculation instead of avg cost basis
    openPnL = fifoData.calculateOpenPnL(currentPrice, isLongDirection);
  } else if (trade.status !== "closed" && trade.positionSize && !fifoData) {
    // Fallback if no lot entries: use entry price
    openPnL = isLongDirection
      ? (currentPrice - trade.entryPrice) * trade.positionSize
      : (trade.entryPrice - currentPrice) * trade.positionSize;
  }
  
  // Profit Closed (realized) - sum of each sell's P&L: (Sell Price - Buy Lot Cost) × Qty
  // For active trades with sells, show realized profit from partial closes
  // For fully closed trades, show actualPnL or FIFO realized profit
  let profitClosed: number | undefined = undefined;
  if (trade.status === "closed") {
    profitClosed = trade.actualPnL ?? (fifoData?.realizedProfit || undefined);
  } else if (fifoData && fifoData.realizedProfit !== 0) {
    profitClosed = fifoData.realizedProfit;
  }
  const isLong = trade.direction === "long";
  
  // Calculate % distance to each price level
  const stopDistance = trade.stopPrice 
    ? ((currentPrice - trade.stopPrice) / trade.stopPrice * 100) 
    : null;
  
  // Partial profit at 50% of the way to target (R:R midpoint)
  const partialProfitPrice = trade.stopPrice && trade.targetPrice
    ? trade.entryPrice + ((trade.targetPrice - trade.entryPrice) * 0.5)
    : null;
  const partialDistance = partialProfitPrice
    ? ((partialProfitPrice - currentPrice) / currentPrice * 100)
    : null;
  
  const targetDistance = trade.targetPrice
    ? ((trade.targetPrice - currentPrice) / currentPrice * 100)
    : null;

  // Alert thresholds: 0.5% = critical, 1% = warning
  const CRITICAL_THRESHOLD = 0.5;
  const WARNING_THRESHOLD = 1.0;
  
  // STOP: red if within 0.5%, orange if within 1%
  let stopAlertColor: "red" | "orange" | null = null;
  if (stopDistance !== null) {
    const absDistance = Math.abs(stopDistance);
    if (absDistance <= CRITICAL_THRESHOLD) stopAlertColor = "red";
    else if (absDistance <= WARNING_THRESHOLD) stopAlertColor = "orange";
  }
  
  // Calculate partial distance if we have a partial price
  const actualPartialPrice = trade.partialPrice || partialProfitPrice;
  const actualPartialDistance = actualPartialPrice
    ? ((actualPartialPrice - currentPrice) / currentPrice * 100)
    : null;
  
  // PARTIAL: green if within 0.5%, yellow if within 1%
  let partialAlertColor: "green" | "yellow" | null = null;
  if (actualPartialDistance !== null) {
    const absDistance = Math.abs(actualPartialDistance);
    if (absDistance <= CRITICAL_THRESHOLD) partialAlertColor = "green";
    else if (absDistance <= WARNING_THRESHOLD) partialAlertColor = "yellow";
  }
  
  // TARGET: green if within 0.5%, yellow if within 1%
  let targetAlertColor: "green" | "yellow" | null = null;
  if (targetDistance !== null) {
    const absDistance = Math.abs(targetDistance);
    if (absDistance <= CRITICAL_THRESHOLD) targetAlertColor = "green";
    else if (absDistance <= WARNING_THRESHOLD) targetAlertColor = "yellow";
  }
  
  // Banner alerts for card outline - use 0.5% threshold
  const nearStop = stopAlertColor === "red";
  const nearTarget = targetAlertColor === "green";

  return (
    <Card 
      className={`cursor-pointer relative ${nearStop ? "ring-2 ring-red-500 ring-inset" : nearTarget ? "ring-2 ring-green-500 ring-inset" : ""}`}
      data-testid={`card-trade-${trade.id}`}
      onClick={handleCardClick}
    >
      <CardContent className={`p-4 ${isExpanded ? 'pb-10' : 'pb-4'} relative overflow-hidden`}>
        {/* Alert banners */}
        {isExpanded && nearTarget && (
          <div className="absolute top-0 left-0 right-0 bg-green-500/20 text-green-500 text-xs text-center py-1 font-medium rounded-t-md flex items-center justify-center gap-1" data-testid={`alert-target-${trade.id}`}>
            <Target className="w-3 h-3" /> NEAR PROFIT TARGET!
          </div>
        )}
        {isExpanded && nearStop && (
          <div className="absolute top-0 left-0 right-0 bg-red-500/20 text-red-500 text-xs text-center py-1 font-medium rounded-t-md flex items-center justify-center gap-1" data-testid={`alert-stop-${trade.id}`}>
            <AlertTriangle className="w-3 h-3" /> NEAR STOP LOSS!
          </div>
        )}

        {/* Compact Ticker Widget with Sparkline */}
        <div className={`flex items-center justify-between mb-3 ${isExpanded && (nearTarget || nearStop) ? "mt-4" : ""}`}>
          <TickerWidget 
            symbol={trade.symbol}
            price={currentPrice}
            pctChange={pctChange}
            direction={trade.direction}
            status={isActive ? "active" : "considering"}
            openPnL={openPnL}
            profitClosed={profitClosed ?? undefined}
            breakEven={breakEvenData}
          />
          {isExpanded && trade.latestEvaluation && (
            <Badge variant={getScoreBadgeVariant(trade.latestEvaluation.score)} data-testid={`badge-score-${trade.id}`}>
              {trade.latestEvaluation.score}/100
            </Badge>
          )}
        </div>

        {isExpanded && (
          <>
            {/* Source and Labels Row */}
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {/* Source indicator */}
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`source-${trade.id}`}>
                {trade.source === 'import' && trade.importName 
                  ? trade.importName 
                  : trade.source === 'import' 
                    ? 'Imported' 
                    : 'Hand Entered'}
              </span>
              
              {/* Display labels with tooltips */}
              {trade.labels && trade.labels.length > 0 && (
                <>
                  {trade.labels.map((label) => {
                    const displayName = label.name.length > 10 ? label.name.substring(0, 8) + ".." : label.name;
                    return (
                      <Tooltip key={label.id}>
                        <TooltipTrigger asChild>
                          <span
                            className="px-2 py-0.5 text-xs rounded-full text-white cursor-help"
                            style={{ backgroundColor: label.color }}
                            data-testid={`label-${trade.id}-${label.id}`}
                          >
                            {displayName}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{label.name}</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </>
              )}
            </div>

            {/* Price Monitoring: Stop, Partial Profit, Profit Target with % distance - Always visible with click-to-edit */}
            <div className="text-xs space-y-1.5 mb-2">
              {/* Stop Loss - Always shown */}
              <EditablePriceRow
                label="STOP"
                icon={XCircle}
                value={trade.stopPrice}
                distance={stopDistance}
                isAlert={stopAlertColor !== null}
                alertColor={stopAlertColor || "red"}
                onSave={(value) => onPriceUpdate?.(trade.id, "stopPrice", value)}
                testId={`monitor-stop-${trade.id}`}
              />
              
              {/* Partial Profit - Always shown, editable (uses saved value or calculated default) */}
              <EditablePriceRow
                label="PARTIAL"
                icon={CircleDot}
                value={trade.partialPrice || partialProfitPrice}
                distance={actualPartialDistance}
                isAlert={partialAlertColor !== null}
                alertColor={partialAlertColor || "yellow"}
                onSave={(value) => onPriceUpdate?.(trade.id, "partialPrice", value)}
                testId={`monitor-partial-${trade.id}`}
              />
              
              {/* Profit Target - Always shown */}
              <EditablePriceRow
                label="TARGET"
                icon={Target}
                value={trade.targetPrice}
                distance={targetDistance}
                isAlert={targetAlertColor !== null}
                alertColor={targetAlertColor || "green"}
                onSave={(value) => onPriceUpdate?.(trade.id, "targetPrice", value)}
                testId={`monitor-target-${trade.id}`}
              />
            </div>

            {/* Risk flags with short names and tooltips */}
            {trade.latestEvaluation && trade.latestEvaluation.riskFlags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {trade.latestEvaluation.riskFlags.slice(0, 4).map((flag, i) => {
                  const { short, full } = getShortRiskFlag(flag);
                  return (
                    <Tooltip key={i}>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-xs cursor-help" data-testid={`badge-risk-${trade.id}-${i}`}>
                          <AlertTriangle className="w-3 h-3 mr-1 text-yellow-500" />
                          {short}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-sm">{full}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            )}

            {/* [AI] Button and Menu */}
            <div className="mt-4 flex items-center justify-between">
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs gap-1.5 h-7 px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setLocation(`/sentinel/evaluate?tradeId=${trade.id}`);
                }}
              >
                <Brain className="w-3.5 h-3.5 text-primary" />
                AI Review
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="text-green-500 h-7 w-7"
                    data-testid={`button-trade-menu-${trade.id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={(e) => handleMenuAction('edit', e)} data-testid={`menu-edit-${trade.id}`}>
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  {isActive && (
                    <DropdownMenuItem onClick={(e) => handleMenuAction('close', e)} data-testid={`menu-close-${trade.id}`}>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Close Trade
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={(e) => handleMenuAction('cancel', e)} className="text-destructive" data-testid={`menu-cancel-${trade.id}`}>
                    <XCircle className="w-4 h-4 mr-2" />
                    {isActive ? 'Cancel Trade' : 'Delete Item'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => handleMenuAction('ivyai', e)} data-testid={`menu-ivyai-${trade.id}`}>
                    <Brain className="w-4 h-4 mr-2 text-primary" />
                    Open Ivy AI
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EventItem({ event }: { event: TradeEvent }) {
  const getEventIcon = () => {
    switch (event.eventType) {
      case "status_change": return <CheckCircle className="w-4 h-4 text-blue-500" />;
      case "stop_update": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "target_update": return <TrendingUp className="w-4 h-4 text-green-500" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-0" data-testid={`event-${event.id}`}>
      {getEventIcon()}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          {event.trade && (
            <Badge variant="outline" className="text-xs">{event.trade.symbol}</Badge>
          )}
          <span className="text-sm">{event.description}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(event.createdAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function WatchlistCard({ item, onDelete }: { item: WatchlistItem; onDelete: (id: number) => void }) {
  const priorityColors = {
    high: "text-red-500 bg-red-500/10",
    medium: "text-yellow-500 bg-yellow-500/10",
    low: "text-green-500 bg-green-500/10",
  };

  return (
    <Card className="hover-elevate" data-testid={`card-watchlist-${item.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-muted-foreground" />
            <span className="font-bold text-lg" data-testid={`text-watchlist-symbol-${item.id}`}>{item.symbol}</span>
            <Badge className={priorityColors[item.priority as keyof typeof priorityColors] || priorityColors.medium}>
              {item.priority}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onDelete(item.id)} data-testid={`button-delete-watchlist-${item.id}`}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          {item.targetEntry && <div>Target Entry: ${item.targetEntry.toFixed(2)}</div>}
          {item.alertPrice && <div>Alert at: ${item.alertPrice.toFixed(2)}</div>}
          <div className="flex gap-4">
            {item.stopPlan && <span>Stop Plan: ${item.stopPlan.toFixed(2)}</span>}
            {item.targetPlan && <span>Target Plan: ${item.targetPlan.toFixed(2)}</span>}
          </div>
        </div>

        {item.thesis && (
          <div className="mt-2 text-sm text-muted-foreground italic line-clamp-2">
            {item.thesis}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RuleItem({ rule, onToggle, onDelete }: { rule: TradingRule; onToggle: (id: number, active: boolean) => void; onDelete: (id: number) => void }) {
  const categoryColors: Record<string, string> = {
    entry: "bg-blue-500/10 text-blue-500",
    exit: "bg-green-500/10 text-green-500",
    sizing: "bg-purple-500/10 text-purple-500",
    risk: "bg-red-500/10 text-red-500",
    general: "bg-muted text-muted-foreground",
    auto_reject: "bg-red-600/20 text-red-600",
    profit_taking: "bg-emerald-500/10 text-emerald-500",
    stop_loss: "bg-orange-500/10 text-orange-500",
    ma_structure: "bg-cyan-500/10 text-cyan-500",
    base_quality: "bg-indigo-500/10 text-indigo-500",
    breakout: "bg-teal-500/10 text-teal-500",
    position_sizing: "bg-violet-500/10 text-violet-500",
    market_regime: "bg-amber-500/10 text-amber-500",
  };

  const severityColors: Record<string, string> = {
    auto_reject: "bg-red-600 text-white",
    critical: "bg-orange-500 text-white",
    warning: "bg-yellow-500/20 text-yellow-600",
    info: "bg-blue-500/20 text-blue-500",
  };

  const sourceLabels: Record<string, string> = {
    starter: "Starter",
    user: "Custom",
    ai_collective: "AI Learned",
    ai_agentic: "AI Agent",
  };

  const categoryLabels: Record<string, string> = {
    auto_reject: "Structural",
    profit_taking: "Profit Taking",
    stop_loss: "Stop Loss",
    ma_structure: "MA Structure",
    base_quality: "Base Quality",
    breakout: "Breakout",
    position_sizing: "Position Sizing",
    entry: "Entry",
    exit: "Exit",
    risk: "Risk",
    market_regime: "Market Regime",
    general: "General",
  };

  const severityLabels: Record<string, string> = {
    auto_reject: "Structural Issue",
    critical: "Critical",
    warning: "Warning",
    info: "Info",
  };

  return (
    <div className={`flex items-center justify-between p-3 border rounded-md ${!rule.isActive ? 'opacity-50' : ''} ${rule.isAutoReject ? 'border-red-500/30' : ''}`} data-testid={`rule-${rule.id}`}>
      <div className="flex items-center gap-3 flex-1">
        <input
          type="checkbox"
          checked={rule.isActive}
          onChange={(e) => onToggle(rule.id, e.target.checked)}
          className="w-4 h-4"
          data-testid={`checkbox-rule-${rule.id}`}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {rule.isAutoReject && (
              <Badge className="bg-red-600 text-white text-xs">STRUCTURAL</Badge>
            )}
            <span className="font-medium">{rule.name}</span>
            {rule.category && (
              <Badge className={`${categoryColors[rule.category] || categoryColors.general} text-xs`}>
                {categoryLabels[rule.category] || rule.category.replace('_', ' ')}
              </Badge>
            )}
            {rule.source && rule.source !== 'user' && (
              <Badge variant="outline" className="text-xs">
                {sourceLabels[rule.source] || rule.source}
              </Badge>
            )}
            {rule.severity && rule.severity !== 'warning' && !rule.isAutoReject && (
              <Badge className={`${severityColors[rule.severity] || ''} text-xs`}>
                {severityLabels[rule.severity] || rule.severity}
              </Badge>
            )}
          </div>
          {rule.description && (
            <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
          )}
          {rule.formula && (
            <p className="text-xs text-muted-foreground mt-1 font-mono bg-muted/50 px-2 py-1 rounded inline-block">
              {rule.formula}
            </p>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={() => onDelete(rule.id)} data-testid={`button-delete-rule-${rule.id}`}>
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}

export default function SentinelDashboardPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useSentinelAuth();
  const { toast } = useToast();
  
  // State preservation keys
  const STORAGE_KEY_TAB = "sentinel_dashboard_active_tab";
  const STORAGE_KEY_LABELS = "sentinel_dashboard_label_filters";
  const STORAGE_KEY_SOURCES = "sentinel_dashboard_source_filters";
  const STORAGE_KEY_MONTH = "sentinel_dashboard_month_filter";
  const STORAGE_KEY_YEAR = "sentinel_dashboard_year_filter";
  
  // Initialize activeTab from localStorage
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TAB);
    return saved || "active";
  });
  
  // Initialize selectedLabelFilters from localStorage (multi-select with AND logic)
  const [selectedLabelFilters, setSelectedLabelFilters] = useState<number[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_LABELS);
    if (!saved || saved === "[]") return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  // Initialize selectedSourceFilters from localStorage (multi-select with AND logic)
  const [selectedSourceFilters, setSelectedSourceFilters] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SOURCES);
    if (!saved || saved === "[]") return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  
  // Month and Year filters
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_MONTH);
    return saved || "all";
  });
  
  const [selectedYear, setSelectedYear] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_YEAR);
    if (saved) return saved;
    return "all"; // Default to unfiltered
  });
  
  // Ticker search filter
  const [tickerSearch, setTickerSearch] = useState<string>("");
  
  // Sort order for trades
  const [sortOrder, setSortOrder] = useState<string>(() => {
    const saved = localStorage.getItem("sentinel_sort_order");
    return saved || "newest";
  });
  
  // Persist sort order
  useEffect(() => {
    localStorage.setItem("sentinel_sort_order", sortOrder);
  }, [sortOrder]);
  
  // Persist activeTab to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TAB, activeTab);
  }, [activeTab]);
  
  // Persist selectedLabelFilters to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LABELS, JSON.stringify(selectedLabelFilters));
  }, [selectedLabelFilters]);

  // Persist selectedSourceFilters to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(selectedSourceFilters));
  }, [selectedSourceFilters]);
  
  // Persist month/year to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_MONTH, selectedMonth);
  }, [selectedMonth]);
  
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_YEAR, selectedYear);
  }, [selectedYear]);
  
  // Toggle functions for multi-select
  const toggleLabelFilter = (labelId: number) => {
    setSelectedLabelFilters(prev => 
      prev.includes(labelId) 
        ? prev.filter(id => id !== labelId)
        : [...prev, labelId]
    );
  };
  
  const toggleSourceFilter = (sourceId: string) => {
    setSelectedSourceFilters(prev => 
      prev.includes(sourceId) 
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  // Dialogs
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [watchlistForm, setWatchlistForm] = useState({ symbol: "", targetEntry: "", thesis: "", priority: "medium" });
  const [ruleForm, setRuleForm] = useState({ 
    name: "", 
    description: "", 
    category: "entry",
    ruleType: "swing" as "swing" | "intraday" | "long_term" | "other",
    directionTags: [] as ("long" | "short")[],
    strategyTags: [] as string[],
    isGlobal: false, // Admin only - save globally vs personal
  });
  const [strategyTagInput, setStrategyTagInput] = useState("");
  const [ruleFilter, setRuleFilter] = useState<string>("all");
    
  // Trade action dialogs
  const [showEditTrade, setShowEditTrade] = useState(false);
  const [showCloseTrade, setShowCloseTrade] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showCancelTrade, setShowCancelTrade] = useState(false);
  const [showAddTrade, setShowAddTrade] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<TradeWithEvaluation | null>(null);
  
  // Delete by Source dialog
  const [showDeleteBySource, setShowDeleteBySource] = useState(false);
  const [deleteSourceForm, setDeleteSourceForm] = useState({
    sourceId: "", // 'hand' or batchId
    dateFrom: "",
    dateTo: "",
    confirmText: "",
  });
  
  // Add Trade form
  const [addTradeForm, setAddTradeForm] = useState({
    symbol: "",
    direction: "long" as "long" | "short",
    entryPrice: "",
    positionSize: "",
    stopPrice: "",
    targetPrice: "",
    thesis: "",
    tradeDate: new Date().toISOString().split("T")[0],
    tradeTime: "09:30",
    status: "active" as "considering" | "active",
    accountName: "", // Account for this trade
  });
  
  // Lot tracking table - each row is a lot entry
  const [lotEntries, setLotEntries] = useState<LotEntry[]>([]);
  
  const [editForm, setEditForm] = useState({
    entryPrice: "",
    stopPrice: "",
    targetPrice: "",
    positionSize: "",
    entryDate: "",
    exitPrice: ""
  });
  const [closeForm, setCloseForm] = useState({
    exitPrice: "",
    outcome: "win" as "win" | "loss" | "breakeven",
    notes: ""
  });
  
  // Trade tagging dialog
  const [showTaggingDialog, setShowTaggingDialog] = useState(false);
  const [taggingTrade, setTaggingTrade] = useState<TradeWithEvaluation | null>(null);
  const [taggingForm, setTaggingForm] = useState({
    setupType: "",
    outcome: "" as "" | "win" | "loss" | "breakeven",
    notes: ""
  });
  const [taggingAnalysis, setTaggingAnalysis] = useState<{
    holdDays: number | null;
    calculatedPnL: number;
    outcome: string;
    avgCostBasis: number;
    avgSellPrice: number;
  } | null>(null);
  const [suggestingSetup, setSuggestingSetup] = useState(false);
  
  // Batch tagging state
  const [showBatchTagDialog, setShowBatchTagDialog] = useState(false);
  const [batchSuggestions, setBatchSuggestions] = useState<Array<{
    groupKey: string;
    symbol: string;
    symbols?: string[];
    direction: string;
    tradeIds: number[];
    tradeCount: number;
    suggestedSetupType: string | null;
    confidence: string | null;
    reasoning: string;
  }>>([]);
  const [batchTaggingLoading, setBatchTaggingLoading] = useState(false);

  const { data: dashboard, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["/api/sentinel/dashboard"],
  });

  const { data: watchlist = [] } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/sentinel/watchlist"],
  });

  const { data: rules = [] } = useQuery<TradingRule[]>({
    queryKey: ["/api/sentinel/rules"],
  });

  const { data: suggestions = [] } = useQuery<RuleSuggestion[]>({
    queryKey: ["/api/sentinel/suggestions"],
  });

  const { data: allLabels = [] } = useQuery<TradeLabel[]>({
    queryKey: ["/api/sentinel/labels"],
  });

  // User's trading accounts for account selector
  const { data: accountSettings = [] } = useQuery<Array<{
    id: number;
    accountName: string;
    brokerId: string;
    accountNumber?: string;
  }>>({
    queryKey: ["/api/sentinel/account-settings"],
  });

  // Set default account when accounts are loaded
  useEffect(() => {
    if (accountSettings.length > 0 && !addTradeForm.accountName) {
      setAddTradeForm(prev => ({ ...prev, accountName: accountSettings[0].accountName }));
    }
  }, [accountSettings]);

  const { data: tradeSources = [] } = useQuery<TradeSource[]>({
    queryKey: ["/api/sentinel/trades/sources"],
  });
  
  // Tagging stats for AI Learning
  const { data: taggingStats } = useQuery<{
    totalClosed: number;
    tagged: number;
    untagged: number;
    imported: number;
    taggedPercent: number;
  }>({
    queryKey: ["/api/sentinel/trades/tagging-stats"],
  });
  
  // Untagged trades for review
  const { data: untaggedTrades = [] } = useQuery<TradeWithEvaluation[]>({
    queryKey: ["/api/sentinel/trades/untagged"],
  });
  
  // TNN performance data
  const tnnPerformance = useQuery<{
    totalTagged: number;
    performance: Array<{
      setupType: string;
      totalTrades: number;
      wins: number;
      losses: number;
      winRate: number;
      avgHoldDays: number;
      avgProfitPercent: number;
      recentTrend: "improving" | "declining" | "stable";
    }>;
    bestSetup: string | null;
    worstSetup: string | null;
  }>({
    queryKey: ["/api/sentinel/tnn/learning/performance"],
  });
  
  // Generate TNN suggestions mutation (admin only)
  const generateTnnSuggestionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sentinel/tnn/learning/generate-suggestions");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "TNN Suggestions Generated",
        description: data.message || `Generated ${data.count} new suggestions`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/tnn/suggestions"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate TNN suggestions",
        variant: "destructive",
      });
    },
  });

  // Filter trades by source, labels, month, and year
  // Sources use OR logic (show trades from ANY selected source - a trade only has one source)
  // Tags use AND logic (show trades that have ALL selected labels)
  const filterTrades = (trades: TradeWithEvaluation[] | undefined) => {
    if (!trades) return trades;
    
    let filtered = trades;
    
    // Filter by source (OR logic - show trades from ANY of the selected sources)
    // Note: A trade can only have one source, so OR is the only logical choice
    if (selectedSourceFilters.length > 0) {
      filtered = filtered.filter(trade => {
        return selectedSourceFilters.some(sourceId => {
          if (sourceId === 'hand') {
            return !trade.source || trade.source === 'hand';
          }
          return trade.importBatchId === sourceId;
        });
      });
    }
    
    // Filter by labels (AND logic - must have ALL selected labels)
    if (selectedLabelFilters.length > 0) {
      filtered = filtered.filter(trade => {
        if (!trade.labels || trade.labels.length === 0) return false;
        // Trade must have ALL selected labels
        return selectedLabelFilters.every(labelId => 
          trade.labels?.some(label => label.id === labelId)
        );
      });
    }
    
    // Filter by year
    if (selectedYear !== "all") {
      filtered = filtered.filter(trade => {
        const tradeDate = trade.entryDate || trade.createdAt;
        if (!tradeDate) return true;
        const year = new Date(tradeDate).getFullYear().toString();
        return year === selectedYear;
      });
    }
    
    // Filter by month
    if (selectedMonth !== "all") {
      filtered = filtered.filter(trade => {
        const tradeDate = trade.entryDate || trade.createdAt;
        if (!tradeDate) return true;
        const month = (new Date(tradeDate).getMonth() + 1).toString().padStart(2, '0');
        return month === selectedMonth;
      });
    }
    
    // Filter by ticker search
    if (tickerSearch.trim() !== "") {
      const searchTerm = tickerSearch.trim().toUpperCase();
      filtered = filtered.filter(trade => 
        trade.symbol.toUpperCase().includes(searchTerm)
      );
    }
    
    // Sort trades
    filtered = [...filtered].sort((a, b) => {
      switch (sortOrder) {
        case "symbol_asc":
          return a.symbol.localeCompare(b.symbol);
        case "symbol_desc":
          return b.symbol.localeCompare(a.symbol);
        case "newest": {
          const aDate = a.entryDate || a.createdAt || 0;
          const bDate = b.entryDate || b.createdAt || 0;
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        }
        case "oldest": {
          const aDate = a.entryDate || a.createdAt || 0;
          const bDate = b.entryDate || b.createdAt || 0;
          return new Date(aDate).getTime() - new Date(bDate).getTime();
        }
        case "pnl_high": {
          const aPnl = a.actualPnL || 0;
          const bPnl = b.actualPnL || 0;
          return bPnl - aPnl;
        }
        case "pnl_low": {
          const aPnl = a.actualPnL || 0;
          const bPnl = b.actualPnL || 0;
          return aPnl - bPnl;
        }
        default:
          return 0;
      }
    });
    
    return filtered;
  };
  
  // Get available years from trades for dropdown
  const getAvailableYears = () => {
    const years = new Set<string>();
    const allTrades = [...(dashboard?.active || []), ...(dashboard?.closed || []), ...(dashboard?.considering || [])];
    allTrades.forEach(trade => {
      const tradeDate = trade.entryDate || trade.createdAt;
      if (tradeDate) {
        years.add(new Date(tradeDate).getFullYear().toString());
      }
    });
    return Array.from(years).sort().reverse();
  };
  
  const availableYears = getAvailableYears();

  const filteredConsidering = filterTrades(dashboard?.considering);
  const filteredActive = filterTrades(dashboard?.active);
  const filteredClosed = filterTrades(dashboard?.closed);
  
  // Calculate summary stats from filtered trades
  const calculateSummary = () => {
    let openPnL = 0;
    let realizedPnL = 0;
    
    // Open PnL from active trades (using FIFO)
    filteredActive?.forEach(trade => {
      if (trade.lotEntries && trade.lotEntries.length > 0) {
        const fifo = calculateFifoTracking(trade.lotEntries);
        // Use current entry price as proxy for current price (should be real-time ideally)
        const currentPrice = trade.entryPrice;
        const isLong = trade.direction === 'long';
        openPnL += fifo.calculateOpenPnL(currentPrice, isLong);
      }
    });
    
    // Realized PnL from closed trades
    filteredClosed?.forEach(trade => {
      if (trade.actualPnL !== undefined && trade.actualPnL !== null) {
        realizedPnL += trade.actualPnL;
      }
    });
    
    return { openPnL, realizedPnL };
  };
  
  const summary = calculateSummary();

  // Mutations
  const addWatchlistMutation = useMutation({
    mutationFn: async (data: { symbol: string; targetEntry?: number; thesis?: string; priority: string }) => {
      return apiRequest("POST", "/api/sentinel/watchlist", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      setShowAddWatchlist(false);
      setWatchlistForm({ symbol: "", targetEntry: "", thesis: "", priority: "medium" });
      toast({ title: "Added to watchlist" });
    },
  });

  const deleteWatchlistMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/sentinel/watchlist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const deleteBySourceMutation = useMutation({
    mutationFn: async (data: { sourceId: string; dateFrom?: string; dateTo?: string; confirmDelete: string }) => {
      const response = await apiRequest("DELETE", "/api/sentinel/trades/by-source", data);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Delete failed with status ${response.status}`);
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trades/sources"] });
      setShowDeleteBySource(false);
      setDeleteSourceForm({ sourceId: "", dateFrom: "", dateTo: "", confirmText: "" });
      toast({ 
        title: "Trades Deleted", 
        description: `Successfully deleted ${data.deleted} trades.`
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete Failed", 
        description: error?.message || "Could not delete trades. Please try again.",
        variant: "destructive" 
      });
    },
  });
  
  // Tag trade mutation for AI learning
  const tagTradeMutation = useMutation({
    mutationFn: async ({ tradeId, setupType, outcome, notes }: { 
      tradeId: number; 
      setupType: string; 
      outcome?: string; 
      notes?: string 
    }) => {
      const response = await apiRequest("POST", `/api/sentinel/trades/${tradeId}/tag`, { 
        setupType, 
        outcome, 
        notes 
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to tag trade");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trades/untagged"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trades/tagging-stats"] });
      setShowTaggingDialog(false);
      setTaggingTrade(null);
      setTaggingForm({ setupType: "", outcome: "", notes: "" });
      setTaggingAnalysis(null);
      toast({ title: "Trade tagged for AI learning" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Tagging Failed", 
        description: error?.message || "Could not tag trade.",
        variant: "destructive" 
      });
    },
  });
  
  // Batch tag mutation for bulk tagging
  const batchTagMutation = useMutation({
    mutationFn: async ({ tradeIds, setupType }: { tradeIds: number[]; setupType: string }) => {
      const response = await apiRequest("POST", "/api/sentinel/trades/batch-tag", { 
        tradeIds, 
        setupType 
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to batch tag trades");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trades/untagged"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/trades/tagging-stats"] });
      toast({ title: `Tagged ${data.updatedCount} trades` });
    },
    onError: (error: any) => {
      toast({ 
        title: "Batch Tagging Failed", 
        description: error?.message || "Could not batch tag trades.",
        variant: "destructive" 
      });
    },
  });
  
  // Fetch batch tag suggestions
  const fetchBatchSuggestions = async () => {
    setBatchTaggingLoading(true);
    try {
      const response = await apiRequest("POST", "/api/sentinel/trades/batch-tag-suggestions", {});
      if (!response.ok) throw new Error("Failed to get suggestions");
      const data = await response.json();
      setBatchSuggestions(data.suggestions || []);
      setShowBatchTagDialog(true);
      if (data.suggestions?.length === 0) {
        toast({ title: "No patterns found", description: data.message });
      }
    } catch (error: any) {
      toast({ 
        title: "Failed to analyze trades", 
        description: error?.message || "Could not analyze trades for patterns.",
        variant: "destructive" 
      });
    } finally {
      setBatchTaggingLoading(false);
    }
  };
  
  // Apply batch tag to a group
  const applyBatchTag = (group: typeof batchSuggestions[0]) => {
    if (!group.suggestedSetupType) return;
    batchTagMutation.mutate({ 
      tradeIds: group.tradeIds, 
      setupType: group.suggestedSetupType 
    });
    // Remove this group from suggestions
    setBatchSuggestions(prev => prev.filter(s => s.groupKey !== group.groupKey));
  };
  
  // Open tagging dialog and analyze trade
  const openTaggingDialog = async (trade: TradeWithEvaluation) => {
    setTaggingTrade(trade);
    setTaggingForm({
      setupType: (trade as any).setupType || "",
      outcome: (trade as any).outcome || "",
      notes: trade.notes || ""
    });
    setShowTaggingDialog(true);
    
    // Analyze the trade
    try {
      const response = await fetch(`/api/sentinel/trades/${trade.id}/analyze`, {
        method: "POST",
        credentials: "include"
      });
      if (response.ok) {
        const analysis = await response.json();
        setTaggingAnalysis(analysis);
        // Pre-fill outcome from analysis if not already set on trade
        const existingOutcome = (trade as any).outcome;
        if (!existingOutcome && analysis.outcome) {
          setTaggingForm(prev => ({ ...prev, outcome: analysis.outcome }));
        }
      }
    } catch (error) {
      console.error("Trade analysis failed:", error);
    }
  };
  
  // Get AI setup suggestion
  const getAISetupSuggestion = async () => {
    if (!taggingTrade) return;
    setSuggestingSetup(true);
    try {
      const response = await fetch(`/api/sentinel/trades/${taggingTrade.id}/suggest-setup`, {
        method: "POST",
        credentials: "include"
      });
      if (response.ok) {
        const suggestion = await response.json();
        setTaggingForm(prev => ({ ...prev, setupType: suggestion.suggestedSetup }));
        toast({ 
          title: "AI Suggestion",
          description: `${suggestion.suggestedSetup} (${Math.round(suggestion.confidence * 100)}% confidence): ${suggestion.reasoning}`
        });
      }
    } catch (error) {
      toast({ title: "Could not get AI suggestion", variant: "destructive" });
    } finally {
      setSuggestingSetup(false);
    }
  };

  const addRuleMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; category?: string }) => {
      return apiRequest("POST", "/api/sentinel/rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      setShowAddRule(false);
      setRuleForm({ 
        name: "", 
        description: "", 
        category: "entry", 
        ruleType: "swing", 
        directionTags: [], 
        strategyTags: [],
        isGlobal: false,
      });
      setStrategyTagInput("");
      toast({ title: "Rule added" });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/sentinel/rules/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/sentinel/rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule deleted" });
    },
  });

  const adoptSuggestionMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/sentinel/suggestions/${id}/adopt`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      toast({ title: "Rule adopted to your rulebook" });
    },
  });

  const dismissSuggestionMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/sentinel/suggestions/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/suggestions"] });
      toast({ title: "Suggestion dismissed" });
    },
  });

  const analyzeRulesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sentinel/ai/analyze-rules");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/suggestions"] });
      toast({ title: data.message || "AI analysis complete" });
    },
  });

  const deleteTradeMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/sentinel/trade/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      setShowCancelTrade(false);
      setSelectedTrade(null);
      toast({ title: "Trade removed" });
    },
  });

  const closeTradeMutation = useMutation({
    mutationFn: async (data: { tradeId: number; exitPrice: number; outcome: string; notes?: string }) => {
      return apiRequest("POST", `/api/sentinel/trade/${data.tradeId}/close`, {
        exitPrice: data.exitPrice,
        outcome: data.outcome,
        notes: data.notes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      setShowCloseTrade(false);
      setSelectedTrade(null);
      setCloseForm({ exitPrice: "", outcome: "win", notes: "" });
      toast({ title: "Trade closed successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to close trade", description: error.message, variant: "destructive" });
    },
  });

  const updateTradeMutation = useMutation({
    mutationFn: async (data: { tradeId: number; entryPrice?: number; stopPrice?: number; partialPrice?: number; targetPrice?: number; positionSize?: number; entryDate?: string; exitPrice?: number; lotEntries?: LotEntry[] }) => {
      const { tradeId, ...updateData } = data;
      return apiRequest("PATCH", `/api/sentinel/trade/${tradeId}`, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      setShowEditTrade(false);
      setSelectedTrade(null);
      setEditForm({ entryPrice: "", stopPrice: "", targetPrice: "", positionSize: "", entryDate: "", exitPrice: "" });
      toast({ title: "Trade updated" });
    },
  });

  const createTradeMutation = useMutation({
    mutationFn: async (data: {
      symbol: string;
      direction: "long" | "short";
      entryPrice: number;
      positionSize?: number;
      stopPrice?: number;
      targetPrice?: number;
      thesis?: string;
      tradeDate?: string;
      tradeTime?: string;
      status: "considering" | "active";
      accountName?: string;
    }) => {
      return apiRequest("POST", "/api/sentinel/trades", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/dashboard"] });
      setShowAddTrade(false);
      // Keep accountName as default for next trade entry
      const defaultAccount = addTradeForm.accountName;
      setAddTradeForm({
        symbol: "",
        direction: "long",
        entryPrice: "",
        positionSize: "",
        stopPrice: "",
        targetPrice: "",
        thesis: "",
        tradeDate: new Date().toISOString().split("T")[0],
        tradeTime: "09:30",
        status: "active",
        accountName: defaultAccount, // Preserve for next entry
      });
      toast({ title: "Trade added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add trade", description: error.message, variant: "destructive" });
    },
  });

  const handleAddTrade = () => {
    if (!addTradeForm.symbol || !addTradeForm.entryPrice) {
      toast({ title: "Symbol and entry price are required", variant: "destructive" });
      return;
    }
    createTradeMutation.mutate({
      symbol: addTradeForm.symbol.toUpperCase(),
      direction: addTradeForm.direction,
      entryPrice: parseFloat(addTradeForm.entryPrice),
      positionSize: addTradeForm.positionSize ? parseFloat(addTradeForm.positionSize) : undefined,
      stopPrice: addTradeForm.stopPrice ? parseFloat(addTradeForm.stopPrice) : undefined,
      targetPrice: addTradeForm.targetPrice ? parseFloat(addTradeForm.targetPrice) : undefined,
      thesis: addTradeForm.thesis || undefined,
      tradeDate: addTradeForm.tradeDate,
      tradeTime: addTradeForm.tradeTime,
      status: addTradeForm.status,
      accountName: addTradeForm.accountName || undefined,
    });
  };

  // Lot entry helpers
  const addLotEntry = () => {
    const newLot: LotEntry = {
      id: Date.now().toString(),
      dateTime: "",
      qty: "",
      buySell: "buy",
      price: ""
    };
    setLotEntries([...lotEntries, newLot]);
  };

  const updateLotEntry = (id: string, field: keyof LotEntry, value: string) => {
    setLotEntries(lotEntries.map(lot => 
      lot.id === id ? { ...lot, [field]: value } : lot
    ));
  };

  const removeLotEntry = (id: string) => {
    setLotEntries(lotEntries.filter(lot => lot.id !== id));
  };

  // Get running total for display (positive = long, negative = short, 0 = balanced)
  const runningTotal = calculateRunningTotal(lotEntries);
  const canCloseTrade = runningTotal === 0;

  // Handler for inline price updates from trading cards
  const handlePriceUpdate = (tradeId: number, field: "stopPrice" | "partialPrice" | "targetPrice", value: number) => {
    updateTradeMutation.mutate({
      tradeId,
      [field]: value,
    });
  };

  // Trade action handlers
  const handleEditTrade = (trade: TradeWithEvaluation) => {
    setSelectedTrade(trade);
    
    // Check if trade has saved lotEntries from database
    if (trade.lotEntries && Array.isArray(trade.lotEntries) && trade.lotEntries.length > 0) {
      // Load saved lot entries, converting dateTime from ISO to datetime-local format
      const convertedEntries = (trade.lotEntries as LotEntry[]).map(lot => ({
        ...lot,
        dateTime: lot.dateTime ? new Date(lot.dateTime).toISOString().slice(0, 16) : ""
      }));
      setLotEntries(convertedEntries);
    } else {
      // Initialize with existing BUY from Ivy Evaluator (fallback for old trades)
      const buyLot: LotEntry = {
        id: "initial-buy",
        dateTime: trade.entryDate ? new Date(trade.entryDate).toISOString().slice(0, 16) : "",
        qty: trade.positionSize?.toString() || "",
        buySell: "buy",
        price: trade.entryPrice.toFixed(2)
      };
      // If trade has exit price, add a sell lot too
      const lots: LotEntry[] = [buyLot];
      if (trade.exitPrice && trade.positionSize) {
        const sellLot: LotEntry = {
          id: "initial-sell",
          dateTime: "",
          qty: trade.positionSize.toString(),
          buySell: "sell",
          price: trade.exitPrice.toFixed(2)
        };
        lots.push(sellLot);
      }
      setLotEntries(lots);
    }
    setEditForm({
      entryPrice: trade.entryPrice.toFixed(2),
      stopPrice: trade.stopPrice?.toFixed(2) || "",
      targetPrice: trade.targetPrice?.toFixed(2) || "",
      positionSize: trade.positionSize?.toString() || "",
      entryDate: trade.entryDate ? new Date(trade.entryDate).toISOString().slice(0, 16) : "",
      exitPrice: trade.exitPrice?.toFixed(2) || ""
    });
    setShowEditTrade(true);
  };

  const handleCloseTrade = (trade: TradeWithEvaluation) => {
    setSelectedTrade(trade);
    // Show confirmation dialog first per spec
    setShowCloseConfirm(true);
  };

  const handleCloseConfirmYes = () => {
    // User wants to edit details first
    setShowCloseConfirm(false);
    if (selectedTrade) {
      handleEditTrade(selectedTrade);
    }
  };

  const handleCloseConfirmNo = () => {
    // User doesn't want to edit - close trade as canceled per spec
    setShowCloseConfirm(false);
    if (selectedTrade) {
      // Close trade with outcome as "canceled" by using the close mutation
      closeTradeMutation.mutate({
        tradeId: selectedTrade.id,
        exitPrice: selectedTrade.entryPrice, // Use entry as exit for canceled
        outcome: "loss", // Mark as loss since it was canceled
        notes: "Trade canceled without editing final details"
      });
    }
  };

  const handleCancelTrade = (trade: TradeWithEvaluation) => {
    setSelectedTrade(trade);
    setShowCancelTrade(true);
  };

  const confirmDeleteTrade = () => {
    if (selectedTrade) {
      deleteTradeMutation.mutate(selectedTrade.id);
    }
  };

  const confirmCloseTrade = () => {
    if (selectedTrade && closeForm.exitPrice) {
      closeTradeMutation.mutate({
        tradeId: selectedTrade.id,
        exitPrice: parseFloat(closeForm.exitPrice),
        outcome: closeForm.outcome,
        notes: closeForm.notes || undefined
      });
    }
  };

  const confirmEditTrade = () => {
    if (selectedTrade) {
      // Aggregate lot data from buys and sells
      const buyLots = lotEntries.filter(lot => lot.buySell === "buy" && lot.qty && lot.price);
      const sellLots = lotEntries.filter(lot => lot.buySell === "sell" && lot.qty && lot.price);
      
      let totalBuyQty = 0;
      let totalBuyCost = 0;
      let latestDateTime = "";
      
      buyLots.forEach(lot => {
        const qty = parseInt(lot.qty) || 0;
        const price = parseFloat(lot.price) || 0;
        totalBuyQty += qty;
        totalBuyCost += qty * price;
        if (lot.dateTime) latestDateTime = lot.dateTime;
      });
      
      // Calculate weighted average cost basis from buys
      const avgCostBasis = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : parseFloat(editForm.entryPrice) || 0;
      
      // Get exit price from sells (weighted average)
      let totalSellQty = 0;
      let totalSellValue = 0;
      sellLots.forEach(lot => {
        const qty = parseInt(lot.qty) || 0;
        const price = parseFloat(lot.price) || 0;
        totalSellQty += qty;
        totalSellValue += qty * price;
      });
      const avgSellPrice = totalSellQty > 0 ? totalSellValue / totalSellQty : undefined;
      
      // Save the full lot entries array for persistence
      updateTradeMutation.mutate({
        tradeId: selectedTrade.id,
        entryPrice: avgCostBasis || undefined,
        stopPrice: editForm.stopPrice ? parseFloat(editForm.stopPrice) : undefined,
        targetPrice: editForm.targetPrice ? parseFloat(editForm.targetPrice) : undefined,
        positionSize: totalBuyQty || undefined,
        entryDate: latestDateTime || editForm.entryDate || undefined,
        exitPrice: avgSellPrice,
        lotEntries: lotEntries.filter(lot => lot.qty && lot.qty !== "0" && lot.dateTime && lot.price) // Only save valid entries with qty, dateTime, and price
      });
    }
  };

  const handleLogout = async () => {
    await logout();
    setLocation("/sentinel/login");
  };

  const handleAddWatchlist = () => {
    if (!watchlistForm.symbol) return;
    addWatchlistMutation.mutate({
      symbol: watchlistForm.symbol.toUpperCase(),
      targetEntry: watchlistForm.targetEntry ? parseFloat(watchlistForm.targetEntry) : undefined,
      thesis: watchlistForm.thesis || undefined,
      priority: watchlistForm.priority,
    });
  };

  const handleAddRule = () => {
    if (!ruleForm.name || ruleForm.directionTags.length === 0) return;
    addRuleMutation.mutate({
      name: ruleForm.name,
      description: ruleForm.description || undefined,
      category: ruleForm.category,
      ruleType: ruleForm.ruleType,
      directionTags: ruleForm.directionTags,
      strategyTags: ruleForm.strategyTags.length > 0 ? ruleForm.strategyTags : undefined,
      isGlobal: ruleForm.isGlobal,
    });
  };

  const handleDirectionToggle = (direction: "long" | "short") => {
    setRuleForm(prev => {
      const current = prev.directionTags;
      if (current.includes(direction)) {
        return { ...prev, directionTags: current.filter(d => d !== direction) };
      } else {
        return { ...prev, directionTags: [...current, direction] };
      }
    });
  };

  const handleAddStrategyTag = () => {
    const tag = strategyTagInput.trim().toLowerCase();
    if (tag && tag.length <= 20 && !ruleForm.strategyTags.includes(tag)) {
      setRuleForm(prev => ({ ...prev, strategyTags: [...prev.strategyTags, tag] }));
      setStrategyTagInput("");
    }
  };

  const handleRemoveStrategyTag = (tag: string) => {
    setRuleForm(prev => ({ ...prev, strategyTags: prev.strategyTags.filter(t => t !== tag) }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-destructive">Failed to load dashboard</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <SentinelHeader showSentiment={true} />
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground" data-testid="text-username">
              {user?.username}
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout} data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Trading Cards</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="button-add-trade-menu">
                <Plus className="w-4 h-4 mr-2" />
                Add Trade
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLocation("/sentinel/evaluate")} data-testid="menu-new-evaluation">
                <Brain className="w-4 h-4 mr-2" />
                Ask Ivy (Evaluation)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowAddTrade(true)} data-testid="menu-add-trade-direct">
                <Plus className="w-4 h-4 mr-2" />
                Add Trade Directly
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Summary Section */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Open PnL</div>
              <div className={`text-xl font-bold ${summary.openPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {summary.openPnL >= 0 ? '+' : ''}{summary.openPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Realized Gain/Loss</div>
              <div className={`text-xl font-bold ${summary.realizedPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {summary.realizedPnL >= 0 ? '+' : ''}{summary.realizedPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Active Positions</div>
              <div className="text-xl font-bold">{filteredActive?.length || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Closed Trades</div>
              <div className="text-xl font-bold">{filteredClosed?.length || 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filter Controls */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* Ticker Search */}
              <div className="flex items-center gap-2">
                <Label className="text-sm">Search:</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Ticker..."
                    value={tickerSearch}
                    onChange={(e) => setTickerSearch(e.target.value)}
                    className="pl-8 h-9 w-28"
                    data-testid="filter-ticker-search"
                  />
                </div>
              </div>
              
              {/* Sort Order */}
              <div className="flex items-center gap-2">
                <Label className="text-sm">Sort:</Label>
                <Select value={sortOrder} onValueChange={setSortOrder}>
                  <SelectTrigger className="w-36" data-testid="filter-sort">
                    <ArrowUpDown className="h-3 w-3 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest First</SelectItem>
                    <SelectItem value="oldest">Oldest First</SelectItem>
                    <SelectItem value="symbol_asc">Symbol A→Z</SelectItem>
                    <SelectItem value="symbol_desc">Symbol Z→A</SelectItem>
                    <SelectItem value="pnl_high">P&L High→Low</SelectItem>
                    <SelectItem value="pnl_low">P&L Low→High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Month Filter */}
              <div className="flex items-center gap-2">
                <Label className="text-sm">Month:</Label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-32" data-testid="filter-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="01">January</SelectItem>
                    <SelectItem value="02">February</SelectItem>
                    <SelectItem value="03">March</SelectItem>
                    <SelectItem value="04">April</SelectItem>
                    <SelectItem value="05">May</SelectItem>
                    <SelectItem value="06">June</SelectItem>
                    <SelectItem value="07">July</SelectItem>
                    <SelectItem value="08">August</SelectItem>
                    <SelectItem value="09">September</SelectItem>
                    <SelectItem value="10">October</SelectItem>
                    <SelectItem value="11">November</SelectItem>
                    <SelectItem value="12">December</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Year Filter */}
              <div className="flex items-center gap-2">
                <Label className="text-sm">Year:</Label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-24" data-testid="filter-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {availableYears.map(year => (
                      <SelectItem key={year} value={year}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {/* Source Multi-Select */}
              {tradeSources.length > 0 && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Source:</Label>
                  <div className="flex flex-wrap gap-1">
                    {tradeSources.map((source) => (
                      <Button
                        key={source.id}
                        size="sm"
                        variant={selectedSourceFilters.includes(source.id) ? "default" : "outline"}
                        onClick={() => toggleSourceFilter(source.id)}
                        className="h-7 text-xs"
                        data-testid={`filter-source-${source.id}`}
                      >
                        {source.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Tags Multi-Select */}
              {allLabels.length > 0 && (
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Tags:</Label>
                  <div className="flex flex-wrap gap-1">
                    {allLabels.map((label) => (
                      <Button
                        key={label.id}
                        size="sm"
                        variant={selectedLabelFilters.includes(label.id) ? "default" : "outline"}
                        onClick={() => toggleLabelFilter(label.id)}
                        className="h-7 text-xs gap-1"
                        data-testid={`filter-tag-${label.id}`}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: label.color }}
                        />
                        {label.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Clear Filters */}
              {(selectedSourceFilters.length > 0 || selectedLabelFilters.length > 0 || selectedMonth !== "all" || selectedYear !== "all" || tickerSearch.trim() !== "") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedSourceFilters([]);
                    setSelectedLabelFilters([]);
                    setSelectedMonth("all");
                    setSelectedYear("all");
                    setTickerSearch("");
                  }}
                  className="h-7 text-xs text-muted-foreground"
                  data-testid="clear-filters"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="active" data-testid="tab-active">
              <Crosshair className="w-4 h-4 mr-1" />
              Active ({filteredActive?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="closed" data-testid="tab-closed">
              <CheckCircle className="w-4 h-4 mr-1" />
              Closed ({filteredClosed?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="watching" data-testid="tab-watching">
              <Eye className="w-4 h-4 mr-1" />
              Watching ({watchlist.length})
            </TabsTrigger>
            <TabsTrigger value="considering" data-testid="tab-considering">
              Considering ({filteredConsidering?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="rules" data-testid="tab-rules">
              <BookOpen className="w-4 h-4 mr-1" />
              My Rules ({rules.length})
            </TabsTrigger>
            <TabsTrigger value="ai" data-testid="tab-ai">
              <Brain className="w-4 h-4 mr-1" />
              AI Insights
            </TabsTrigger>
            <TabsTrigger value="events" data-testid="tab-events">
              Events
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 ml-auto">
            <Label htmlFor="card-view-toggle" className="text-xs text-muted-foreground">View:</Label>
            <div className="flex bg-muted p-1 rounded-md h-8 items-center gap-1">
              <Button
                variant={!isExpanded ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setIsExpanded(false)}
              >
                <LayoutList className="h-3 w-3" />
                Collapsed
              </Button>
              <Button
                variant={isExpanded ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setIsExpanded(true)}
              >
                <LayoutGrid className="h-3 w-3" />
                Expanded
              </Button>
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsContent value="considering" className="space-y-4">
            {filteredConsidering?.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {selectedLabelFilters.length > 0 || selectedSourceFilters.length > 0
                    ? "No trades matching the selected filters."
                    : "No trades under consideration. Click \"New Evaluation\" to get started."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredConsidering?.map((trade) => (
                  <TradeCard 
                    key={trade.id} 
                    trade={trade} 
                    isActive={false}
                    onEdit={handleEditTrade}
                    onCancel={handleCancelTrade}
                    onPriceUpdate={handlePriceUpdate}
                    isExpanded={isExpanded}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="active" className="space-y-4">
            {filteredActive?.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {selectedLabelFilters.length > 0 || selectedSourceFilters.length > 0
                    ? "No active trades matching the selected filters."
                    : "No active trades. Commit a trade to start tracking it."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredActive?.map((trade) => (
                  <TradeCard 
                    key={trade.id} 
                    trade={trade} 
                    isActive={true}
                    onEdit={handleEditTrade}
                    onClose={handleCloseTrade}
                    onPriceUpdate={handlePriceUpdate}
                    onCancel={handleCancelTrade}
                    isExpanded={isExpanded}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="closed" className="space-y-4">
            {filteredClosed?.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {selectedLabelFilters.length > 0 || selectedSourceFilters.length > 0
                    ? "No closed trades matching the selected filters."
                    : "No closed trades yet. Complete some trades to see your history here."}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredClosed?.map((trade) => (
                  <TradeCard 
                    key={trade.id} 
                    trade={trade} 
                    isActive={false}
                    isClosed={true}
                    onEdit={handleEditTrade}
                    onPriceUpdate={handlePriceUpdate}
                    onCancel={handleCancelTrade}
                    isExpanded={isExpanded}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="watching" className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setShowAddWatchlist(true)} data-testid="button-add-watchlist">
                <Plus className="w-4 h-4 mr-2" />
                Add to Watchlist
              </Button>
            </div>
            {watchlist.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No stocks on your watchlist. Add setups you're monitoring for entry.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {watchlist.map((item) => (
                  <WatchlistCard key={item.id} item={item} onDelete={(id) => deleteWatchlistMutation.mutate(id)} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rules" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {[
                  { value: "all", label: "All" },
                  { value: "auto_reject", label: "Structural" },
                  { value: "entry", label: "Entry" },
                  { value: "exit", label: "Exit" },
                  { value: "profit_taking", label: "Profit" },
                  { value: "stop_loss", label: "Stop" },
                  { value: "position_sizing", label: "Sizing" },
                  { value: "ma_structure", label: "MA" },
                  { value: "base_quality", label: "Base" },
                  { value: "breakout", label: "Breakout" },
                  { value: "market_regime", label: "Regime" },
                ].map((cat) => (
                  <Button
                    key={cat.value}
                    size="sm"
                    variant={ruleFilter === cat.value ? "default" : "outline"}
                    onClick={() => setRuleFilter(cat.value)}
                    data-testid={`button-filter-${cat.value}`}
                    className="text-xs"
                  >
                    {cat.label}
                  </Button>
                ))}
              </div>
              <Button onClick={() => setShowAddRule(true)} data-testid="button-add-rule">
                <Plus className="w-4 h-4 mr-2" />
                Add Rule
              </Button>
            </div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  My Trading Rules
                  <Badge variant="outline" className="text-xs">{rules.length} rules</Badge>
                </CardTitle>
                <CardDescription>Define your rules. Track adherence. Build discipline.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {rules.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    No rules defined yet. Add your trading rules to track discipline.
                  </div>
                ) : (
                  <>
                    {rules
                      .filter((r) => ruleFilter === "all" || r.category === ruleFilter)
                      .map((rule) => (
                        <RuleItem
                          key={rule.id}
                          rule={rule}
                          onToggle={(id, isActive) => toggleRuleMutation.mutate({ id, isActive })}
                          onDelete={(id) => deleteRuleMutation.mutate(id)}
                        />
                      ))}
                    {rules.filter((r) => ruleFilter === "all" || r.category === ruleFilter).length === 0 && (
                      <div className="text-center text-muted-foreground py-4">
                        No rules in this category
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Your latest trade events and updates</CardDescription>
              </CardHeader>
              <CardContent>
                {dashboard?.recentEvents.length === 0 ? (
                  <div className="text-center text-muted-foreground py-4">
                    No recent events
                  </div>
                ) : (
                  <div className="space-y-1">
                    {dashboard?.recentEvents.map((event) => (
                      <EventItem key={event.id} event={event} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ai" className="space-y-4">
            {/* Trade Tagging for AI Learning */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-blue-500" />
                  Trade Tagging for AI Learning
                </CardTitle>
                <CardDescription>
                  Tag your closed trades with setup types to help Sentinel learn your trading patterns and improve its scoring.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Tagging Progress</span>
                    <span className="text-muted-foreground">
                      {taggingStats?.tagged || 0} / {taggingStats?.totalClosed || 0} trades tagged 
                      ({taggingStats?.taggedPercent || 0}%)
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${taggingStats?.taggedPercent || 0}%` }}
                    />
                  </div>
                </div>
                
                {/* Untagged trades queue */}
                {untaggedTrades.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-medium">Trades needing review ({untaggedTrades.length})</span>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={fetchBatchSuggestions}
                        disabled={batchTaggingLoading || untaggedTrades.length < 2}
                        data-testid="button-batch-tag-suggestions"
                      >
                        <Sparkles className="w-3 h-3 mr-1" />
                        {batchTaggingLoading ? "Analyzing..." : "AI Batch Tag"}
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {untaggedTrades.slice(0, 10).map((trade) => (
                        <div 
                          key={trade.id} 
                          className="flex items-center justify-between p-2 border rounded-lg hover-elevate cursor-pointer"
                          onClick={() => openTaggingDialog(trade)}
                          data-testid={`untagged-trade-${trade.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <Badge variant={trade.direction === "long" ? "default" : "destructive"}>
                              {trade.symbol}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {trade.entryDate ? new Date(trade.entryDate).toLocaleDateString() : "N/A"}
                            </span>
                            <span className={`text-sm font-medium ${
                              trade.actualPnL && trade.actualPnL > 0 ? "text-green-500" : 
                              trade.actualPnL && trade.actualPnL < 0 ? "text-red-500" : ""
                            }`}>
                              {trade.actualPnL ? `$${trade.actualPnL.toFixed(2)}` : ""}
                            </span>
                          </div>
                          <Button size="sm" variant="outline" data-testid={`button-tag-trade-${trade.id}`}>
                            Tag Trade
                          </Button>
                        </div>
                      ))}
                    </div>
                    {untaggedTrades.length > 10 && (
                      <p className="text-xs text-muted-foreground text-center">
                        And {untaggedTrades.length - 10} more...
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground">
                    <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500/50" />
                    <p className="font-medium">All trades tagged!</p>
                    <p className="text-sm">Your AI learning data is up to date.</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-500" />
                  AI-Suggested Rules
                </CardTitle>
                <CardDescription>
                  Rules learned from collective trading patterns across all users. Adopt rules that resonate with your style.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-end">
                  <Button 
                    onClick={() => analyzeRulesMutation.mutate()}
                    disabled={analyzeRulesMutation.isPending}
                    data-testid="button-analyze-rules"
                  >
                    <Brain className="w-4 h-4 mr-2" />
                    {analyzeRulesMutation.isPending ? "Analyzing..." : "Analyze Rule Patterns"}
                  </Button>
                </div>

                {suggestions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Lightbulb className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No AI suggestions yet</p>
                    <p className="text-sm mt-1">Keep trading and closing trades to generate rule performance data.</p>
                    <p className="text-sm mt-1">Click "Analyze Rule Patterns" to generate suggestions based on your trading history.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {suggestions.map((suggestion) => (
                      <div 
                        key={suggestion.id} 
                        className="border rounded-lg p-4 bg-purple-500/5 border-purple-500/20"
                        data-testid={`suggestion-${suggestion.id}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="font-medium">{suggestion.name}</span>
                              {suggestion.category && (
                                <Badge variant="outline" className="text-xs">{suggestion.category}</Badge>
                              )}
                              {suggestion.confidenceScore && (
                                <Badge className="bg-purple-500/20 text-purple-600 text-xs">
                                  {(suggestion.confidenceScore * 100).toFixed(0)}% confidence
                                </Badge>
                              )}
                              {suggestion.adoptionCount !== undefined && suggestion.adoptionCount > 0 && (
                                <Badge variant="secondary" className="text-xs">
                                  {suggestion.adoptionCount} adopted
                                </Badge>
                              )}
                            </div>
                            {suggestion.description && (
                              <p className="text-sm text-muted-foreground">{suggestion.description}</p>
                            )}
                            {suggestion.formula && (
                              <p className="text-xs font-mono bg-muted/50 px-2 py-1 rounded mt-2 inline-block">
                                {suggestion.formula}
                              </p>
                            )}
                            {suggestion.supportingData?.patternDescription && (
                              <p className="text-xs text-muted-foreground mt-2 italic">
                                Evidence: {suggestion.supportingData.patternDescription}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => adoptSuggestionMutation.mutate(suggestion.id)}
                              disabled={adoptSuggestionMutation.isPending}
                              data-testid={`button-adopt-${suggestion.id}`}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Adopt
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => dismissSuggestionMutation.mutate(suggestion.id)}
                              disabled={dismissSuggestionMutation.isPending}
                              data-testid={`button-dismiss-${suggestion.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* TNN Learning Insights */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-amber-500" />
                  Trader Neural Network (TNN) Insights
                </CardTitle>
                <CardDescription>
                  Performance metrics by setup type based on your tagged trades. The TNN learns from your trading history to personalize scoring.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {tnnPerformance.isLoading ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
                    Loading performance data...
                  </div>
                ) : tnnPerformance.data?.totalTagged === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="font-medium">No tagged trades yet</p>
                    <p className="text-sm">Tag your closed trades above to see performance insights.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total tagged trades analyzed:</span>
                      <span className="font-medium">{tnnPerformance.data?.totalTagged || 0}</span>
                    </div>
                    
                    {tnnPerformance.data?.bestSetup && (
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-green-500/5 border-green-500/20">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-green-500" />
                          <span className="text-sm">Best performing setup:</span>
                        </div>
                        <Badge variant="outline" className="border-green-500/50 text-green-500">
                          {tnnPerformance.data.bestSetup.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    )}
                    
                    {tnnPerformance.data?.worstSetup && (
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-red-500/5 border-red-500/20">
                        <div className="flex items-center gap-2">
                          <TrendingDown className="w-4 h-4 text-red-500" />
                          <span className="text-sm">Needs improvement:</span>
                        </div>
                        <Badge variant="outline" className="border-red-500/50 text-red-500">
                          {tnnPerformance.data.worstSetup.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    )}
                    
                    {/* Performance breakdown by setup type */}
                    {tnnPerformance.data?.performance && tnnPerformance.data.performance.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Performance by Setup Type</p>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {tnnPerformance.data.performance.map((perf) => (
                            <div key={perf.setupType} className="flex items-center justify-between p-2 border rounded text-sm">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{perf.setupType.replace(/_/g, ' ')}</span>
                                <span className="text-muted-foreground">({perf.totalTrades} trades)</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={perf.winRate >= 0.5 ? "text-green-500" : "text-red-500"}>
                                  {(perf.winRate * 100).toFixed(0)}% win
                                </span>
                                <Badge 
                                  variant="outline" 
                                  className={
                                    perf.recentTrend === "improving" ? "border-green-500/50 text-green-500" :
                                    perf.recentTrend === "declining" ? "border-red-500/50 text-red-500" :
                                    "border-muted-foreground/50"
                                  }
                                >
                                  {perf.recentTrend === "improving" ? "Improving" : 
                                   perf.recentTrend === "declining" ? "Declining" : "Stable"}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Admin: Generate TNN suggestions */}
                    {currentUser?.isAdmin && (
                      <div className="pt-4 border-t">
                        <Button 
                          onClick={() => generateTnnSuggestionsMutation.mutate()}
                          disabled={generateTnnSuggestionsMutation.isPending}
                          variant="outline"
                          className="w-full"
                          data-testid="button-generate-tnn-suggestions"
                        >
                          <Brain className="w-4 h-4 mr-2" />
                          {generateTnnSuggestionsMutation.isPending ? "Generating..." : "Generate TNN Weight Suggestions"}
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                          Admin only: Analyzes all tagged trades to suggest TNN weight adjustments
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How AI Learning Works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p><strong>1. Trade & Track:</strong> As you close trades and record rule adherence, we track which rules correlate with wins.</p>
                <p><strong>2. Collective Patterns:</strong> Anonymized data from all users reveals which rules most reliably predict success.</p>
                <p><strong>3. AI Suggestions:</strong> Our AI analyzes patterns and suggests new rules with high win-rate correlation.</p>
                <p><strong>4. You Decide:</strong> Review suggestions and adopt the ones that fit your trading style.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground"
            data-testid="link-scanner"
          >
            Go to AI Swing Scanner
          </a>
        </div>
      </main>

      {/* Add to Watchlist Dialog */}
      <Dialog open={showAddWatchlist} onOpenChange={setShowAddWatchlist}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Watchlist</DialogTitle>
            <DialogDescription>Add a setup you're monitoring for entry</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="watchlist-symbol">Symbol</Label>
              <Input
                id="watchlist-symbol"
                placeholder="AAPL"
                value={watchlistForm.symbol}
                onChange={(e) => setWatchlistForm({ ...watchlistForm, symbol: e.target.value.toUpperCase() })}
                data-testid="input-watchlist-symbol"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="watchlist-entry">Target Entry Price</Label>
              <Input
                id="watchlist-entry"
                type="number"
                step="0.01"
                placeholder="150.00"
                value={watchlistForm.targetEntry}
                onChange={(e) => setWatchlistForm({ ...watchlistForm, targetEntry: e.target.value })}
                data-testid="input-watchlist-entry"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="watchlist-priority">Priority</Label>
              <Select value={watchlistForm.priority} onValueChange={(v) => setWatchlistForm({ ...watchlistForm, priority: v })}>
                <SelectTrigger data-testid="select-watchlist-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="watchlist-thesis">Thesis / Notes</Label>
              <Textarea
                id="watchlist-thesis"
                placeholder="Why are you watching this setup?"
                value={watchlistForm.thesis}
                onChange={(e) => setWatchlistForm({ ...watchlistForm, thesis: e.target.value })}
                data-testid="input-watchlist-thesis"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddWatchlist(false)}>Cancel</Button>
            <Button onClick={handleAddWatchlist} disabled={!watchlistForm.symbol || addWatchlistMutation.isPending} data-testid="button-confirm-add-watchlist">
              {addWatchlistMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Trade Directly Dialog */}
      <Dialog open={showAddTrade} onOpenChange={setShowAddTrade}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Trade</DialogTitle>
            <DialogDescription>Add a trade directly without IVY evaluation</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-trade-symbol">Symbol <span className="text-red-500">*</span></Label>
                <Input
                  id="add-trade-symbol"
                  placeholder="AAPL"
                  value={addTradeForm.symbol}
                  onChange={(e) => setAddTradeForm({ ...addTradeForm, symbol: e.target.value.toUpperCase() })}
                  data-testid="input-add-trade-symbol"
                />
              </div>
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select value={addTradeForm.direction} onValueChange={(v: "long" | "short") => setAddTradeForm({ ...addTradeForm, direction: v })}>
                  <SelectTrigger data-testid="select-add-trade-direction">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-4 h-4 text-green-500" /> Long
                      </span>
                    </SelectItem>
                    <SelectItem value="short">
                      <span className="flex items-center gap-1">
                        <TrendingDown className="w-4 h-4 text-red-500" /> Short
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Account selector - only shown if user has accounts configured */}
            {accountSettings.length > 0 && (
              <div className="space-y-2">
                <Label>Trading Account</Label>
                <Select 
                  value={addTradeForm.accountName || ""} 
                  onValueChange={(v) => setAddTradeForm({ ...addTradeForm, accountName: v })}
                >
                  <SelectTrigger data-testid="select-add-trade-account">
                    <SelectValue placeholder="Select account (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No account</SelectItem>
                    {accountSettings.map((account) => (
                      <SelectItem key={account.id} value={account.accountName}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{account.accountName}</span>
                          <span className="text-muted-foreground text-xs">{account.brokerId}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-trade-entry">Entry Price <span className="text-red-500">*</span></Label>
                <Input
                  id="add-trade-entry"
                  type="number"
                  step="0.01"
                  placeholder="150.00"
                  value={addTradeForm.entryPrice}
                  onChange={(e) => setAddTradeForm({ ...addTradeForm, entryPrice: e.target.value })}
                  data-testid="input-add-trade-entry"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-trade-size">Position Size (shares)</Label>
                <Input
                  id="add-trade-size"
                  type="number"
                  placeholder="100"
                  value={addTradeForm.positionSize}
                  onChange={(e) => setAddTradeForm({ ...addTradeForm, positionSize: e.target.value })}
                  data-testid="input-add-trade-size"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-trade-stop">Stop Price</Label>
                <Input
                  id="add-trade-stop"
                  type="number"
                  step="0.01"
                  placeholder="145.00"
                  value={addTradeForm.stopPrice}
                  onChange={(e) => setAddTradeForm({ ...addTradeForm, stopPrice: e.target.value })}
                  data-testid="input-add-trade-stop"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-trade-target">Target Price</Label>
                <Input
                  id="add-trade-target"
                  type="number"
                  step="0.01"
                  placeholder="165.00"
                  value={addTradeForm.targetPrice}
                  onChange={(e) => setAddTradeForm({ ...addTradeForm, targetPrice: e.target.value })}
                  data-testid="input-add-trade-target"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="add-trade-date">Trade Date</Label>
                <Input
                  id="add-trade-date"
                  type="date"
                  value={addTradeForm.tradeDate}
                  onChange={(e) => setAddTradeForm({ ...addTradeForm, tradeDate: e.target.value })}
                  data-testid="input-add-trade-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-trade-time">Trade Time</Label>
                <Input
                  id="add-trade-time"
                  type="time"
                  value={addTradeForm.tradeTime}
                  onChange={(e) => setAddTradeForm({ ...addTradeForm, tradeTime: e.target.value })}
                  data-testid="input-add-trade-time"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={addTradeForm.status} onValueChange={(v: "considering" | "active") => setAddTradeForm({ ...addTradeForm, status: v })}>
                <SelectTrigger data-testid="select-add-trade-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active (Trade Committed)</SelectItem>
                  <SelectItem value="considering">Considering (Planning)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-trade-thesis">Thesis / Notes</Label>
              <Textarea
                id="add-trade-thesis"
                placeholder="Why are you taking this trade?"
                value={addTradeForm.thesis}
                onChange={(e) => setAddTradeForm({ ...addTradeForm, thesis: e.target.value })}
                data-testid="input-add-trade-thesis"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTrade(false)}>Cancel</Button>
            <Button 
              onClick={handleAddTrade} 
              disabled={!addTradeForm.symbol || !addTradeForm.entryPrice || createTradeMutation.isPending} 
              data-testid="button-confirm-add-trade"
            >
              {createTradeMutation.isPending ? "Adding..." : "Add Trade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Rule Dialog */}
      <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Trading Rule</DialogTitle>
            <DialogDescription>Define a rule to track your discipline. Rules must have at least one direction (Long/Short).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {/* Rule Name */}
            <div className="space-y-2">
              <Label htmlFor="rule-name">Rule <span className="text-red-500">*</span></Label>
              <Input
                id="rule-name"
                placeholder="e.g., Wait for pullback to 21 EMA"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                data-testid="input-rule-name"
              />
            </div>

            {/* Rule Type */}
            <div className="space-y-2">
              <Label>Rule Type <span className="text-red-500">*</span></Label>
              <Select value={ruleForm.ruleType} onValueChange={(v: "swing" | "intraday" | "long_term" | "other") => setRuleForm({ ...ruleForm, ruleType: v })}>
                <SelectTrigger data-testid="select-rule-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="swing">Swing Trade</SelectItem>
                  <SelectItem value="intraday">Intraday</SelectItem>
                  <SelectItem value="long_term">Long Term</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Direction Tags - Required */}
            <div className="space-y-2">
              <Label>Direction <span className="text-red-500">*</span> <span className="text-xs text-muted-foreground">(at least one required)</span></Label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ruleForm.directionTags.includes("long")}
                    onChange={() => handleDirectionToggle("long")}
                    className="w-4 h-4 rounded border-gray-300"
                    data-testid="checkbox-direction-long"
                  />
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    Long
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ruleForm.directionTags.includes("short")}
                    onChange={() => handleDirectionToggle("short")}
                    className="w-4 h-4 rounded border-gray-300"
                    data-testid="checkbox-direction-short"
                  />
                  <span className="flex items-center gap-1">
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    Short
                  </span>
                </label>
              </div>
              {ruleForm.directionTags.length === 0 && (
                <p className="text-xs text-red-500">Select at least one direction</p>
              )}
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="rule-category">Category <span className="text-red-500">*</span></Label>
              <Select value={ruleForm.category} onValueChange={(v) => setRuleForm({ ...ruleForm, category: v })}>
                <SelectTrigger data-testid="select-rule-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto_reject">Structural (Plan Requirement)</SelectItem>
                  <SelectItem value="entry">Entry Timing</SelectItem>
                  <SelectItem value="exit">Exit / Profit Taking</SelectItem>
                  <SelectItem value="stop_loss">Stop Loss</SelectItem>
                  <SelectItem value="profit_taking">Profit Taking</SelectItem>
                  <SelectItem value="risk">Risk Management</SelectItem>
                  <SelectItem value="position_sizing">Position Sizing</SelectItem>
                  <SelectItem value="ma_structure">MA Structure</SelectItem>
                  <SelectItem value="base_quality">Base / Pattern Quality</SelectItem>
                  <SelectItem value="breakout">Breakout</SelectItem>
                  <SelectItem value="market_regime">Market Regime</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="rule-description">Brief Description <span className="text-red-500">*</span></Label>
              <Textarea
                id="rule-description"
                placeholder="Why do you use this rule? What problem does it solve?"
                value={ruleForm.description}
                onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                className="min-h-[80px]"
                data-testid="input-rule-description"
              />
            </div>

            {/* Strategy Tags */}
            <div className="space-y-2">
              <Label>Strategy Tags <span className="text-xs text-muted-foreground">(optional, max 20 chars each)</span></Label>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g., breakout, momentum"
                  value={strategyTagInput}
                  onChange={(e) => setStrategyTagInput(e.target.value.slice(0, 20))}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddStrategyTag())}
                  className="flex-1"
                  data-testid="input-strategy-tag"
                />
                <Button type="button" variant="outline" size="sm" onClick={handleAddStrategyTag} disabled={!strategyTagInput.trim()}>
                  Add
                </Button>
              </div>
              {ruleForm.strategyTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {ruleForm.strategyTags.map(tag => (
                    <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                      {tag}
                      <button onClick={() => handleRemoveStrategyTag(tag)} className="hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Admin: Global option */}
            {user?.isAdmin && (
              <div className="space-y-2 border-t pt-4">
                <Label className="text-amber-500">Admin Options</Label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ruleForm.isGlobal}
                    onChange={(e) => setRuleForm({ ...ruleForm, isGlobal: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300"
                    data-testid="checkbox-global-rule"
                  />
                  <span className="text-sm">Make this rule Global (visible to all users)</span>
                </label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRule(false)}>Cancel</Button>
            <Button 
              onClick={handleAddRule} 
              disabled={!ruleForm.name || !ruleForm.description || ruleForm.directionTags.length === 0 || addRuleMutation.isPending} 
              data-testid="button-confirm-add-rule"
            >
              {addRuleMutation.isPending ? "Adding..." : (ruleForm.isGlobal ? "Add Global Rule" : "Add Rule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Trade Dialog - V2 Order Grid with BUY/SELL */}
      <Dialog open={showEditTrade} onOpenChange={setShowEditTrade}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Trade: {selectedTrade?.symbol}</DialogTitle>
            <DialogDescription>Update order entries - Running total must be zero to close trade</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* V2 Order Grid Table with FIFO Tracking */}
            {(() => {
              const fifoResult = calculateFifoTracking(lotEntries);
              return (
                <>
                  <div className="border rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Transaction Date/Time</th>
                          <th className="px-3 py-2 text-left font-medium">QTY</th>
                          <th className="px-3 py-2 text-left font-medium">BUY/SELL</th>
                          <th className="px-3 py-2 text-left font-medium">Cost Basis / Sell Price</th>
                          <th className="px-3 py-2 text-left font-medium">Lot Remaining</th>
                          <th className="px-3 py-2 text-left font-medium">Profit</th>
                          <th className="px-3 py-2 text-left font-medium">Running Total</th>
                          <th className="px-2 py-2 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lotEntries.map((lot, index) => {
                          // Calculate running total up to this row
                          const runningTotalAtRow = lotEntries.slice(0, index + 1).reduce((total, entry) => {
                            const qty = parseInt(entry.qty) || 0;
                            return entry.buySell === "buy" ? total + qty : total - qty;
                          }, 0);
                          
                          // Get FIFO lot info for buy lots
                          const fifoLot = fifoResult.buyLots.find(l => l.lotId === lot.id);
                          const fifoSell = fifoResult.sells.find(s => s.sellId === lot.id);
                          
                          return (
                            <tr key={lot.id} className={`border-t ${fifoLot?.depleted ? 'opacity-50' : ''}`}>
                              <td className="px-2 py-1">
                                <Input
                                  type="datetime-local"
                                  value={lot.dateTime}
                                  onChange={(e) => updateLotEntry(lot.id, "dateTime", e.target.value)}
                                  className="h-8 text-xs"
                                  data-testid={`input-lot-datetime-${index}`}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Input
                                  type="number"
                                  placeholder="100"
                                  value={lot.qty}
                                  onChange={(e) => updateLotEntry(lot.id, "qty", e.target.value)}
                                  className="h-8 w-20 text-xs"
                                  data-testid={`input-lot-qty-${index}`}
                                />
                              </td>
                              <td className="px-2 py-1">
                                <Select
                                  value={lot.buySell}
                                  onValueChange={(value) => updateLotEntry(lot.id, "buySell", value)}
                                >
                                  <SelectTrigger className="h-8 w-20 text-xs" data-testid={`select-lot-buysell-${index}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="buy">BUY</SelectItem>
                                    <SelectItem value="sell">SELL</SelectItem>
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-2 py-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={lot.price}
                                  onChange={(e) => updateLotEntry(lot.id, "price", e.target.value)}
                                  className="h-8 w-24 text-xs"
                                  data-testid={`input-lot-price-${index}`}
                                />
                              </td>
                              <td className="px-2 py-1">
                                {lot.buySell === 'buy' && fifoLot ? (
                                  <span className={`font-mono text-xs font-medium ${
                                    fifoLot.depleted ? 'text-gray-400 line-through' : 
                                    fifoLot.remainingQty < fifoLot.originalQty ? 'text-orange-400' : 'text-blue-400'
                                  }`}>
                                    {fifoLot.depleted ? 'CLOSED' : `${fifoLot.remainingQty}/${fifoLot.originalQty}`}
                                  </span>
                                ) : lot.buySell === 'sell' && fifoSell ? (
                                  <span className="font-mono text-xs text-red-400">
                                    -{fifoSell.qty}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                {/* Profit column: For sells, calculate (sellPrice - buyLotCost) × qty for each matched lot */}
                                {lot.buySell === 'sell' && fifoSell && fifoSell.depletedFrom.length > 0 ? (
                                  (() => {
                                    // Calculate profit for this sell by summing P&L from each matched buy lot
                                    const sellPrice = parseFloat(lot.price) || 0;
                                    let sellProfit = 0;
                                    fifoSell.depletedFrom.forEach(match => {
                                      const buyLot = fifoResult.buyLots.find(b => b.lotId === match.lotId);
                                      if (buyLot) {
                                        sellProfit += (sellPrice - buyLot.price) * match.qtyTaken;
                                      }
                                    });
                                    const isPositive = sellProfit >= 0;
                                    return (
                                      <span className={`font-mono text-xs font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                                        {isPositive ? '+' : ''}${sellProfit.toFixed(2)}
                                      </span>
                                    );
                                  })()
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                <span className={`font-mono text-xs font-medium ${
                                  runningTotalAtRow === 0 ? "text-green-500" : 
                                  runningTotalAtRow > 0 ? "text-blue-500" : "text-orange-500"
                                }`}>
                                  {runningTotalAtRow > 0 ? `+${runningTotalAtRow}` : 
                                   runningTotalAtRow < 0 ? `${runningTotalAtRow}` : "0"}
                                </span>
                              </td>
                              <td className="px-1 py-1 flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-red-500 hover:text-red-600"
                                  onClick={() => removeLotEntry(lot.id)}
                                  data-testid={`button-remove-lot-${index}`}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-green-500 hover:text-green-600"
                                  onClick={addLotEntry}
                                  data-testid={`button-add-row-${index}`}
                                >
                                  <Check className="w-3 h-3" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Enhanced Final Position Display with FIFO */}
                  <div className="border rounded-md bg-yellow-500/10 border-yellow-500/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-yellow-500">Final Position</div>
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-lg font-bold text-foreground">
                            Total Shares: {fifoResult.totalRemaining} {fifoResult.direction}
                          </span>
                          {fifoResult.totalRemaining > 0 && fifoResult.avgCostBasis > 0 && (
                            <span className="font-mono text-sm text-muted-foreground">
                              Avg Cost Basis: ${fifoResult.avgCostBasis.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                      {fifoResult.totalRemaining !== 0 && (
                        <span className="text-xs text-yellow-500">
                          ⚠️ Buys and sells must balance to close trade
                        </span>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowEditTrade(false)}>Cancel</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button 
                    size="sm" 
                    onClick={confirmEditTrade} 
                    disabled={updateTradeMutation.isPending || (selectedTrade?.status === "closed" && !canCloseTrade)} 
                    data-testid="button-confirm-edit"
                  >
                    {updateTradeMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </span>
              </TooltipTrigger>
              {selectedTrade?.status === "closed" && !canCloseTrade && (
                <TooltipContent>
                  <p>Running total must be zero to close trade</p>
                </TooltipContent>
              )}
            </Tooltip>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Trade Confirmation Dialog */}
      <Dialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Close Trade: {selectedTrade?.symbol}</DialogTitle>
            <DialogDescription>
              Would you like to edit final details before closing?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={handleCloseConfirmNo} data-testid="button-close-no-edit">
              No, Close Now
            </Button>
            <Button onClick={handleCloseConfirmYes} data-testid="button-close-edit-first">
              Yes, Edit First
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Trade Dialog */}
      <Dialog open={showCloseTrade} onOpenChange={setShowCloseTrade}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Close Trade: {selectedTrade?.symbol}</DialogTitle>
            <DialogDescription>Record the exit price and outcome</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="exit-price">Exit Price ($)</Label>
              <Input
                id="exit-price"
                type="number"
                step="0.01"
                value={closeForm.exitPrice}
                onChange={(e) => setCloseForm({ ...closeForm, exitPrice: e.target.value })}
                data-testid="input-exit-price"
              />
            </div>
            <div className="space-y-2">
              <Label>Outcome</Label>
              <Select value={closeForm.outcome} onValueChange={(v) => setCloseForm({ ...closeForm, outcome: v as typeof closeForm.outcome })}>
                <SelectTrigger data-testid="select-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="win">Win</SelectItem>
                  <SelectItem value="loss">Loss</SelectItem>
                  <SelectItem value="breakeven">Breakeven</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="close-notes">Notes (optional)</Label>
              <Textarea
                id="close-notes"
                placeholder="What did you learn from this trade?"
                value={closeForm.notes}
                onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })}
                data-testid="input-close-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseTrade(false)}>Cancel</Button>
            <Button onClick={confirmCloseTrade} disabled={!closeForm.exitPrice || closeTradeMutation.isPending} data-testid="button-confirm-close">
              {closeTradeMutation.isPending ? "Closing..." : "Close Trade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel/Delete Trade Confirmation */}
      <Dialog open={showCancelTrade} onOpenChange={setShowCancelTrade}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Trade</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the {selectedTrade?.symbol} trade? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelTrade(false)}>Keep Trade</Button>
            <Button variant="destructive" onClick={confirmDeleteTrade} disabled={deleteTradeMutation.isPending} data-testid="button-confirm-delete">
              {deleteTradeMutation.isPending ? "Deleting..." : "Delete Trade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete by Source Dialog */}
      <Dialog open={showDeleteBySource} onOpenChange={setShowDeleteBySource}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete Trades by Source
            </DialogTitle>
            <DialogDescription>
              Delete trades from a specific source. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Source</Label>
              <Select
                value={deleteSourceForm.sourceId}
                onValueChange={(v) => setDeleteSourceForm({ ...deleteSourceForm, sourceId: v })}
              >
                <SelectTrigger data-testid="delete-source-select">
                  <SelectValue placeholder="Select a source..." />
                </SelectTrigger>
                <SelectContent>
                  {tradeSources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name} ({source.count} trades)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="delete-date-from">From Date (optional)</Label>
                <Input
                  id="delete-date-from"
                  type="date"
                  value={deleteSourceForm.dateFrom}
                  onChange={(e) => setDeleteSourceForm({ ...deleteSourceForm, dateFrom: e.target.value })}
                  data-testid="delete-date-from"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delete-date-to">To Date (optional)</Label>
                <Input
                  id="delete-date-to"
                  type="date"
                  value={deleteSourceForm.dateTo}
                  onChange={(e) => setDeleteSourceForm({ ...deleteSourceForm, dateTo: e.target.value })}
                  data-testid="delete-date-to"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">Type "DELETE" to confirm</Label>
              <Input
                id="delete-confirm"
                placeholder="DELETE"
                value={deleteSourceForm.confirmText}
                onChange={(e) => setDeleteSourceForm({ ...deleteSourceForm, confirmText: e.target.value })}
                data-testid="delete-confirm-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteBySource(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteBySourceMutation.mutate({
                sourceId: deleteSourceForm.sourceId,
                dateFrom: deleteSourceForm.dateFrom || undefined,
                dateTo: deleteSourceForm.dateTo || undefined,
                confirmDelete: deleteSourceForm.confirmText,
              })}
              disabled={
                !deleteSourceForm.sourceId ||
                deleteSourceForm.confirmText !== "DELETE" ||
                deleteBySourceMutation.isPending
              }
              data-testid="button-confirm-delete-source"
            >
              {deleteBySourceMutation.isPending ? "Deleting..." : "Delete Trades"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Trade Tagging Dialog */}
      <Dialog open={showTaggingDialog} onOpenChange={setShowTaggingDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" />
              Tag Trade for AI Learning
            </DialogTitle>
            <DialogDescription>
              Help Sentinel learn from this trade by tagging it with the setup type and outcome.
            </DialogDescription>
          </DialogHeader>
          
          {taggingTrade && (
            <div className="space-y-4">
              {/* Trade Summary */}
              <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={taggingTrade.direction === "long" ? "default" : "destructive"}>
                    {taggingTrade.direction.toUpperCase()}
                  </Badge>
                  <span className="font-semibold">{taggingTrade.symbol}</span>
                  <span className="text-muted-foreground text-sm">@ ${taggingTrade.entryPrice}</span>
                </div>
                
                {taggingAnalysis && (
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Hold Time:</span>
                      <span className="ml-1 font-medium">
                        {taggingAnalysis.holdDays !== null ? `${taggingAnalysis.holdDays} days` : "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">P&L:</span>
                      <span className={`ml-1 font-medium ${
                        taggingAnalysis.calculatedPnL > 0 ? "text-green-500" : 
                        taggingAnalysis.calculatedPnL < 0 ? "text-red-500" : ""
                      }`}>
                        ${taggingAnalysis.calculatedPnL.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Detected:</span>
                      <span className={`ml-1 font-medium ${
                        taggingAnalysis.outcome === "win" ? "text-green-500" : 
                        taggingAnalysis.outcome === "loss" ? "text-red-500" : ""
                      }`}>
                        {taggingAnalysis.outcome}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Setup Type */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Setup Type</Label>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={getAISetupSuggestion}
                    disabled={suggestingSetup}
                    data-testid="button-ai-suggest-setup"
                  >
                    <Brain className="w-4 h-4 mr-1" />
                    {suggestingSetup ? "Suggesting..." : "AI Suggest"}
                  </Button>
                </div>
                <Select
                  value={taggingForm.setupType}
                  onValueChange={(v) => setTaggingForm({ ...taggingForm, setupType: v })}
                >
                  <SelectTrigger data-testid="select-setup-type">
                    <SelectValue placeholder="Select setup type..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="breakout">Breakout</SelectItem>
                    <SelectItem value="pullback">Pullback</SelectItem>
                    <SelectItem value="cup_and_handle">Cup and Handle</SelectItem>
                    <SelectItem value="vcp">VCP (Volatility Contraction Pattern)</SelectItem>
                    <SelectItem value="high_tight_flag">High Tight Flag</SelectItem>
                    <SelectItem value="double_bottom">Double Bottom</SelectItem>
                    <SelectItem value="ascending_base">Ascending Base</SelectItem>
                    <SelectItem value="bounce">Bounce / Support</SelectItem>
                    <SelectItem value="momentum">Momentum / Day Trade</SelectItem>
                    <SelectItem value="gap_and_go">Gap and Go</SelectItem>
                    <SelectItem value="earnings_play">Earnings Play</SelectItem>
                    <SelectItem value="sector_rotation">Sector Rotation</SelectItem>
                    <SelectItem value="swing_trade">Swing Trade (General)</SelectItem>
                    <SelectItem value="position_trade">Position Trade (Long Hold)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Outcome Override */}
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select
                  value={taggingForm.outcome}
                  onValueChange={(v) => setTaggingForm({ ...taggingForm, outcome: v as any })}
                >
                  <SelectTrigger data-testid="select-outcome">
                    <SelectValue placeholder="Confirm or override outcome..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="win">Win</SelectItem>
                    <SelectItem value="loss">Loss</SelectItem>
                    <SelectItem value="breakeven">Breakeven</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Notes */}
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  value={taggingForm.notes}
                  onChange={(e) => setTaggingForm({ ...taggingForm, notes: e.target.value })}
                  placeholder="What did you learn from this trade?"
                  className="resize-none"
                  rows={3}
                  data-testid="input-tagging-notes"
                />
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTaggingDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => taggingTrade && tagTradeMutation.mutate({
                tradeId: taggingTrade.id,
                setupType: taggingForm.setupType,
                outcome: taggingForm.outcome || undefined,
                notes: taggingForm.notes || undefined
              })}
              disabled={!taggingForm.setupType || tagTradeMutation.isPending}
              data-testid="button-save-tag"
            >
              {tagTradeMutation.isPending ? "Saving..." : "Save Tag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Batch Tagging Dialog */}
      <Dialog open={showBatchTagDialog} onOpenChange={setShowBatchTagDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              AI Batch Tagging Suggestions
            </DialogTitle>
            <DialogDescription>
              AI has analyzed your untagged trades and grouped similar patterns. 
              Apply suggested tags to multiple trades at once.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {batchSuggestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No pattern suggestions available.</p>
                <p className="text-sm">Try tagging trades individually for more diverse data.</p>
              </div>
            ) : (
              batchSuggestions.map((group) => (
                <div 
                  key={group.groupKey}
                  className="border rounded-lg p-4 space-y-3"
                  data-testid={`batch-tag-group-${group.groupKey}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={group.direction === "long" ? "default" : "destructive"}>
                          {group.symbol}
                        </Badge>
                        <Badge variant="outline">
                          {group.tradeCount} trades
                        </Badge>
                        {group.suggestedSetupType && (
                          <Badge variant="secondary" className="bg-purple-500/10 text-purple-600">
                            {group.suggestedSetupType.replace(/_/g, ' ')}
                          </Badge>
                        )}
                        {group.confidence && (
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            group.confidence === 'high' ? 'bg-green-500/10 text-green-600' :
                            group.confidence === 'medium' ? 'bg-yellow-500/10 text-yellow-600' :
                            'bg-gray-500/10 text-gray-500'
                          }`}>
                            {group.confidence} confidence
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        {group.reasoning}
                      </p>
                    </div>
                    
                    {group.suggestedSetupType && (
                      <Button
                        size="sm"
                        onClick={() => applyBatchTag(group)}
                        disabled={batchTagMutation.isPending}
                        data-testid={`button-apply-batch-${group.groupKey}`}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Apply
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatchTagDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
