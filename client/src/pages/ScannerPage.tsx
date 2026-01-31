import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useScanner } from "@/hooks/use-stocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useLocation } from "wouter";
import { Loader2, Search, Filter, ChevronLeft, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MiniChart } from "@/components/MiniChart";
import { type ScannerRunInput } from "@shared/routes";

const CHARTS_PER_PAGE = 10;

export default function ScannerPage() {
  const [, setLocation] = useLocation();
  const { mutate: runScan, data: results, isPending } = useScanner();
  const [currentPage, setCurrentPage] = useState(1);

  const [filters, setFilters] = useState<ScannerRunInput>({
    minPrice: undefined,
    maxPrice: undefined,
    minVolume: undefined,
    candlestickPattern: "All",
    chartPattern: "All",
    patternStrictness: "tight",
    smaFilter: "none",
    priceWithin50dPct: undefined,
  });

  const handleScan = () => {
    setCurrentPage(1);
    runScan(filters);
  };

  const candlestickPatterns = ["All", "Doji", "Hammer", "Bullish Engulfing", "Bearish Engulfing", "Morning Star"];
  const chartPatterns = ["All", "VCP", "Weekly Tight", "Monthly Tight"];

  // Determine timeframe based on selected pattern (match detection windows)
  const getTimeframe = () => {
    if (filters.chartPattern === "Weekly Tight") return "20D"; // 20 trading days
    if (filters.chartPattern === "Monthly Tight") return "60D"; // 60 trading days
    if (filters.chartPattern === "VCP") return "30D"; // 30 trading days
    return "30D"; // Default
  };

  const getTimeframeLabel = () => {
    const tf = getTimeframe();
    if (tf === "20D") return "4 Weeks";
    if (tf === "30D") return "6 Weeks";
    if (tf === "60D") return "3 Months";
    return "Daily";
  };

  // Pagination logic
  const totalResults = results?.length || 0;
  const totalPages = Math.ceil(totalResults / CHARTS_PER_PAGE);
  const startIndex = (currentPage - 1) * CHARTS_PER_PAGE;
  const endIndex = startIndex + CHARTS_PER_PAGE;
  const paginatedResults = results?.slice(startIndex, endIndex) || [];

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="w-full lg:w-80 shrink-0">
          <Card className="sticky top-24 border-border shadow-xl shadow-black/5 bg-card/50 backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-primary" />
                Scanner Settings
              </CardTitle>
              <CardDescription>
                Define criteria to find trading opportunities.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Candlestick Pattern</Label>
                <Select 
                  value={filters.candlestickPattern} 
                  onValueChange={(val: any) => setFilters(prev => ({ ...prev, candlestickPattern: val }))}
                >
                  <SelectTrigger className="bg-background" data-testid="select-candlestick-pattern">
                    <SelectValue placeholder="Select Pattern" />
                  </SelectTrigger>
                  <SelectContent>
                    {candlestickPatterns.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Chart Pattern</Label>
                <Select 
                  value={filters.chartPattern} 
                  onValueChange={(val: any) => setFilters(prev => ({ ...prev, chartPattern: val }))}
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

              <div className="space-y-2">
                <Label>Pattern Strictness</Label>
                <Select 
                  value={filters.patternStrictness} 
                  onValueChange={(val: any) => setFilters(prev => ({ ...prev, patternStrictness: val }))}
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
                    onChange={(e) => setFilters(prev => ({ ...prev, minPrice: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                  <Input 
                    type="number" 
                    placeholder="Max" 
                    className="bg-background font-mono"
                    data-testid="input-max-price"
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
                  onChange={(e) => setFilters(prev => ({ ...prev, minVolume: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </div>

              <Button 
                className="w-full font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all" 
                size="lg"
                onClick={handleScan}
                disabled={isPending}
                data-testid="button-run-scan"
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                Run Scan
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="flex-1 w-full space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Scan Results</h2>
            {results && (
              <span className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full font-mono">
                {results.length} matches found
              </span>
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
                      onClick={() => setLocation(`/symbol/${stock.symbol}`)}
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
                          <span 
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-black dark:border-green-600 w-fit mt-1"
                            data-testid={`badge-pattern-${stock.symbol}`}
                          >
                            {stock.matchedPattern}
                          </span>
                        )}
                      </CardHeader>
                      <CardContent className="pt-0">
                        <MiniChart symbol={stock.symbol} timeframe={getTimeframe()} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

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
                  <span 
                    className="text-sm text-muted-foreground font-mono"
                    data-testid="text-pagination"
                  >
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
    </Layout>
  );
}
