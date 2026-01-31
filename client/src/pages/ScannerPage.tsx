import { useState } from "react";
import { Layout } from "@/components/Layout";
import { useScanner } from "@/hooks/use-stocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Loader2, Search, Filter, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { type ScannerRunInput } from "@shared/routes";

export default function ScannerPage() {
  const [, setLocation] = useLocation();
  const { mutate: runScan, data: results, isPending } = useScanner();

  // Form State
  const [filters, setFilters] = useState<ScannerRunInput>({
    minPrice: undefined,
    maxPrice: undefined,
    minVolume: undefined,
    pattern: "All",
  });

  const handleScan = () => {
    runScan(filters);
  };

  const patterns = ["All", "Doji", "Hammer", "Bullish Engulfing", "Bearish Engulfing", "Morning Star"];

  return (
    <Layout>
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Scanner Controls Sidebar */}
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
                <Label>Pattern Type</Label>
                <Select 
                  value={filters.pattern} 
                  onValueChange={(val: any) => setFilters(prev => ({ ...prev, pattern: val }))}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select Pattern" />
                  </SelectTrigger>
                  <SelectContent>
                    {patterns.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-4">
                <Label>Price Range ($)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    placeholder="Min" 
                    className="bg-background font-mono"
                    onChange={(e) => setFilters(prev => ({ ...prev, minPrice: e.target.value ? Number(e.target.value) : undefined }))}
                  />
                  <Input 
                    type="number" 
                    placeholder="Max" 
                    className="bg-background font-mono"
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
                  onChange={(e) => setFilters(prev => ({ ...prev, minVolume: e.target.value ? Number(e.target.value) : undefined }))}
                />
              </div>

              <Button 
                className="w-full font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all" 
                size="lg"
                onClick={handleScan}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                Run Scan
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Results Area */}
        <div className="flex-1 w-full space-y-6">
          <div className="flex items-center justify-between">
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
            <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground text-xs uppercase font-medium">
                    <tr>
                      <th className="px-6 py-4">Symbol</th>
                      <th className="px-6 py-4 text-right">Price</th>
                      <th className="px-6 py-4 text-right">Change</th>
                      <th className="px-6 py-4 text-right">Volume</th>
                      <th className="px-6 py-4">Pattern</th>
                      <th className="px-6 py-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {results.map((stock) => {
                      const isPositive = stock.changePercent >= 0;
                      return (
                        <tr 
                          key={stock.symbol} 
                          className="hover:bg-muted/30 transition-colors group cursor-pointer"
                          onClick={() => setLocation(`/symbol/${stock.symbol}`)}
                        >
                          <td className="px-6 py-4 font-bold font-mono text-primary group-hover:text-primary/80">
                            {stock.symbol}
                          </td>
                          <td className="px-6 py-4 text-right font-mono">
                            ${stock.price.toFixed(2)}
                          </td>
                          <td className={`px-6 py-4 text-right font-mono font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
                            <div className="flex items-center justify-end gap-1">
                              {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              {stock.changePercent.toFixed(2)}%
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-mono text-muted-foreground">
                            {(stock.volume / 1000000).toFixed(2)}M
                          </td>
                          <td className="px-6 py-4">
                            {stock.matchedPattern ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                {stock.matchedPattern}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
