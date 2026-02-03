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
import { Plus, LogOut, TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle, Eye, Crosshair, BookOpen, X, DollarSign, Brain, Sparkles, Lightbulb, ChevronRight, MoreHorizontal, Trash2, Edit3, XCircle, Check, Target, CircleDot } from "lucide-react";
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
  targetPrice?: number;
  exitPrice?: number;
  positionSize?: number;
  status: string;
  createdAt: string;
  labels?: TradeLabel[];
  lotEntries?: LotEntry[]; // Order grid lot entries for FIFO tracking
  latestEvaluation?: {
    score: number;
    recommendation: string;
    riskFlags: string[];
  };
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
  
  // Second pass: apply sells using FIFO
  sortedEntries.forEach(entry => {
    if (entry.buySell === 'sell') {
      let remainingToSell = parseInt(entry.qty) || 0;
      const sellInfo: FifoSellInfo = {
        sellId: entry.id,
        qty: remainingToSell,
        price: parseFloat(entry.price) || 0,
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
  
  return {
    buyLots,
    sells,
    totalRemaining,
    avgCostBasis,
    direction: totalRemaining > 0 ? 'LONG' : totalRemaining < 0 ? 'SHORT' : 'FLAT',
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
  alertColor?: "red" | "green" | "yellow";
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
  
  const alertBg = alertColor === "red" ? "bg-red-500/10" : alertColor === "green" ? "bg-green-500/10" : "bg-yellow-500/10";
  const alertText = alertColor === "red" ? "text-red-500" : alertColor === "green" ? "text-green-500" : "text-yellow-500";
  
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
}

function TickerWidget({ symbol, price, pctChange = 0, direction, status }: TickerWidgetProps) {
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
    <div className="flex items-center gap-2" data-testid={`ticker-widget-${symbol}`}>
      {/* Ticker Box with sparkline */}
      <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1.5 border" data-testid={`ticker-box-${symbol}`}>
        <span className="font-bold text-sm" data-testid={`text-ticker-${symbol}`}>{symbol}</span>
        <MiniSparkline positive={isPositive} />
        <span className="text-sm font-medium" data-testid={`text-price-${symbol}`}>${price.toFixed(2)}</span>
        <span className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-red-500"}`} data-testid={`text-pct-${symbol}`}>
          {isPositive ? "+" : ""}{pctChange.toFixed(1)}%
        </span>
      </div>
      {/* Direction/Status Badge */}
      <Badge className={`${statusColor} text-xs`} data-testid={`badge-status-${symbol}`}>
        {statusLabel}
      </Badge>
    </div>
  );
}

interface TradeCardProps {
  trade: TradeWithEvaluation;
  isActive?: boolean;
  onEdit?: (trade: TradeWithEvaluation) => void;
  onClose?: (trade: TradeWithEvaluation) => void;
  onCancel?: (trade: TradeWithEvaluation) => void;
  onPriceUpdate?: (tradeId: number, field: "stopPrice" | "targetPrice", value: number) => void;
}

function TradeCard({ trade, isActive = false, onEdit, onClose, onCancel, onPriceUpdate }: TradeCardProps) {
  const [, setLocation] = useLocation();
  
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

  // Calculate a pseudo % change based on entry vs target (for sparkline direction)
  const pctChange = trade.targetPrice && trade.entryPrice 
    ? ((trade.targetPrice - trade.entryPrice) / trade.entryPrice * 100) 
    : (trade.direction === "long" ? 2.5 : -2.5);

  // Price monitoring calculations - use current price (entry for now, could be live)
  const currentPrice = trade.entryPrice; // In production, this would be live price
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

  // Alert conditions - within 5% of goal
  const nearStop = stopDistance !== null && Math.abs(stopDistance) <= 5;
  const nearTarget = targetDistance !== null && Math.abs(targetDistance) <= 5;

  return (
    <Card 
      className={`cursor-pointer relative overflow-hidden ${nearStop ? "ring-2 ring-red-500" : nearTarget ? "ring-2 ring-green-500" : ""}`}
      data-testid={`card-trade-${trade.id}`}
      onClick={handleCardClick}
    >
      <CardContent className="p-4 pb-10 relative">
        {/* Alert banners */}
        {nearTarget && (
          <div className="absolute top-0 left-0 right-0 bg-green-500/20 text-green-500 text-xs text-center py-1 font-medium rounded-t-md flex items-center justify-center gap-1" data-testid={`alert-target-${trade.id}`}>
            <Target className="w-3 h-3" /> NEAR PROFIT TARGET!
          </div>
        )}
        {nearStop && (
          <div className="absolute top-0 left-0 right-0 bg-red-500/20 text-red-500 text-xs text-center py-1 font-medium rounded-t-md flex items-center justify-center gap-1" data-testid={`alert-stop-${trade.id}`}>
            <AlertTriangle className="w-3 h-3" /> NEAR STOP LOSS!
          </div>
        )}

        {/* Compact Ticker Widget with Sparkline */}
        <div className={`flex items-center justify-between mb-3 ${nearTarget || nearStop ? "mt-4" : ""}`}>
          <TickerWidget 
            symbol={trade.symbol}
            price={trade.entryPrice}
            pctChange={pctChange}
            direction={trade.direction}
            status={isActive ? "active" : "considering"}
          />
          {trade.latestEvaluation && (
            <Badge variant={getScoreBadgeVariant(trade.latestEvaluation.score)} data-testid={`badge-score-${trade.id}`}>
              {trade.latestEvaluation.score}/100
            </Badge>
          )}
        </div>

        {/* Display labels with tooltips */}
        {trade.labels && trade.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
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
          </div>
        )}

        {/* Price Monitoring: Stop, Partial Profit, Profit Target with % distance - Always visible with click-to-edit */}
        <div className="text-xs space-y-1.5 mb-2">
          {/* Stop Loss - Always shown */}
          <EditablePriceRow
            label="STOP"
            icon={XCircle}
            value={trade.stopPrice}
            distance={stopDistance}
            isAlert={nearStop}
            alertColor="red"
            onSave={(value) => onPriceUpdate?.(trade.id, "stopPrice", value)}
            testId={`monitor-stop-${trade.id}`}
          />
          
          {/* Partial Profit (calculated from stop and target) - Display only, not editable */}
          {partialProfitPrice && partialDistance !== null && (
            <div className="flex items-center justify-between px-2 py-1 rounded bg-muted/30" data-testid={`monitor-partial-${trade.id}`}>
              <div className="flex items-center gap-1.5">
                <CircleDot className="w-3 h-3 text-yellow-500" />
                <span className="text-muted-foreground">PARTIAL</span>
                <span className="text-muted-foreground">${partialProfitPrice.toFixed(2)}</span>
              </div>
              <span className="font-mono text-muted-foreground">
                {partialDistance > 0 ? "+" : ""}{partialDistance.toFixed(1)}%
              </span>
            </div>
          )}
          
          {/* Profit Target - Always shown */}
          <EditablePriceRow
            label="TARGET"
            icon={Target}
            value={trade.targetPrice}
            distance={targetDistance}
            isAlert={nearTarget}
            alertColor="green"
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

        {/* Green arrow action menu at bottom right */}
        <div className="absolute bottom-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="text-green-500"
                data-testid={`button-trade-menu-${trade.id}`}
                onClick={(e) => e.stopPropagation()}
              >
                <ChevronRight className="w-5 h-5" />
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
  const [activeTab, setActiveTab] = useState("active");
  const { toast } = useToast();

  // Dialogs
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [watchlistForm, setWatchlistForm] = useState({ symbol: "", targetEntry: "", thesis: "", priority: "medium" });
  const [ruleForm, setRuleForm] = useState({ name: "", description: "", category: "entry" });
  const [ruleFilter, setRuleFilter] = useState<string>("all");
  const [selectedLabelFilter, setSelectedLabelFilter] = useState<number | null>(null);
  const [hiddenLabelIds, setHiddenLabelIds] = useState<Set<number>>(new Set()); // For toggle mode - all ON by default
  
  // Trade action dialogs
  const [showEditTrade, setShowEditTrade] = useState(false);
  const [showCloseTrade, setShowCloseTrade] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showCancelTrade, setShowCancelTrade] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<TradeWithEvaluation | null>(null);
  
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

  // Filter trades by label - toggle mode (hidden labels are excluded)
  const filterTradesByLabel = (trades: TradeWithEvaluation[] | undefined) => {
    if (!trades) return trades;
    // If using single selection mode
    if (selectedLabelFilter !== null) {
      return trades.filter(trade => 
        trade.labels?.some(label => label.id === selectedLabelFilter)
      );
    }
    // Toggle mode - hide trades that have ONLY hidden labels
    if (hiddenLabelIds.size > 0) {
      return trades.filter(trade => {
        // If trade has no labels, show it
        if (!trade.labels || trade.labels.length === 0) return true;
        // If ANY label is visible (not hidden), show the trade
        return trade.labels.some(label => !hiddenLabelIds.has(label.id));
      });
    }
    return trades;
  };
  
  // Toggle a label on/off
  const toggleLabelVisibility = (labelId: number) => {
    setHiddenLabelIds(prev => {
      const next = new Set(prev);
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
      }
      return next;
    });
    setSelectedLabelFilter(null); // Switch to toggle mode
  };

  const filteredConsidering = filterTradesByLabel(dashboard?.considering);
  const filteredActive = filterTradesByLabel(dashboard?.active);

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

  const addRuleMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; category?: string }) => {
      return apiRequest("POST", "/api/sentinel/rules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/rules"] });
      setShowAddRule(false);
      setRuleForm({ name: "", description: "", category: "entry" });
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
    mutationFn: async (data: { tradeId: number; entryPrice?: number; stopPrice?: number; targetPrice?: number; positionSize?: number; entryDate?: string; exitPrice?: number; lotEntries?: LotEntry[] }) => {
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
  const handlePriceUpdate = (tradeId: number, field: "stopPrice" | "targetPrice", value: number) => {
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
      // Load saved lot entries
      setLotEntries(trade.lotEntries as LotEntry[]);
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
        lotEntries: lotEntries.filter(lot => lot.qty && lot.dateTime) // Only save valid entries
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
    if (!ruleForm.name) return;
    addRuleMutation.mutate({
      name: ruleForm.name,
      description: ruleForm.description || undefined,
      category: ruleForm.category,
    });
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
          <Button onClick={() => setLocation("/sentinel/evaluate")} data-testid="button-new-evaluation">
            <Plus className="w-4 h-4 mr-2" />
            New Evaluation
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="active" data-testid="tab-active">
              <Crosshair className="w-4 h-4 mr-1" />
              Active ({dashboard?.active.length || 0})
            </TabsTrigger>
            <TabsTrigger value="watching" data-testid="tab-watching">
              <Eye className="w-4 h-4 mr-1" />
              Watching ({watchlist.length})
            </TabsTrigger>
            <TabsTrigger value="considering" data-testid="tab-considering">
              Considering ({dashboard?.considering.length || 0})
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

          <TabsContent value="considering" className="space-y-4">
            {/* Label filter grid */}
            {allLabels.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4" data-testid="label-filter-grid">
                <Button
                  size="sm"
                  variant={selectedLabelFilter === null ? "default" : "outline"}
                  onClick={() => setSelectedLabelFilter(null)}
                  data-testid="label-filter-all"
                >
                  All
                </Button>
                {allLabels.map((label) => (
                  <Button
                    key={label.id}
                    size="sm"
                    variant={selectedLabelFilter === label.id ? "default" : "outline"}
                    onClick={() => setSelectedLabelFilter(label.id)}
                    className="gap-1"
                    data-testid={`label-filter-${label.id}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                    {label.isAdminOnly && <span className="text-xs opacity-70">(admin)</span>}
                  </Button>
                ))}
              </div>
            )}
            {filteredConsidering?.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {selectedLabelFilter !== null
                    ? "No trades with this label."
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
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="active" className="space-y-4">
            {/* Label filter grid for active trades */}
            {allLabels.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4" data-testid="label-filter-grid-active">
                <Button
                  size="sm"
                  variant={selectedLabelFilter === null ? "default" : "outline"}
                  onClick={() => setSelectedLabelFilter(null)}
                  data-testid="label-filter-all-active"
                >
                  All
                </Button>
                {allLabels.map((label) => (
                  <Button
                    key={label.id}
                    size="sm"
                    variant={selectedLabelFilter === label.id ? "default" : "outline"}
                    onClick={() => setSelectedLabelFilter(label.id)}
                    className="gap-1"
                    data-testid={`label-filter-active-${label.id}`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    {label.name}
                  </Button>
                ))}
              </div>
            )}
            {filteredActive?.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  {selectedLabelFilter !== null
                    ? "No active trades with this label."
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

      {/* Add Rule Dialog */}
      <Dialog open={showAddRule} onOpenChange={setShowAddRule}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Trading Rule</DialogTitle>
            <DialogDescription>Define a rule to track your discipline</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Rule</Label>
              <Input
                id="rule-name"
                placeholder="e.g., Wait for pullback to 21 EMA"
                value={ruleForm.name}
                onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                data-testid="input-rule-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-category">Category</Label>
              <Select value={ruleForm.category} onValueChange={(v) => setRuleForm({ ...ruleForm, category: v })}>
                <SelectTrigger data-testid="select-rule-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto_reject">Structural (Plan Requirement)</SelectItem>
                  <SelectItem value="entry">Entry Timing</SelectItem>
                  <SelectItem value="exit">Exit / Profit Taking</SelectItem>
                  <SelectItem value="stop_loss">Stop Loss</SelectItem>
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
            <div className="space-y-2">
              <Label htmlFor="rule-description">Description (optional)</Label>
              <Textarea
                id="rule-description"
                placeholder="More details about this rule..."
                value={ruleForm.description}
                onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
                data-testid="input-rule-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddRule(false)}>Cancel</Button>
            <Button onClick={handleAddRule} disabled={!ruleForm.name || addRuleMutation.isPending} data-testid="button-confirm-add-rule">
              {addRuleMutation.isPending ? "Adding..." : "Add Rule"}
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
    </div>
  );
}
