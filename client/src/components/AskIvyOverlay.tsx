import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { X, Loader2, Sparkles, Zap, Target, GripVertical, ChevronDown, ChevronUp, ThumbsUp, ThumbsDown, BookmarkPlus, AlertTriangle, DollarSign, Settings, Check, Crosshair, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface EntrySuggestion {
  price: number;
  label: string;
  description: string;
  reasoning: string;
  distPercent: number;
  distDollars: number;
  rank: number;
  type?: "fixed" | "dynamic";
}

interface StopSuggestion {
  price: number;
  label: string;
  description: string;
  riskPercent: number;
  rank: number;
  type?: "fixed" | "dynamic";
}

interface TargetSuggestion {
  price: number;
  label: string;
  description: string;
  rrRatio: number;
  rank: number;
}

type LevelSource = "user" | "technical" | "ivy";

interface LevelSelection {
  price: number;
  label: string;
  source: LevelSource;
  technicalId?: string;
}

interface SuggestResponse {
  symbol: string;
  currentPrice: number;
  direction: "long" | "short";
  entryPrice: number;
  entrySuggestions?: EntrySuggestion[];
  stopSuggestions: StopSuggestion[];
  targetSuggestions: TargetSuggestion[];
  technicalContext: string;
}

interface UserSettings {
  accountSize: number | null;
  maxAccountRiskPercent: number | null;
  avgPositionSize: number | null;
  riskProfileCompleted: boolean | null;
  riskProfileSkippedAt: string | null;
  tier: string;
}

interface UsageInfo {
  canUse: boolean;
  used: number;
  limit: number;
  tier: string;
}

interface AdminOverlaySettings {
  targetDisplayLimit: number;
  overlayResizable: boolean;
  chartPriceScaleSide: "left" | "right";
}

interface IvyEvalResponse {
  id: number;
  evaluationText: string;
  riskAssessment: string;
  riskMetrics: {
    riskRewardRatio: string;
    dollarRisk: string;
    dollarProfit: string;
    percentOfAccount: string;
    positionSizeByRisk: number;
  };
  usage: {
    used: number;
    limit: number;
    tier: string;
  };
}

type ActiveLevelField = "entry" | "stop" | "target" | null;

// Setup context for Ivy to provide setup-aware suggestions
export interface SetupContext {
  setupId?: number;
  setupName?: string;
  ivyEntryStrategy?: string | null;
  ivyStopStrategy?: string | null;
  ivyTargetStrategy?: string | null;
  ivyContextNotes?: string | null;
  ivyApproved?: boolean;
  // Indicator results from scan (e.g., U&R undercut/rally bars, MA used)
  indicatorResults?: {
    maUsed?: number;
    undercutPrice?: number;
    rallyPrice?: number;
    touchPrice?: number;
    patternType?: string;
  };
}

interface AskIvyOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  currentPrice: number;
  chartCandles?: { close: number }[];
  direction?: "long" | "short";
  setupType?: string;
  setupContext?: SetupContext;
  onSelectionChange?: (
    entry: { price: number; label: string; type?: string } | null,
    stop: { price: number; label: string; type?: string } | null,
    target?: { price: number; label: string } | null
  ) => void;
  chartClickEvent?: { price: number; timestamp: number } | null;
  onChartClickModeChange?: (activeField: ActiveLevelField) => void;
  isWatchlisted?: boolean;
  watchlistItemId?: number;
  onSaveTradePlan?: (data: { entry?: number; stop?: number; target?: number; watchlistItemId?: number; symbol?: string }) => void;
  onClearTradePlan?: () => void;
  savedTradePlan?: { entry?: number; stop?: number; target?: number } | null;
  /**
   * When false, defer hydrating Trade Plan from localStorage or applying `savedTradePlan`
   * until watchlist (or equivalent) has finished loading so we never flash another ticker's plan.
   */
  tradePlanWatchlistReady?: boolean;
}

// LocalStorage key for persisting Trade Plan state
const ASK_IVY_STORAGE_KEY = "askIvyOverlayState";
/** Bump when persisted shape/semantics change — old blobs are ignored (avoids cross-ticker corruption). */
const ASK_IVY_SCHEMA_VERSION = 2;

interface PersistedIvyState {
  symbol: string;
  entryLevel: LevelSelection | null;
  stopLevel: LevelSelection | null;
  targetLevel: LevelSelection | null;
  position: { x: number; y: number } | null;
  evalResult: IvyEvalResponse | null;
  userRating: "up" | "down" | null;
  timestamp: number;
  schemaVersion?: number;
}

function loadPersistedState(symbol: string): Partial<PersistedIvyState> | null {
  try {
    const stored = localStorage.getItem(ASK_IVY_STORAGE_KEY);
    if (!stored) return null;
    const state: PersistedIvyState = JSON.parse(stored);
    if (state.schemaVersion !== ASK_IVY_SCHEMA_VERSION) {
      return null;
    }
    // Only restore if same symbol and less than 24 hours old
    const hoursSince = (Date.now() - state.timestamp) / (1000 * 60 * 60);
    if (
      (state.symbol || "").toUpperCase() === symbol.toUpperCase() &&
      hoursSince < 24
    ) {
      return state;
    }
    return null;
  } catch {
    return null;
  }
}

function savePersistedState(state: PersistedIvyState) {
  try {
    localStorage.setItem(
      ASK_IVY_STORAGE_KEY,
      JSON.stringify({ ...state, schemaVersion: ASK_IVY_SCHEMA_VERSION })
    );
  } catch {
    // Ignore storage errors
  }
}

function clearPersistedState() {
  try {
    localStorage.removeItem(ASK_IVY_STORAGE_KEY);
  } catch {
    // Ignore errors
  }
}

interface CompactLevelSelectorProps {
  levelType: "entry" | "stop" | "target";
  currentLevel: LevelSelection | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onLevelChange: (level: LevelSelection | null) => void;
  technicalLevels: Array<{
    id: string;
    price: number;
    label: string;
    description?: string;
    extra?: string;
  }>;
  ivyRecommended?: { price: number; label: string } | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  textColor: string;
  borderColor: string;
  accentColor: string;
  isActiveForChartClick?: boolean;
  onActivateChartClick?: () => void;
}

function CompactLevelSelector({
  levelType,
  currentLevel,
  inputValue,
  onInputChange,
  onLevelChange,
  technicalLevels,
  ivyRecommended,
  expanded,
  onExpandedChange,
  textColor,
  borderColor,
  accentColor,
  isActiveForChartClick,
  onActivateChartClick,
}: CompactLevelSelectorProps) {
  const levelTypeLabels = {
    entry: "Entry",
    stop: "Stop",
    target: "Target",
  };

  const getDescriptorLabel = (): string => {
    if (!currentLevel) return "Select a level";
    switch (currentLevel.source) {
      case "user":
        return "User Selected Level";
      case "ivy":
        return "Ivy Recommended";
      case "technical":
        return currentLevel.label;
      default:
        return "Selected Level";
    }
  };

  const handleInputBlur = () => {
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed) && parsed > 0) {
      onLevelChange({
        price: parsed,
        label: "Custom",
        source: "user",
      });
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleInputBlur();
    }
  };

  const handleTechnicalSelect = (tech: { id: string; price: number; label: string }) => {
    onLevelChange({
      price: tech.price,
      label: tech.label,
      source: "technical",
      technicalId: tech.id,
    });
    onInputChange(tech.price.toFixed(2));
    onExpandedChange(false);
  };

  const handleIvySelect = () => {
    if (ivyRecommended) {
      onLevelChange({
        price: ivyRecommended.price,
        label: ivyRecommended.label,
        source: "ivy",
      });
      onInputChange(ivyRecommended.price.toFixed(2));
      onExpandedChange(false);
    }
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold uppercase tracking-wide flex items-center gap-2" style={{ color: `${textColor}99` }}>
        {levelType === "stop" && <Zap className="w-3 h-3 text-amber-500" />}
        {levelType === "target" && <Target className="w-3 h-3 text-green-500" />}
        {levelTypeLabels[levelType]}
        {isActiveForChartClick && (
          <span className="text-[10px] px-1.5 py-0.5 rounded animate-pulse" style={{ backgroundColor: accentColor, color: '#fff' }}>
            Click Chart
          </span>
        )}
      </Label>
      
      <div 
        className="rounded-md border p-2 transition-colors"
        style={{ 
          borderColor: isActiveForChartClick ? accentColor : `${borderColor}66`, 
          backgroundColor: isActiveForChartClick ? `${accentColor}15` : 'rgba(0,0,0,0.1)',
          boxShadow: isActiveForChartClick ? `0 0 8px ${accentColor}40` : 'none',
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: `${textColor}66` }}>$</span>
          <Input
            type="text"
            inputMode="decimal"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            placeholder="0.00"
            className="h-8 font-mono text-sm border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 p-0 flex-1"
            style={{ color: textColor }}
          />
          {onActivateChartClick && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0"
              onClick={onActivateChartClick}
              title="Click to select price from chart"
              style={{ 
                color: isActiveForChartClick ? accentColor : `${textColor}66`,
                backgroundColor: isActiveForChartClick ? `${accentColor}20` : 'transparent',
              }}
            >
              <Crosshair className="w-4 h-4" />
            </Button>
          )}
        </div>
        
        <div className="text-xs mt-1" style={{ color: `${textColor}66` }}>
          {getDescriptorLabel()}
        </div>
      </div>

      <Collapsible open={expanded} onOpenChange={onExpandedChange}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between h-7 text-xs px-2"
            style={{ color: `${textColor}99` }}
          >
            <span>View Technical {levelTypeLabels[levelType]} Levels</span>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div 
            className="mt-1 rounded-md border max-h-40 overflow-y-auto"
            style={{ borderColor: `${borderColor}44`, backgroundColor: 'rgba(0,0,0,0.15)' }}
          >
            {ivyRecommended && (
              <div
                className="flex items-center justify-between p-2 cursor-pointer hover:bg-white/5 border-b"
                style={{ borderColor: `${borderColor}22` }}
                onClick={handleIvySelect}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3 h-3" style={{ color: accentColor }} />
                  <span className="text-xs font-medium" style={{ color: textColor }}>
                    {ivyRecommended.label}
                  </span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1" style={{ borderColor: accentColor, color: accentColor }}>
                    Ivy
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color: `${textColor}99` }}>
                    ${ivyRecommended.price.toFixed(2)}
                  </span>
                  {currentLevel?.source === "ivy" && (
                    <Check className="w-3 h-3" style={{ color: accentColor }} />
                  )}
                </div>
              </div>
            )}
            
            {technicalLevels.map((tech) => {
              const isSelected = currentLevel?.source === "technical" && currentLevel?.technicalId === tech.id;
              return (
                <div
                  key={tech.id}
                  className="flex items-center justify-between p-2 cursor-pointer hover:bg-white/5 border-b last:border-0"
                  style={{ borderColor: `${borderColor}22` }}
                  onClick={() => handleTechnicalSelect(tech)}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium" style={{ color: textColor }}>
                      {tech.label}
                    </span>
                    {tech.extra && (
                      <span className="text-xs ml-2" style={{ color: accentColor }}>
                        {tech.extra}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono" style={{ color: `${textColor}99` }}>
                      ${tech.price.toFixed(2)}
                    </span>
                    {isSelected && (
                      <Check className="w-3 h-3" style={{ color: accentColor }} />
                    )}
                  </div>
                </div>
              );
            })}
            
            {technicalLevels.length === 0 && !ivyRecommended && (
              <div className="p-3 text-center text-xs" style={{ color: `${textColor}66` }}>
                No technical levels available
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function AskIvyOverlay({
  open,
  onOpenChange,
  symbol,
  currentPrice,
  chartCandles,
  direction = "long",
  setupType,
  setupContext,
  onSelectionChange,
  chartClickEvent,
  onChartClickModeChange,
  isWatchlisted,
  watchlistItemId,
  onSaveTradePlan,
  onClearTradePlan,
  savedTradePlan,
  tradePlanWatchlistReady = true,
}: AskIvyOverlayProps) {
  const { systemSettings } = useSystemSettings();
  const { toast } = useToast();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [evalOpen, setEvalOpen] = useState(false);
  const [showRiskModal, setShowRiskModal] = useState(false);
  
  // Compact level selector state
  const [entryLevel, setEntryLevel] = useState<LevelSelection | null>(null);
  const [stopLevel, setStopLevel] = useState<LevelSelection | null>(null);
  const [targetLevel, setTargetLevel] = useState<LevelSelection | null>(null);
  const [entryInputValue, setEntryInputValue] = useState("");
  const [stopInputValue, setStopInputValue] = useState("");
  const [targetInputValue, setTargetInputValue] = useState("");
  const [entryExpanded, setEntryExpanded] = useState(false);
  const [stopExpanded, setStopExpanded] = useState(false);
  const [targetExpanded, setTargetExpanded] = useState(false);
  const [riskModalAccountSize, setRiskModalAccountSize] = useState("");
  const [riskModalMaxRisk, setRiskModalMaxRisk] = useState("");
  const [evalResult, setEvalResult] = useState<IvyEvalResponse | null>(null);
  const [userRating, setUserRating] = useState<"up" | "down" | null>(null);
  const [hasRestoredState, setHasRestoredState] = useState(false);
  const [activeChartClickField, setActiveChartClickField] = useState<ActiveLevelField>(null);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [hasInitializedFromWatchlist, setHasInitializedFromWatchlist] = useState(false);
  const [userClearedLevels, setUserClearedLevels] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [prevSymbol, setPrevSymbol] = useState(symbol);
  
  // DEBUG: Log every render with symbol info
  console.log('[AskIvy] RENDER:', { 
    symbol, 
    prevSymbol, 
    symbolChanged: symbol !== prevSymbol,
    entryLevel: entryLevel?.price,
    stopLevel: stopLevel?.price,
    targetLevel: targetLevel?.price,
    watchlistItemId 
  });
  
  // Track watchlistItemId for current symbol - updated every render where symbol matches
  const currentWatchlistItemIdRef = useRef<number | undefined>(watchlistItemId);
  
  // Keep ref updated while on same symbol
  if (symbol === prevSymbol) {
    currentWatchlistItemIdRef.current = watchlistItemId;
  }
  
  // Track if we've already auto-filled with Ivy suggestions for this symbol
  const [hasAutoFilledIvy, setHasAutoFilledIvy] = useState(false);
  
  // SAVE for the previous symbol, then reset Trade Plan state whenever `symbol` changes.
  // (Must not require prevSymbol truthy to clear — '' → first ticker still needs a clean slate.)
  useEffect(() => {
    if (symbol === prevSymbol) return;

    if (prevSymbol) {
      const hasLevels = entryLevel?.price || stopLevel?.price || targetLevel?.price;
      if (hasLevels) {
        onSaveTradePlan?.({
          entry: entryLevel?.price,
          stop: stopLevel?.price,
          target: targetLevel?.price,
          watchlistItemId: currentWatchlistItemIdRef.current,
          symbol: prevSymbol,
        });
      }
    }

    // Scrub local draft for the *new* symbol immediately so refresh/hydrate never reads stale prices.
    savePersistedState({
      symbol,
      entryLevel: null,
      stopLevel: null,
      targetLevel: null,
      position: null,
      evalResult: null,
      userRating: null,
      timestamp: Date.now(),
    });

    setPrevSymbol(symbol);
    currentWatchlistItemIdRef.current = watchlistItemId;

    setEvalResult(null);
    setUserRating(null);
    setEntryLevel(null);
    setStopLevel(null);
    setTargetLevel(null);
    setEntryInputValue("");
    setStopInputValue("");
    setTargetInputValue("");
    setHasRestoredState(false);
    setHasInitializedFromWatchlist(false);
    setUserClearedLevels(false);
    setHasAutoFilledIvy(false);
    setEvalOpen(false);
  }, [symbol, prevSymbol, entryLevel, stopLevel, targetLevel, onSaveTradePlan, watchlistItemId]);

  // Check if there are any price levels set (for save prompt)
  const hasTradePlanData = Boolean(entryLevel?.price || stopLevel?.price || targetLevel?.price || evalResult);
  
  // Handle incoming chart click price
  useEffect(() => {
    if (chartClickEvent && activeChartClickField) {
      const newLevel: LevelSelection = {
        price: chartClickEvent.price,
        label: "Chart Click",
        source: "user",
      };
      const priceStr = chartClickEvent.price.toFixed(2);
      
      switch (activeChartClickField) {
        case "entry":
          setEntryLevel(newLevel);
          setEntryInputValue(priceStr);
          break;
        case "stop":
          setStopLevel(newLevel);
          setStopInputValue(priceStr);
          break;
        case "target":
          setTargetLevel(newLevel);
          setTargetInputValue(priceStr);
          break;
      }
    }
  }, [chartClickEvent?.timestamp, activeChartClickField]);
  
  // Notify parent when active field changes
  useEffect(() => {
    onChartClickModeChange?.(activeChartClickField);
  }, [activeChartClickField, onChartClickModeChange]);

  // Initialize from watchlist saved trade plan data
  useEffect(() => {
    // Only initialize if there's actual saved data (at least one level)
    const hasSavedData = savedTradePlan && (savedTradePlan.entry || savedTradePlan.stop || savedTradePlan.target);
    
    console.log('[AskIvy] savedTradePlan effect:', { 
      open, 
      symbol, 
      hasSavedData, 
      hasInitializedFromWatchlist,
      savedTradePlan 
    });
    
    if (
      open &&
      symbol &&
      tradePlanWatchlistReady &&
      hasSavedData &&
      !hasInitializedFromWatchlist
    ) {
      console.log('[AskIvy] LOADING saved levels for', symbol, savedTradePlan);
      if (savedTradePlan.entry) {
        setEntryLevel({ price: savedTradePlan.entry, label: "Saved", source: "user" });
        setEntryInputValue(savedTradePlan.entry.toFixed(2));
      }
      if (savedTradePlan.stop) {
        setStopLevel({ price: savedTradePlan.stop, label: "Saved", source: "user" });
        setStopInputValue(savedTradePlan.stop.toFixed(2));
      }
      if (savedTradePlan.target) {
        setTargetLevel({ price: savedTradePlan.target, label: "Saved", source: "user" });
        setTargetInputValue(savedTradePlan.target.toFixed(2));
      }
      setHasInitializedFromWatchlist(true);
    }
    if (!open) {
      setHasInitializedFromWatchlist(false);
      setUserClearedLevels(false);
    }
  }, [open, symbol, savedTradePlan, hasInitializedFromWatchlist, tradePlanWatchlistReady]);

  // Restore persisted state when opening with a symbol (fallback if no watchlist data)
  useEffect(() => {
    if (open && symbol && tradePlanWatchlistReady && !hasRestoredState && !savedTradePlan) {
      const persisted = loadPersistedState(symbol);
      if (persisted) {
        if (persisted.entryLevel) {
          setEntryLevel(persisted.entryLevel);
          setEntryInputValue(persisted.entryLevel.price.toFixed(2));
        }
        if (persisted.stopLevel) {
          setStopLevel(persisted.stopLevel);
          setStopInputValue(persisted.stopLevel.price.toFixed(2));
        }
        if (persisted.targetLevel) {
          setTargetLevel(persisted.targetLevel);
          setTargetInputValue(persisted.targetLevel.price.toFixed(2));
        }
        if (persisted.position) setPosition(persisted.position);
        if (persisted.evalResult) setEvalResult(persisted.evalResult);
        if (persisted.userRating) setUserRating(persisted.userRating);
      }
      setHasRestoredState(true);
    }
    if (!open) {
      setHasRestoredState(false);
    }
  }, [open, symbol, hasRestoredState, savedTradePlan, tradePlanWatchlistReady]);

  // Save state to localStorage when it changes (for persistence across navigation).
  // Skip while `symbol !== prevSymbol`: same commit still has the *previous* ticker's levels in state,
  // which would corrupt storage (new symbol key + old prices) and restore wrong stops/targets.
  useEffect(() => {
    if (open && symbol && symbol === prevSymbol) {
      savePersistedState({
        symbol,
        entryLevel,
        stopLevel,
        targetLevel,
        position,
        evalResult,
        userRating,
        timestamp: Date.now(),
      });
    }
  }, [open, symbol, prevSymbol, entryLevel, stopLevel, targetLevel, position, evalResult, userRating]);

  const effectivePrice = currentPrice > 0
    ? currentPrice
    : (chartCandles?.length ? chartCandles[chartCandles.length - 1].close : 0);

  // Fetch user settings (risk profile)
  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/sentinel/user-settings"],
    enabled: open,
  });

  // Fetch admin overlay settings (for display limits, resize, etc.)
  const { data: adminSettings } = useQuery<AdminOverlaySettings>({
    queryKey: ["/api/sentinel/ask-ivy-settings"],
    enabled: open,
  });

  // Use admin settings with defaults
  const targetDisplayLimit = adminSettings?.targetDisplayLimit ?? 8;
  const stopDisplayLimit = 5; // Keep stops at 5
  const overlayResizable = adminSettings?.overlayResizable ?? false;

  // Fetch usage info
  const { data: usageInfo, refetch: refetchUsage } = useQuery<UsageInfo>({
    queryKey: ["/api/sentinel/ivy-eval/usage"],
    enabled: open,
  });

  // Fetch suggestions
  const { data: suggestions, isLoading, isError, error } = useQuery<SuggestResponse>({
    queryKey: ["/api/sentinel/suggest", symbol, effectivePrice, direction, setupType, setupContext?.setupId],
    enabled: open && !!symbol && effectivePrice > 0,
    queryFn: async () => {
      console.log(`[AskIvy] Fetching suggestions for ${symbol} @ $${effectivePrice}`, setupContext ? `with setup context: ${setupContext.setupName}` : '');
      const res = await apiRequest("POST", "/api/sentinel/suggest", {
        symbol: symbol.toUpperCase(),
        direction,
        entryPrice: effectivePrice,
        setupType: setupType || undefined,
        setupContext: setupContext?.ivyApproved ? setupContext : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
      }
      return res.json();
    },
    retry: false,
  });

  const entrySuggestions = suggestions?.entrySuggestions ?? [];
  const stopSuggestions = suggestions?.stopSuggestions ?? [];
  const targetSuggestions = suggestions?.targetSuggestions ?? [];

  // Get Ivy's top recommendations
  const ivyEntry = entrySuggestions[0];
  const ivyStop = stopSuggestions[0];
  const ivyTarget = targetSuggestions[0];

  // Auto-fill with Ivy recommendations - DISABLED
  // User prefers to only use saved levels or manual chart clicks
  // Ivy suggestions are still available in the expandable lists for manual selection

  // Check if should show risk modal (first-time user)
  useEffect(() => {
    if (open && userSettings && !userSettings.riskProfileCompleted) {
      // Check if recently skipped (within 24 hours)
      const skippedAt = userSettings.riskProfileSkippedAt;
      if (skippedAt) {
        const hoursSinceSkip = (Date.now() - new Date(skippedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceSkip < 24) return;
      }
      setShowRiskModal(true);
    }
  }, [open, userSettings]);

  // Track previous open state to detect closing
  const prevOpenRef = useRef(open);
  
  useEffect(() => {
    // When overlay CLOSES (was open, now closed), save levels first
    if (prevOpenRef.current && !open) {
      const hasLevels = entryLevel?.price || stopLevel?.price || targetLevel?.price;
      if (hasLevels && symbol) {
        onSaveTradePlan?.({
          entry: entryLevel?.price,
          stop: stopLevel?.price,
          target: targetLevel?.price,
          watchlistItemId: currentWatchlistItemIdRef.current,
          symbol: symbol,
        });
      }
    }
    prevOpenRef.current = open;
    
    if (!open) {
      setEvalResult(null);
      setUserRating(null);
      // Reset compact level selector internal state only
      // DO NOT call onSelectionChange here - parent state should persist for price lines
      setEntryLevel(null);
      setStopLevel(null);
      setTargetLevel(null);
      setEntryInputValue("");
      setStopInputValue("");
      setTargetInputValue("");
      setEntryExpanded(false);
      setActiveChartClickField(null);
      setStopExpanded(false);
      setTargetExpanded(false);
    }
  }, [open, entryLevel, stopLevel, targetLevel, symbol, onSaveTradePlan]);

  useEffect(() => {
    onSelectionChange?.(
      entryLevel ? { price: entryLevel.price, label: entryLevel.label, type: entryLevel.source } : null,
      stopLevel ? { price: stopLevel.price, label: stopLevel.label, type: stopLevel.source } : null,
      targetLevel ? { price: targetLevel.price, label: targetLevel.label } : null
    );
  }, [entryLevel, stopLevel, targetLevel, onSelectionChange]);

  // Save risk profile mutation
  const saveRiskMutation = useMutation({
    mutationFn: async (data: { accountSize?: number; maxAccountRiskPercent?: number }) => {
      return apiRequest("PATCH", "/api/sentinel/user-settings", { ...data, riskProfileCompleted: true });
    },
    onSuccess: () => {
      setShowRiskModal(false);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/user-settings"] });
      toast({ title: "Risk profile saved", description: "Your settings have been updated." });
    },
  });

  // Skip risk profile mutation
  const skipRiskMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sentinel/user-settings/skip", {});
    },
    onSuccess: () => {
      setShowRiskModal(false);
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/user-settings"] });
    },
  });

  // Generate Ivy Eval mutation
  const evalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sentinel/ivy-eval", {
        symbol: symbol.toUpperCase(),
        direction,
        currentPrice: effectivePrice,
        selectedEntry: entryLevel?.price,
        selectedStop: stopLevel?.price,
        selectedTarget: targetLevel?.price,
        recommendedEntry: ivyEntry?.price,
        recommendedStop: ivyStop?.price,
        recommendedTarget: ivyTarget?.price,
        technicalSnapshot: suggestions?.technicalContext,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setEvalResult(data);
      setEvalOpen(true);
      refetchUsage();
      toast({ title: "Ivy Stock Eval", description: "Evaluation generated successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Rate eval mutation
  const rateMutation = useMutation({
    mutationFn: async (rating: "up" | "down") => {
      if (!evalResult) return;
      return apiRequest("POST", `/api/sentinel/ivy-eval/${evalResult.id}/rate`, { rating });
    },
    onSuccess: () => {
      toast({ title: "Thanks for your feedback!" });
    },
  });

  // Add to watchlist mutation
  const watchlistMutation = useMutation({
    mutationFn: async () => {
      // Only pass ivyEvalId if it's a valid number (not a temporary ID)
      const validEvalId = evalResult?.id && typeof evalResult.id === 'number' ? evalResult.id : undefined;
      
      return apiRequest("POST", "/api/sentinel/watchlist/with-ivy-eval", {
        symbol: symbol.toUpperCase(),
        direction,
        targetEntry: entryLevel?.price || ivyEntry?.price,
        stopPlan: stopLevel?.price || ivyStop?.price,
        targetPlan: targetLevel?.price || ivyTarget?.price,
        thesis: `${direction} setup @ ${(entryLevel?.price || ivyEntry?.price)?.toFixed(2)}`,
        priority: 'medium',
        ivyEvalId: validEvalId,
        ivyEvalText: evalResult?.evaluationText,
        ivyRecommendedEntry: ivyEntry?.price,
        ivyRecommendedStop: ivyStop?.price,
        ivyRecommendedTarget: ivyTarget?.price,
        ivyRiskAssessment: evalResult?.riskAssessment,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sentinel/watchlist"] });
      toast({ title: "Added to Watchlist", description: `${symbol} has been added with your Ivy analysis.` });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add to watchlist", variant: "destructive" });
    },
  });

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const startLeft = position?.x ?? rect.left;
    const startTop = position?.y ?? rect.top;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      setPosition({
        x: Math.max(0, startLeft + dx),
        y: Math.max(0, startTop + dy),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleRate = (rating: "up" | "down") => {
    setUserRating(rating);
    rateMutation.mutate(rating);
  };

  if (!open) return null;

  // Get theme colors from system settings
  const panelBg = systemSettings?.overlayColor || "#1e3a5f";
  const panelOpacity = (systemSettings?.overlayTransparency ?? 75) / 100;
  const borderColor = systemSettings?.secondaryOverlayColor || "#e8e8e8";
  const textColor = systemSettings?.textColorNormal || "#ffffff";
  const textColorMuted = systemSettings?.textColorSmall || "#a1a1aa";
  const headerBg = systemSettings?.backgroundColor || "#0f172a";

  const panelStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y, transform: "none" }
    : { left: "50%", top: "1.5rem", transform: "translateX(-50%)" };

  // Calculate percentages for header display
  const entryPrice = entryLevel?.price;
  const stopPrice = stopLevel?.price;
  const targetPrice = targetLevel?.price;
  
  let stopPctChange: number | null = null;
  let targetPctChange: number | null = null;
  
  if (entryPrice && stopPrice) {
    stopPctChange = ((stopPrice - entryPrice) / entryPrice) * 100;
  }
  if (entryPrice && targetPrice) {
    targetPctChange = ((targetPrice - entryPrice) / entryPrice) * 100;
  }

  return (
    <>
      {/* First-time Risk Profile Modal */}
      <Dialog open={showRiskModal} onOpenChange={setShowRiskModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Set Up Your Risk Profile
            </DialogTitle>
            <DialogDescription>
              Help Ivy provide personalized risk calculations for your trades.
              You can change these settings anytime in User Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Account Size</Label>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={riskModalAccountSize}
                  onChange={(e) => setRiskModalAccountSize(e.target.value)}
                  placeholder="100000"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max Risk per Trade (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.1"
                  value={riskModalMaxRisk}
                  onChange={(e) => setRiskModalMaxRisk(e.target.value)}
                  placeholder="2"
                />
                <span className="text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => skipRiskMutation.mutate()}
              disabled={skipRiskMutation.isPending}
            >
              Skip for now
            </Button>
            <Button
              onClick={() => saveRiskMutation.mutate({
                accountSize: parseFloat(riskModalAccountSize) || undefined,
                maxAccountRiskPercent: parseFloat(riskModalMaxRisk) || undefined,
              })}
              disabled={saveRiskMutation.isPending}
            >
              Save Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Overlay */}
      <div
        className="fixed inset-0 z-40 pointer-events-none"
        style={{ backgroundColor: "transparent" }}
      >
        <div
          ref={panelRef}
          className="w-full max-w-md rounded-lg border shadow-xl overflow-hidden pointer-events-auto fixed"
          style={{
            ...panelStyle,
            width: "min(30rem, calc(100vw - 1rem))",
            maxHeight: "calc(100vh - 4rem)",
            minWidth: overlayResizable ? "280px" : undefined,
            minHeight: overlayResizable ? "200px" : undefined,
            resize: overlayResizable ? "both" : "none",
            overflow: overlayResizable ? "auto" : "hidden",
            backgroundColor: `${panelBg}${Math.round(panelOpacity * 255).toString(16).padStart(2, '0')}`,
            borderColor: borderColor,
          }}
          data-testid="ask-ivy-overlay"
        >
          {/* Bloomberg-style Header */}
          <div
            className="flex items-center justify-between px-4 py-2 border-b cursor-grab active:cursor-grabbing select-none"
            style={{ borderColor: borderColor, backgroundColor: headerBg }}
            onMouseDown={handleHeaderMouseDown}
          >
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4" style={{ color: `${textColor}66` }} />
              <Sparkles className="h-4 w-4" style={{ color: '#fbbf24' }} />
              <span className="font-semibold font-['Roboto_Condensed',sans-serif] tracking-tight" style={{ color: textColor }}>
                Trade Plan
              </span>
            </div>
            <div className="flex items-center gap-1">
              {hasTradePlanData && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={() => {
                    setEntryLevel(null);
                    setStopLevel(null);
                    setTargetLevel(null);
                    setEntryInputValue("");
                    setStopInputValue("");
                    setTargetInputValue("");
                    setEvalResult(null);
                    setUserRating(null);
                    setUserClearedLevels(true);
                    clearPersistedState();
                    onClearTradePlan?.();
                    toast({ title: "Cleared", description: "Trade plan data cleared" });
                  }}
                  style={{ color: '#ef4444' }}
                  title="Clear all price levels"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => {
                  if (hasTradePlanData && !isWatchlisted) {
                    setShowSavePrompt(true);
                  } else {
                    if (isWatchlisted && hasTradePlanData) {
                      onSaveTradePlan?.({ 
                        entry: entryLevel?.price, 
                        stop: stopLevel?.price, 
                        target: targetLevel?.price 
                      });
                    }
                    onOpenChange(false);
                  }
                }}
                style={{ color: textColor }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Price Summary Header - Bloomberg Widget Style */}
          <div
            className="px-4 py-2 border-b font-['Roboto_Condensed',sans-serif] tracking-tight"
            style={{ borderColor: `${borderColor}66`, backgroundColor: `${panelBg}88` }}
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold" style={{ color: textColor }}>{symbol}</span>
              <span className="text-xs" style={{ color: `${textColor}99` }}>
                {direction.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs font-mono">
              <span style={{ color: textColor }}>
                ENTRY: {entryPrice ? `$${entryPrice.toFixed(2)}` : '$--'}
              </span>
              <span style={{ color: `${textColor}66` }}>|</span>
              <span style={{ color: targetPctChange !== null && targetPctChange > 0 ? '#22c55e' : textColor }}>
                TP: {targetPrice ? (
                  <>
                    ${targetPrice.toFixed(2)}
                    {targetPctChange !== null && (
                      <span className="ml-1">
                        ({targetPctChange > 0 ? '+' : ''}{targetPctChange.toFixed(1)}%)
                      </span>
                    )}
                  </>
                ) : '$--'}
              </span>
              <span style={{ color: `${textColor}66` }}>|</span>
              <span style={{ color: stopPctChange !== null ? '#ef4444' : textColor }}>
                STOP: {stopPrice ? (
                  <>
                    ${stopPrice.toFixed(2)}
                    {stopPctChange !== null && (
                      <span className="ml-1">
                        ({stopPctChange > 0 ? '+' : ''}{stopPctChange.toFixed(1)}%)
                      </span>
                    )}
                  </>
                ) : '$--'}
              </span>
            </div>
          </div>

          <div className="max-h-[55vh] overflow-y-auto p-4 space-y-4">
            {/* Debug info */}
            <div className="text-xs bg-black/20 rounded p-2 font-mono" style={{ color: `${textColor}99` }}>
              {symbol} @ ${effectivePrice.toFixed(2)} | {isLoading ? "Loading..." : isError ? "Error" : "Ready"}
            </div>
            
            {isError && (
              <div className="text-sm text-red-400 bg-red-500/10 rounded p-2">
                {(error as Error)?.message || "Failed to fetch suggestions"}
              </div>
            )}
            
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: `${textColor}66` }} />
              </div>
            ) : (
              <>
                {/* Entry Section */}
                <CompactLevelSelector
                  levelType="entry"
                  currentLevel={entryLevel}
                  inputValue={entryInputValue}
                  onInputChange={setEntryInputValue}
                  onLevelChange={setEntryLevel}
                  technicalLevels={entrySuggestions.slice(1).map((e) => ({
                    id: `${e.price}-${e.label}`,
                    price: e.price,
                    label: e.label,
                    description: e.reasoning,
                    extra: `${e.distPercent >= 0 ? "+" : ""}${e.distPercent.toFixed(1)}%`,
                  }))}
                  ivyRecommended={ivyEntry ? { price: ivyEntry.price, label: ivyEntry.label } : null}
                  expanded={entryExpanded}
                  onExpandedChange={setEntryExpanded}
                  textColor={textColor}
                  borderColor={borderColor}
                  accentColor="#3b82f6"
                  isActiveForChartClick={activeChartClickField === "entry"}
                  onActivateChartClick={() => setActiveChartClickField(activeChartClickField === "entry" ? null : "entry")}
                />

                {/* Stop Section */}
                <CompactLevelSelector
                  levelType="stop"
                  currentLevel={stopLevel}
                  inputValue={stopInputValue}
                  onInputChange={setStopInputValue}
                  onLevelChange={setStopLevel}
                  technicalLevels={stopSuggestions.slice(1).map((s) => ({
                    id: `${s.price}-${s.label}`,
                    price: s.price,
                    label: s.label,
                    description: s.description,
                    extra: `${s.riskPercent.toFixed(1)}% risk`,
                  }))}
                  ivyRecommended={ivyStop ? { price: ivyStop.price, label: ivyStop.label } : null}
                  expanded={stopExpanded}
                  onExpandedChange={setStopExpanded}
                  textColor={textColor}
                  borderColor={borderColor}
                  accentColor="#ef4444"
                  isActiveForChartClick={activeChartClickField === "stop"}
                  onActivateChartClick={() => setActiveChartClickField(activeChartClickField === "stop" ? null : "stop")}
                />

                {/* Target Section */}
                <CompactLevelSelector
                  levelType="target"
                  currentLevel={targetLevel}
                  inputValue={targetInputValue}
                  onInputChange={setTargetInputValue}
                  onLevelChange={setTargetLevel}
                  technicalLevels={targetSuggestions.slice(1).map((t) => ({
                    id: `${t.price}-${t.label}`,
                    price: t.price,
                    label: t.label,
                    description: t.description,
                    extra: `${t.rrRatio}:1 R:R`,
                  }))}
                  ivyRecommended={ivyTarget ? { price: ivyTarget.price, label: ivyTarget.label } : null}
                  expanded={targetExpanded}
                  onExpandedChange={setTargetExpanded}
                  textColor={textColor}
                  borderColor={borderColor}
                  accentColor="#22c55e"
                  isActiveForChartClick={activeChartClickField === "target"}
                  onActivateChartClick={() => setActiveChartClickField(activeChartClickField === "target" ? null : "target")}
                />

                {/* Ivy Stock Eval Section */}
                <Collapsible open={evalOpen} onOpenChange={setEvalOpen} className="mt-4">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      style={{ borderColor: borderColor, color: textColor }}
                      onClick={() => {
                        if (!evalOpen && !evalResult) {
                          if (!usageInfo?.canUse) {
                            toast({
                              title: "Evaluation limit reached",
                              description: `You've used ${usageInfo?.used || 0}/${usageInfo?.limit || 0} evaluations this month.`,
                              variant: "destructive",
                            });
                            return;
                          }
                          evalMutation.mutate();
                        }
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        <span>Ivy Stock Eval</span>
                        {usageInfo && (
                          <Badge variant="secondary" className="text-xs">
                            {usageInfo.used}/{usageInfo.limit === -1 ? '∞' : usageInfo.limit}
                          </Badge>
                        )}
                      </div>
                      {evalMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : evalOpen ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    {evalResult && (
                      <div className="space-y-3 p-3 rounded-lg" style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}>
                        {/* Risk Assessment Badge */}
                        <div className="flex items-center justify-between">
                          <Badge
                            style={{
                              backgroundColor: evalResult.riskAssessment === 'low' ? 'rgba(34,197,94,0.2)' :
                                              evalResult.riskAssessment === 'medium' ? 'rgba(234,179,8,0.2)' :
                                              'rgba(239,68,68,0.2)',
                              color: evalResult.riskAssessment === 'low' ? '#22c55e' :
                                     evalResult.riskAssessment === 'medium' ? '#eab308' : '#ef4444',
                              borderColor: evalResult.riskAssessment === 'low' ? '#22c55e' :
                                           evalResult.riskAssessment === 'medium' ? '#eab308' : '#ef4444',
                            }}
                          >
                            Risk: {evalResult.riskAssessment.toUpperCase()}
                          </Badge>
                          <span className="text-xs font-mono" style={{ color: `${textColor}99` }}>
                            R:R {evalResult.riskMetrics.riskRewardRatio}:1
                          </span>
                        </div>

                        {/* Risk Metrics */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3 text-red-400" />
                            <span style={{ color: `${textColor}99` }}>Risk:</span>
                            <span className="font-mono text-red-400">${evalResult.riskMetrics.dollarRisk}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3 text-green-400" />
                            <span style={{ color: `${textColor}99` }}>Profit:</span>
                            <span className="font-mono text-green-400">${evalResult.riskMetrics.dollarProfit}</span>
                          </div>
                        </div>

                        {/* AI Evaluation Text */}
                        <div 
                          className="text-sm leading-relaxed max-h-64 overflow-y-auto pr-2 space-y-2" 
                          style={{ color: textColor }}
                        >
                          {evalResult.evaluationText.split('\n').map((paragraph, idx) => (
                            paragraph.trim() && <p key={idx}>{paragraph}</p>
                          ))}
                        </div>

                        {/* Rating Buttons */}
                        <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: `${borderColor}66` }}>
                          <div className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: `${textColor}66` }}>Rate this eval:</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={`h-7 w-7 p-0 ${userRating === 'up' ? 'text-green-500' : ''}`}
                              onClick={() => handleRate('up')}
                              disabled={userRating !== null}
                            >
                              <ThumbsUp className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={`h-7 w-7 p-0 ${userRating === 'down' ? 'text-red-500' : ''}`}
                              onClick={() => handleRate('down')}
                              disabled={userRating !== null}
                            >
                              <ThumbsDown className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Add to Watchlist Button */}
                        <Button
                          className="w-full"
                          onClick={() => watchlistMutation.mutate()}
                          disabled={watchlistMutation.isPending}
                        >
                          {watchlistMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <BookmarkPlus className="w-4 h-4 mr-2" />
                          )}
                          Add to Watchlist
                        </Button>

                        {/* Warning Note */}
                        <div className="flex items-start gap-2 p-2 rounded text-xs" style={{ backgroundColor: 'rgba(234,179,8,0.1)' }}>
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <span style={{ color: `${textColor}99` }}>
                            You must watchlist this ticker to save your AI analysis.
                          </span>
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </div>

          {/* Footer with Settings Link */}
          <div
            className="px-4 py-2 border-t text-xs flex items-center justify-between"
            style={{ borderColor: `${borderColor}66`, color: `${textColor}66` }}
          >
            <span>
              {userSettings?.riskProfileCompleted ? (
                `Account: $${(userSettings.accountSize || 100000).toLocaleString()}`
              ) : (
                'Risk profile not set'
              )}
            </span>
            <Link href="/sentinel/settings">
              <Button variant="ghost" size="sm" className="h-6 text-xs" style={{ color: `${textColor}99` }}>
                <Settings className="w-3 h-3 mr-1" />
                Settings
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Save to Watchlist Prompt Dialog */}
      <Dialog open={showSavePrompt} onOpenChange={setShowSavePrompt}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Trade Plan?</DialogTitle>
            <DialogDescription>
              Would you like to save {symbol} {evalResult ? 'with your Trade Plan and Ivy Stock Analysis' : 'with your Trade Plan'} to your watchlist?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                clearPersistedState();
                setShowSavePrompt(false);
                onOpenChange(false);
              }}
            >
              Discard
            </Button>
            <Button
              onClick={() => {
                onSaveTradePlan?.({ 
                  entry: entryLevel?.price, 
                  stop: stopLevel?.price, 
                  target: targetLevel?.price 
                });
                setShowSavePrompt(false);
                onOpenChange(false);
              }}
            >
              <BookmarkPlus className="w-4 h-4 mr-2" />
              Save to Watchlist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
