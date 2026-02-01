import { Layout } from "@/components/Layout";
import { useScanner } from "@/hooks/use-stocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useLocation } from "wouter";
import { Loader2, Search, Filter, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, X, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MiniChart } from "@/components/MiniChart";
import { useScannerContext } from "@/context/ScannerContext";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const CHARTS_PER_PAGE = 10;

export default function ScannerPage() {
  const [, setLocation] = useLocation();
  const { mutate: runScan, isPending } = useScanner();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [scanName, setScanName] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { 
    filters, 
    setFilters, 
    results, 
    setResults, 
    currentPage, 
    setCurrentPage,
    isScanning,
    setIsScanning,
    hasScanned,
    setHasScanned,
    clearAll
  } = useScannerContext();
  
  // Generate default scan name from criteria
  const generateScanTitle = () => {
    const parts: string[] = [];
    if (filters.chartPattern && filters.chartPattern !== 'All') parts.push(filters.chartPattern);
    if (filters.technicalSignal && filters.technicalSignal !== 'none') {
      const signalNames: Record<string, string> = {
        '6_20_cross': filters.crossDirection === 'up' ? '6/20 Cross Up' : '6/20 Cross Down',
        'ride_21_ema': 'Ride 21 EMA',
        'pullback_5_dma': 'PB to 5 DMA',
        'pullback_10_dma': 'PB to 10 DMA',
        'pullback_20_dma': 'PB to 20 DMA',
        'pullback_50_dma': 'PB to 50 DMA',
      };
      parts.push(signalNames[filters.technicalSignal] || filters.technicalSignal);
    }
    if (filters.scannerIndex) {
      const indexNames: Record<string, string> = {
        'sp500': 'S&P 500',
        'sp100': 'S&P 100',
        'nasdaq100': 'NASDAQ 100',
        'dow30': 'DOW 30',
        'all': 'All Stocks',
      };
      parts.push(indexNames[filters.scannerIndex] || filters.scannerIndex);
    }
    return parts.join(' + ') || 'Custom Scan';
  };

  const saveScanMutation = useMutation({
    mutationFn: async ({ name, criteria }: { name: string; criteria: Record<string, unknown> }) => {
      return apiRequest('POST', '/api/saved-scans', { name, criteria });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/saved-scans'] });
      toast({ title: 'Scan saved', description: `"${scanName || generateScanTitle()}" has been saved.` });
      setShowSaveDialog(false);
      setScanName("");
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save scan.', variant: 'destructive' });
    },
  });
  
  const handleSaveScan = () => {
    const name = scanName.trim() || generateScanTitle();
    saveScanMutation.mutate({ name, criteria: filters as Record<string, unknown> });
  };

  // Get thumbnail indicator label based on selected signal/pattern
  const getThumbnailIndicatorLabel = () => {
    if (filters.technicalSignal === '6_20_cross') {
      return { text: 'SMA 6 Pink, SMA 20 Blue', color: 'text-white' };
    }
    if (filters.technicalSignal === 'ride_21_ema') {
      return { text: 'EMA 21 Pink', color: 'text-pink-400' };
    }
    if (filters.technicalSignal?.startsWith('pullback_')) {
      return { text: 'SMA 21 Pink', color: 'text-pink-400' };
    }
    if (filters.chartPattern === 'Monthly Tight') {
      return { text: '3 Month SMA Pink', color: 'text-pink-400' };
    }
    if (['VCP', 'Weekly Tight', 'High Tight Flag', 'Cup and Handle'].includes(filters.chartPattern || '')) {
      return { text: 'SMA 21 Pink', color: 'text-pink-400' };
    }
    return { text: 'SMA 21 Pink', color: 'text-pink-400' };
  };

  // Build criteria summary for display
  const getCriteriaSummary = () => {
    const criteria: string[] = [];
    
    // Stock Universe
    const indexLabels: Record<string, string> = {
      'dow30': 'Dow 30',
      'nasdaq100': 'Nasdaq 100', 
      'sp100': 'S&P 100',
      'sp500': 'S&P 500',
      'all': 'All Stocks'
    };
    if (filters.scannerIndex) {
      criteria.push(indexLabels[filters.scannerIndex] || filters.scannerIndex);
    }
    
    // Chart Pattern
    if (filters.chartPattern && filters.chartPattern !== 'All') {
      criteria.push(filters.chartPattern);
    }
    
    // Technical Signal
    const signalLabels: Record<string, string> = {
      '6_20_cross': `6/20 Cross ${filters.crossDirection === 'up' ? 'Up' : 'Down'}`,
      'ride_21_ema': 'Ride 21 EMA',
      'pullback_5dma': 'Pullback to 5 DMA',
      'pullback_10dma': 'Pullback to 10 DMA',
      'pullback_20dma': 'Pullback to 20 DMA',
      'pullback_50dma': 'Pullback to 50 DMA'
    };
    if (filters.technicalSignal && filters.technicalSignal !== 'none') {
      criteria.push(signalLabels[filters.technicalSignal] || filters.technicalSignal);
    }
    
    // SMA Filter
    if (filters.smaFilter && filters.smaFilter !== 'none') {
      const smaLabels: Record<string, string> = {
        'stacked': 'SMAs Stacked',
        'above50_200': 'Above 50/200 SMA'
      };
      criteria.push(smaLabels[filters.smaFilter] || filters.smaFilter);
    }
    
    // Price range
    if (filters.minPrice || filters.maxPrice) {
      const priceStr = filters.minPrice && filters.maxPrice 
        ? `$${filters.minPrice}-$${filters.maxPrice}`
        : filters.minPrice 
          ? `>$${filters.minPrice}` 
          : `<$${filters.maxPrice}`;
      criteria.push(priceStr);
    }
    
    // Volume
    if (filters.minVolume) {
      criteria.push(`Vol >${(filters.minVolume / 1000000).toFixed(1)}M`);
    }
    
    return criteria;
  };

  const handleScan = () => {
    setCurrentPage(1);
    setIsScanning(true);
    setResults(null);
    // Apply sensible defaults if not set
    const scanFilters = {
      ...filters,
      minPrice: filters.minPrice ?? 7,
      minVolume: filters.minVolume ?? 500000,
    };
    runScan(scanFilters, {
      onSuccess: (data) => {
        setResults(data);
        setHasScanned(true);
      },
      onSettled: () => setIsScanning(false)
    });
  };
  
  // Set VCP defaults when VCP is selected
  const handlePatternChange = (val: "All" | "VCP" | "Weekly Tight" | "Monthly Tight" | "High Tight Flag" | "Cup and Handle") => {
    if (val === 'VCP') {
      setFilters(prev => ({ 
        ...prev, 
        chartPattern: val,
        maxChannelHeightPct: prev.maxChannelHeightPct ?? 15,
        smaFilter: prev.smaFilter === 'none' ? 'above50_200' : prev.smaFilter,
      }));
    } else {
      setFilters(prev => ({ ...prev, chartPattern: val }));
    }
  };

  const chartPatterns = ["All", "VCP", "Weekly Tight", "Monthly Tight", "High Tight Flag", "Cup and Handle"];
  
  const showChannelHeightFilter = ["VCP", "Weekly Tight", "Monthly Tight"].includes(filters.chartPattern || '');
  const showHTFFilter = filters.chartPattern === 'High Tight Flag';
  
  const isPullbackSignal = (filters.technicalSignal || '').startsWith('pullback_');
  const is620CrossSignal = filters.technicalSignal === '6_20_cross';
  const isRide21EMASignal = filters.technicalSignal === 'ride_21_ema';
  
  // Check if either section has an active selection (for mutual exclusivity)
  const hasActivePattern = filters.chartPattern && filters.chartPattern !== 'All';
  const hasActiveSignal = filters.technicalSignal && filters.technicalSignal !== 'none';
  
  // Section-specific clear functions
  const clearChartPatternSection = () => {
    setFilters(prev => ({
      ...prev,
      chartPattern: 'All',
      patternStrictness: 'tight',
      maxChannelHeightPct: undefined,
      htfTimeframe: undefined,
      htfMinGainPct: undefined,
      htfPullbackPct: undefined,
    }));
  };
  
  const clearTechnicalSignalSection = () => {
    setFilters(prev => ({
      ...prev,
      technicalSignal: 'none',
      crossDirection: undefined,
      emaBreakThresholdPct: undefined,
      emaPbThresholdPct: undefined,
      pbMinGainPct: undefined,
      pbUpPeriodCandles: undefined,
      pbMinCandles: undefined,
      pbMaxCandles: undefined,
    }));
  };

  const getTimeframe = () => {
    if (filters.chartPattern === "Weekly Tight") return "20D";
    if (filters.chartPattern === "Monthly Tight") return "60D";
    if (filters.chartPattern === "VCP") return "30D";
    if (is620CrossSignal) return "5m";
    return "30D";
  };

  const getTimeframeLabel = () => {
    const tf = getTimeframe();
    if (tf === "5m") return "5 Min";
    if (tf === "20D") return "4 Weeks";
    if (tf === "30D") return "6 Weeks";
    if (tf === "60D") return "3 Months";
    return "Daily";
  };
  
  // Generate detailed search criteria explanations
  const getDetailedCriteria = () => {
    const details: { label: string; value: string; explanation: string }[] = [];
    
    // Stock Universe
    const indexLabels: Record<string, { name: string; count: string }> = {
      'dow30': { name: 'Dow Jones 30', count: '30 blue-chip stocks' },
      'nasdaq100': { name: 'Nasdaq 100', count: '100 tech stocks' },
      'sp100': { name: 'S&P 100', count: '100 mega-cap stocks' },
      'sp500': { name: 'S&P 500', count: '100 top S&P stocks (subset)' },
      'all': { name: 'All Indices', count: '~150 unique stocks' }
    };
    const indexInfo = indexLabels[filters.scannerIndex || 'sp100'] || { name: 'S&P 100', count: '100 stocks' };
    details.push({
      label: 'Stock Universe',
      value: indexInfo.name,
      explanation: `Scanning ${indexInfo.count}`
    });
    
    // Chart Pattern
    if (filters.chartPattern && filters.chartPattern !== 'All') {
      const patternExplanations: Record<string, string> = {
        'VCP': 'Volatility Contraction Pattern - Price consolidates in tightening range with decreasing volume before breakout. Looks for 2+ contractions.',
        'Weekly Tight': 'Price closes within 1.5-3% range over 4-5 consecutive weeks. Indicates accumulation phase.',
        'Monthly Tight': 'Price closes within 5-10% range over 2-3 consecutive months. Major base formation.',
        'High Tight Flag': 'Stock rises 65%+ then consolidates 8-25% in flag pattern. Very powerful continuation setup.',
        'Cup and Handle': 'U-shaped base followed by smaller consolidation handle. Classic breakout pattern.'
      };
      details.push({
        label: 'Chart Pattern',
        value: filters.chartPattern,
        explanation: patternExplanations[filters.chartPattern] || ''
      });
    }
    
    // Pattern Strictness
    if (filters.chartPattern && filters.chartPattern !== 'All') {
      const strictnessExplanations: Record<string, string> = {
        'tight': 'Strict criteria - VCP requires 3+ contractions, Weekly Tight needs 4+ tight weeks, HTF needs 65%+ gain',
        'loose': 'Relaxed criteria - VCP requires 2+ contractions, Weekly Tight needs 3+ tight weeks, allows more variance',
        'both': 'Match either strict OR loose criteria - maximizes potential matches'
      };
      details.push({
        label: 'Pattern Strictness',
        value: filters.patternStrictness === 'tight' ? 'Tight (Strict)' : filters.patternStrictness === 'loose' ? 'Loose (Relaxed)' : 'Both',
        explanation: strictnessExplanations[filters.patternStrictness || 'tight'] || ''
      });
    }
    
    // Max Channel Height
    if (filters.maxChannelHeightPct !== undefined && showChannelHeightFilter) {
      details.push({
        label: 'Max Channel Height',
        value: `${filters.maxChannelHeightPct}%`,
        explanation: `Filter out stocks with consolidation range >>${filters.maxChannelHeightPct}% of average price. Lower = tighter consolidation.`
      });
    }
    
    // Technical Signal
    if (filters.technicalSignal && filters.technicalSignal !== 'none') {
      const signalExplanations: Record<string, string> = {
        '6_20_cross': `6 SMA and 20 SMA crossed ${filters.crossDirection === 'up' ? 'upward (bullish)' : 'downward (bearish)'} within last 3 bars on 5-min chart`,
        'ride_21_ema': `Price has been riding 21 EMA without breaking >${filters.emaBreakThresholdPct || 1}% below, and pulled back >${filters.emaPbThresholdPct || 2.5}% from recent high`,
        'pullback_5_dma': `Stock rose >${filters.pbMinGainPct || 15}% in <${filters.pbUpPeriodCandles || 10} bars, now pulling back to 5 DMA`,
        'pullback_10_dma': `Stock rose >${filters.pbMinGainPct || 15}% in <${filters.pbUpPeriodCandles || 10} bars, now pulling back to 10 DMA`,
        'pullback_20_dma': `Stock rose >${filters.pbMinGainPct || 20}% in <${filters.pbUpPeriodCandles || 15} bars, now pulling back to 20 DMA`,
        'pullback_50_dma': `Stock rose >${filters.pbMinGainPct || 25}% in <${filters.pbUpPeriodCandles || 20} bars, now pulling back to 50 DMA`
      };
      details.push({
        label: 'Technical Signal',
        value: filters.technicalSignal === '6_20_cross' ? `6/20 Cross ${filters.crossDirection === 'up' ? 'Up' : 'Down'}` : 
               filters.technicalSignal === 'ride_21_ema' ? 'Ride 21 EMA' : 
               filters.technicalSignal.replace('pullback_', 'Pullback to ').replace('_dma', ' DMA'),
        explanation: signalExplanations[filters.technicalSignal] || ''
      });
    }
    
    // SMA Filter
    if (filters.smaFilter && filters.smaFilter !== 'none') {
      const smaExplanations: Record<string, string> = {
        'stacked': 'Price > 5d SMA > 20d SMA > 50d SMA > 200d SMA. All moving averages perfectly aligned bullish.',
        'above50_200': 'Price > 50d SMA > 200d SMA. Stock in confirmed uptrend above key support levels.'
      };
      details.push({
        label: 'SMA Filter',
        value: filters.smaFilter === 'stacked' ? 'Stacked SMAs' : 'Above 50/200 SMA',
        explanation: smaExplanations[filters.smaFilter] || ''
      });
    }
    
    // Price Range
    if (filters.minPrice || filters.maxPrice) {
      details.push({
        label: 'Price Range',
        value: filters.minPrice && filters.maxPrice ? `$${filters.minPrice} - $${filters.maxPrice}` : 
               filters.minPrice ? `> $${filters.minPrice}` : `< $${filters.maxPrice}`,
        explanation: 'Filter stocks by current market price. Helps exclude penny stocks or expensive names.'
      });
    }
    
    // Volume
    if (filters.minVolume) {
      details.push({
        label: 'Min Volume',
        value: filters.minVolume >= 1000000 ? `${(filters.minVolume / 1000000).toFixed(1)}M` : `${(filters.minVolume / 1000).toFixed(0)}K`,
        explanation: 'Minimum average daily volume. Ensures adequate liquidity for entry/exit.'
      });
    }
    
    return details;
  };

  const totalResults = results?.length || 0;
  const totalPages = Math.ceil(totalResults / CHARTS_PER_PAGE);
  const startIndex = (currentPage - 1) * CHARTS_PER_PAGE;
  const endIndex = startIndex + CHARTS_PER_PAGE;
  const paginatedResults = results?.slice(startIndex, endIndex) || [];

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Left column: Debug Panel + Scanner Settings side by side */}
        <div className="flex gap-4 shrink-0">
          {/* Detailed Search Criteria Panel - positioned to the left of Scanner Settings */}
          <div className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-24 p-3 border border-white/20 rounded-lg bg-muted/10">
              <p className="text-sm font-semibold text-white/80 mb-3">Detailed Search Criteria</p>
              <ul className="space-y-2 text-xs max-h-[calc(100vh-150px)] overflow-y-auto">
                {getDetailedCriteria().map((item, idx) => (
                  <li key={idx} className="border-b border-white/10 pb-2 last:border-b-0">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-white/60">{item.label}:</span>
                      <span className="text-white font-medium text-right">{item.value}</span>
                    </div>
                    <p className="text-white/40 mt-1 leading-relaxed">{item.explanation}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          
          <div className="w-full lg:w-80 shrink-0">
          <Card 
            className="sticky top-24 border-border shadow-xl shadow-black/5 bg-card/50 backdrop-blur-sm"
          >
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-primary" />
                Scanner Settings
              </CardTitle>
              <CardDescription>
                Define criteria to find trading opportunities.
              </CardDescription>
            </CardHeader>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!isPending) handleScan();
            }}>
            <CardContent className="space-y-6">
              {/* Index Selector */}
              <div className="space-y-2">
                <Label>Stock Universe</Label>
                <Select 
                  value={filters.scannerIndex || "sp100"} 
                  onValueChange={(val: any) => setFilters(prev => ({ ...prev, scannerIndex: val }))}
                >
                  <SelectTrigger className="bg-background" data-testid="select-index">
                    <SelectValue placeholder="Select Index" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dow30">Dow Jones 30</SelectItem>
                    <SelectItem value="nasdaq100">Nasdaq 100</SelectItem>
                    <SelectItem value="sp100">S&P 100</SelectItem>
                    <SelectItem value="sp500">S&P 500</SelectItem>
                    <SelectItem value="all">All Stocks</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              {/* Chart Pattern Box */}
              <div className={`relative space-y-4 p-3 border rounded-lg transition-all ${hasActiveSignal ? 'border-border/50 bg-muted/10 opacity-50 pointer-events-none' : 'border-border bg-muted/20'}`}>
                <p className="text-sm font-semibold text-primary">Chart Pattern</p>
                <div className="space-y-2">
                  <Select 
                    value={filters.chartPattern} 
                    onValueChange={handlePatternChange}
                    disabled={hasActiveSignal}
                  >
                    <SelectTrigger className="bg-background" data-testid="select-chart-pattern">
                      <SelectValue placeholder="Select Chart Pattern" />
                    </SelectTrigger>
                    <SelectContent>
                      {chartPatterns.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

              {showChannelHeightFilter && (
                <div className="space-y-2">
                  <Label>Max Channel Height %</Label>
                  <Input 
                    type="text" 
                    inputMode="decimal"
                    placeholder="e.g. 15" 
                    className="bg-background font-mono"
                    data-testid="input-max-channel-height"
                    value={filters.maxChannelHeightPct ?? ''}
                    onChange={(e) => setFilters(prev => ({ 
                      ...prev, 
                      maxChannelHeightPct: e.target.value === '' ? undefined : parseFloat(e.target.value) || undefined
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Filter stocks by consolidation range. Lower = tighter channel.
                  </p>
                </div>
              )}

              {showHTFFilter && (
                <div className="space-y-4 p-3 border border-border rounded-lg bg-muted/30">
                  <p className="text-sm font-medium">High Tight Flag Criteria</p>
                  <div className="space-y-2">
                    <Label>Timeframe</Label>
                    <Select 
                      value={filters.htfTimeframe || "weekly"} 
                      onValueChange={(val: any) => setFilters(prev => ({ ...prev, htfTimeframe: val }))}
                    >
                      <SelectTrigger className="bg-background" data-testid="select-htf-timeframe">
                        <SelectValue placeholder="Select Timeframe" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly (2-8 bars lift, 2-8 bars PB)</SelectItem>
                        <SelectItem value="daily">Daily (3-10 bars lift, 2-6 bars PB)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Price Lift % (min)</Label>
                    <Input 
                      type="text" 
                      inputMode="decimal"
                      placeholder="65" 
                      className="bg-background font-mono"
                      data-testid="input-htf-min-gain"
                      value={filters.htfMinGainPct ?? ''}
                      onChange={(e) => setFilters(prev => ({ 
                        ...prev, 
                        htfMinGainPct: e.target.value === '' ? undefined : parseFloat(e.target.value) || undefined
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Pullback % (max)</Label>
                    <Input 
                      type="text" 
                      inputMode="decimal"
                      placeholder="8" 
                      className="bg-background font-mono"
                      data-testid="input-htf-pullback"
                      value={filters.htfPullbackPct ?? ''}
                      onChange={(e) => setFilters(prev => ({ 
                        ...prev, 
                        htfPullbackPct: e.target.value === '' ? undefined : parseFloat(e.target.value) || undefined
                      }))}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Stock must gain at least the lift %, then consolidate within the pullback %.
                  </p>
                </div>
              )}

                <div className="space-y-2">
                  <Label>Pattern Strictness</Label>
                  <Select 
                    value={filters.patternStrictness} 
                    onValueChange={(val: any) => setFilters(prev => ({ ...prev, patternStrictness: val }))}
                    disabled={hasActiveSignal}
                  >
                    <SelectTrigger className="bg-background" data-testid="select-strictness">
                      <SelectValue placeholder="Select Strictness" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tight">Tight (Strict)</SelectItem>
                      <SelectItem value="loose">Loose (Relaxed)</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Loose rules allow more variance for better match chances.
                  </p>
                </div>
                
                {/* Section Clear Link */}
                {hasActivePattern && (
                  <button 
                    onClick={clearChartPatternSection}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    data-testid="button-clear-pattern"
                  >
                    [Clear]
                  </button>
                )}
              </div>
              
              {/* OR Divider */}
              <div className="relative flex items-center justify-center py-2">
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
                <span className="relative bg-card px-3 py-1 text-sm font-bold text-primary border border-primary/30 rounded-md">
                  OR
                </span>
              </div>

              {/* Technical Indicator Signals Box */}
              <div className={`relative space-y-4 p-3 border rounded-lg transition-all ${hasActivePattern ? 'border-border/50 bg-muted/10 opacity-50 pointer-events-none' : 'border-border bg-muted/20'}`}>
                <p className="text-sm font-semibold text-primary">Technical Indicator Signals</p>
                <div className="space-y-2">
                  <Select 
                    value={filters.technicalSignal || "none"} 
                    onValueChange={(val: any) => setFilters(prev => ({ 
                      ...prev, 
                      technicalSignal: val,
                      crossDirection: val === '6_20_cross' ? 'up' : prev.crossDirection
                    }))}
                  >
                    <SelectTrigger className="bg-background" data-testid="select-technical-signal">
                      <SelectValue placeholder="Select Signal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="6_20_cross">6/20 Cross</SelectItem>
                      <SelectItem value="ride_21_ema">Ride the 21 EMA</SelectItem>
                      <SelectItem value="pullback_5_dma">Pullback to 5 DMA</SelectItem>
                      <SelectItem value="pullback_10_dma">Pullback to 10 DMA</SelectItem>
                      <SelectItem value="pullback_20_dma">Pullback to 20 DMA</SelectItem>
                      <SelectItem value="pullback_50_dma">Pullback to 50 DMA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 6/20 Cross Settings */}
                {is620CrossSignal && (
                  <div className="space-y-2 p-3 border border-border rounded-lg bg-muted/30">
                    <Label>Cross Direction</Label>
                    <Select 
                      value={filters.crossDirection || "up"} 
                      onValueChange={(val: any) => setFilters(prev => ({ ...prev, crossDirection: val }))}
                    >
                      <SelectTrigger className="bg-background" data-testid="select-cross-direction">
                        <SelectValue placeholder="Select Direction" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="up">Cross Up</SelectItem>
                        <SelectItem value="down">Cross Down</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      6 SMA and 20 SMA crossed within last 3 bars on 5-min chart.
                    </p>
                  </div>
                )}

                {/* Ride the 21 EMA Settings */}
                {isRide21EMASignal && (
                  <div className="space-y-3 p-3 border border-border rounded-lg bg-muted/30">
                    <div className="space-y-2">
                      <Label>Breaks through EMA ≤ (%)</Label>
                      <Input 
                        type="text" 
                        inputMode="decimal"
                        placeholder="1" 
                        className="bg-background font-mono"
                        data-testid="input-ema-break"
                        value={filters.emaBreakThresholdPct ?? ''}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          emaBreakThresholdPct: e.target.value === '' ? undefined : parseFloat(e.target.value) || undefined
                        }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>PB of EMA for Signal &gt; (%)</Label>
                      <Input 
                        type="text" 
                        inputMode="decimal"
                        placeholder="2.5" 
                        className="bg-background font-mono"
                        data-testid="input-ema-pb"
                        value={filters.emaPbThresholdPct ?? ''}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          emaPbThresholdPct: e.target.value === '' ? undefined : parseFloat(e.target.value) || undefined
                        }))}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Price rides 21 EMA without breaking by more than the threshold.
                    </p>
                  </div>
                )}

                {/* Pullback Settings */}
                {isPullbackSignal && (
                  <div className="space-y-3 p-3 border border-border rounded-lg bg-muted/30">
                    <p className="text-sm font-medium">Pullback Criteria</p>
                    <div className="space-y-2">
                      <Label>Min % Up Before Pullback</Label>
                      <Input 
                        type="text" 
                        inputMode="decimal"
                        placeholder="e.g. 15" 
                        className="bg-background font-mono"
                        data-testid="input-pb-min-gain"
                        value={filters.pbMinGainPct ?? ''}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          pbMinGainPct: e.target.value === '' ? undefined : parseFloat(e.target.value) || undefined
                        }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Up period was under (candles)</Label>
                      <Input 
                        type="text" 
                        inputMode="numeric"
                        placeholder="e.g. 10" 
                        className="bg-background font-mono"
                        data-testid="input-pb-up-period"
                        value={filters.pbUpPeriodCandles ?? ''}
                        onChange={(e) => setFilters(prev => ({ 
                          ...prev, 
                          pbUpPeriodCandles: e.target.value === '' ? undefined : parseInt(e.target.value) || undefined
                        }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>PB was between X and Y candles</Label>
                      <div className="flex gap-2 items-center">
                        <Input 
                          type="text" 
                          inputMode="numeric"
                          placeholder="1" 
                          className="bg-background font-mono w-20"
                          data-testid="input-pb-min-candles"
                          value={filters.pbMinCandles ?? ''}
                          onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            pbMinCandles: e.target.value === '' ? undefined : parseInt(e.target.value) || undefined
                          }))}
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input 
                          type="text" 
                          inputMode="numeric"
                          placeholder="5" 
                          className="bg-background font-mono w-20"
                          data-testid="input-pb-max-candles"
                          value={filters.pbMaxCandles ?? ''}
                          onChange={(e) => setFilters(prev => ({ 
                            ...prev, 
                            pbMaxCandles: e.target.value === '' ? undefined : parseInt(e.target.value) || undefined
                          }))}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Stock must have risen at least this % over N candles before pulling back to the MA.
                    </p>
                  </div>
                )}
                
                {/* Section Clear Link */}
                {hasActiveSignal && (
                  <button 
                    onClick={clearTechnicalSignalSection}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                    data-testid="button-clear-signal"
                  >
                    [Clear]
                  </button>
                )}
              </div>
              
              {/* AND Divider */}
              <div className="relative flex items-center justify-center py-2">
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/50" />
                <span className="relative bg-card px-3 py-1 text-sm font-bold text-green-500 border border-green-500/30 rounded-md">
                  AND
                </span>
              </div>
              
              {/* Additional Filters Box */}
              <div className="space-y-4 p-3 border border-border rounded-lg bg-muted/20">
                <p className="text-sm font-semibold text-muted-foreground">Additional Filters</p>

              <div className="space-y-3">
                <Label>SMA Filter</Label>
                <RadioGroup 
                  value={filters.smaFilter || "none"} 
                  onValueChange={(val: any) => setFilters(prev => ({ ...prev, smaFilter: val }))}
                  className="space-y-2"
                  data-testid="radio-sma-filter"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="none" id="sma-none" data-testid="radio-sma-none" />
                    <Label htmlFor="sma-none" className="text-sm font-normal cursor-pointer">
                      No SMA Restriction
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="stacked" id="sma-stacked" data-testid="radio-sma-stacked" />
                    <Label htmlFor="sma-stacked" className="text-sm font-normal cursor-pointer">
                      Price &gt; 5d &gt; 20d &gt; 50d &gt; 200d SMA
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="above50_200" id="sma-above" data-testid="radio-sma-above" />
                    <Label htmlFor="sma-above" className="text-sm font-normal cursor-pointer">
                      Price &gt; 50d &gt; 200d SMA
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label>Price Within % of 50d SMA</Label>
                <Input 
                  type="number" 
                  step="0.1"
                  placeholder="e.g. 2.5" 
                  className="bg-background font-mono"
                  data-testid="input-price-proximity"
                  onChange={(e) => setFilters(prev => ({ 
                    ...prev, 
                    priceWithin50dPct: e.target.value ? Number(e.target.value) : undefined 
                  }))}
                />
                <p className="text-xs text-muted-foreground">
                  Filter stocks where current price is within X% of 50-day SMA.
                </p>
              </div>

              <div className="space-y-4">
                <Label>Price Range ($)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    placeholder="Min" 
                    className="bg-background font-mono"
                    data-testid="input-min-price"
                    value={filters.minPrice ?? ''}
                    onChange={(e) => setFilters(prev => ({ ...prev, minPrice: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                  <Input 
                    type="number" 
                    placeholder="Max" 
                    className="bg-background font-mono"
                    data-testid="input-max-price"
                    value={filters.maxPrice ?? ''}
                    onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Min Volume</Label>
                <Input 
                  type="number" 
                  placeholder="e.g. 1000000" 
                  className="bg-background font-mono"
                  data-testid="input-min-volume"
                  value={filters.minVolume ?? ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, minVolume: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </div>
              </div>

              <Button 
                type="submit"
                className="w-full font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all" 
                size="lg"
                disabled={isPending}
                data-testid="button-run-scan"
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                Run Scan
              </Button>
            </CardContent>
            </form>
          </Card>
          </div>
        </div>

        <div className="flex-1 w-full space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-bold tracking-tight">Scan Results</h2>
                {hasScanned && (
                  <span className={`text-sm ${getThumbnailIndicatorLabel().color}`}>
                    ({getThumbnailIndicatorLabel().text})
                  </span>
                )}
              </div>
              {results && (
                <span className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full font-mono">
                  {results.length} matches found
                </span>
              )}
            </div>
            
            {/* Criteria summary with Clear All and Save Scan buttons - only show after first scan */}
            {hasScanned && getCriteriaSummary().length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-white/80">
                  {getCriteriaSummary().join(' • ')}
                </span>
                <button 
                  onClick={clearAll}
                  className="text-sm font-bold text-primary hover:text-primary/80 transition-colors"
                  data-testid="button-clear-criteria"
                >
                  [Clear All]
                </button>
                <button 
                  onClick={() => setShowSaveDialog(true)}
                  className="text-sm font-bold text-green-400 hover:text-green-300 transition-colors"
                  data-testid="button-save-scan"
                >
                  [Save Scan]
                </button>
              </div>
            )}
          </div>

          {!results && !isPending && (
            <div className="border-2 border-dashed border-border rounded-xl p-12 text-center bg-card/30">
              <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-foreground">Ready to Scan</h3>
              <p className="text-muted-foreground">Adjust filters on the left and click "Run Scan" to find stocks.</p>
            </div>
          )}

          {isPending && (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <p className="text-muted-foreground animate-pulse">Analyzing market data...</p>
            </div>
          )}

          {results && results.length === 0 && (
            <div className="bg-card border border-border rounded-xl p-8 text-center">
              <p className="text-muted-foreground">No stocks matched your criteria.</p>
            </div>
          )}

          {results && results.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paginatedResults.map((stock) => {
                  const isPositive = stock.changePercent >= 0;
                  return (
                    <Card 
                      key={stock.symbol}
                      className="cursor-pointer hover-elevate transition-all"
                      onClick={() => {
                        const params = new URLSearchParams();
                        params.set('fromScanner', 'true');
                        if (filters.chartPattern && filters.chartPattern !== 'All') {
                          params.set('pattern', filters.chartPattern);
                          // Monthly Tight should open weekly chart
                          if (filters.chartPattern === 'Monthly Tight') {
                            params.set('interval', '1wk');
                          }
                        }
                        if (filters.technicalSignal && filters.technicalSignal !== 'none') {
                          params.set('technicalSignal', filters.technicalSignal);
                          if (filters.crossDirection) {
                            params.set('crossDirection', filters.crossDirection);
                          }
                          // Pass pullback up period for chart zoom calculation
                          if (filters.technicalSignal.startsWith('pullback_') && filters.pbUpPeriodCandles) {
                            params.set('pbUpPeriodCandles', filters.pbUpPeriodCandles.toString());
                          }
                        }
                        setLocation(`/symbol/${stock.symbol}?${params.toString()}`);
                      }}
                      data-testid={`card-stock-${stock.symbol}`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span 
                              className="font-bold font-mono text-xl text-primary"
                              data-testid={`text-ticker-${stock.symbol}`}
                            >
                              {stock.symbol}
                            </span>
                            <span 
                              className="font-mono text-lg"
                              data-testid={`text-price-${stock.symbol}`}
                            >
                              ${stock.price.toFixed(2)}
                            </span>
                            <span 
                              className={`flex items-center gap-1 text-sm font-mono ${isPositive ? "text-green-500" : "text-red-500"}`}
                              data-testid={`text-change-${stock.symbol}`}
                            >
                              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {stock.changePercent.toFixed(2)}%
                            </span>
                          </div>
                          <span 
                            className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded"
                            data-testid={`text-timeframe-${stock.symbol}`}
                          >
                            {getTimeframeLabel()}
                          </span>
                        </div>
                        {stock.matchedPattern && (
                          <div className="flex items-center gap-2 flex-wrap mt-1">
                            <span 
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-black dark:border-green-600"
                              data-testid={`badge-pattern-${stock.symbol}`}
                            >
                              {stock.matchedPattern}
                            </span>
                            {stock.completionPct !== undefined && stock.matchedPattern?.includes('Cup and Handle') && (
                              <span 
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-600"
                                data-testid={`badge-completion-${stock.symbol}`}
                              >
                                {stock.completionPct}% complete
                              </span>
                            )}
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="pt-0">
                        <MiniChart 
                          symbol={stock.symbol} 
                          technicalSignal={filters.technicalSignal}
                          crossDirection={filters.crossDirection}
                          chartPattern={filters.chartPattern}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground font-mono">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    data-testid="button-next-page"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Save Scan Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Save Scan</h3>
              <button 
                onClick={() => setShowSaveDialog(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="scan-name">Scan Name</Label>
                <Input
                  id="scan-name"
                  value={scanName}
                  onChange={(e) => setScanName(e.target.value)}
                  placeholder={generateScanTitle()}
                  className="mt-1"
                  data-testid="input-scan-name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveScan();
                  }}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank to use auto-generated name
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSaveScan} 
                  disabled={saveScanMutation.isPending}
                  data-testid="button-confirm-save"
                >
                  {saveScanMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
