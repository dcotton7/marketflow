import { useStockHistory } from "@/hooks/use-stocks";
import { Loader2 } from "lucide-react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  ReferenceArea
} from "recharts";

interface MiniChartProps {
  symbol: string;
  timeframe: string;
}

interface ConsolidationChannel {
  startDate: string;
  endDate: string;
  high: number;
  low: number;
  type: string;
}

function detectConsolidationChannels(
  data: { date: string; high: number; low: number; close: number; volume: number }[],
  patternTimeframe: string
): ConsolidationChannel[] {
  const channels: ConsolidationChannel[] = [];
  
  if (data.length < 5) return channels;
  
  if (patternTimeframe === '20D' || patternTimeframe === 'all') {
    const weeklyData = data.slice(-20);
    if (weeklyData.length >= 5) {
      const weeklyHigh = Math.max(...weeklyData.map(c => c.high));
      const weeklyLow = Math.min(...weeklyData.map(c => c.low));
      const avgPrice = weeklyData.reduce((sum, c) => sum + c.close, 0) / weeklyData.length;
      const rangePercent = ((weeklyHigh - weeklyLow) / avgPrice) * 100;
      
      if (rangePercent <= 12) {
        channels.push({
          startDate: weeklyData[0].date,
          endDate: weeklyData[weeklyData.length - 1].date,
          high: weeklyHigh,
          low: weeklyLow,
          type: 'Weekly Tight'
        });
      }
    }
  }
  
  if (patternTimeframe === '60D' || patternTimeframe === 'all') {
    if (data.length >= 20) {
      const monthlyData = data.slice(-60);
      if (monthlyData.length >= 20) {
        const monthlyHigh = Math.max(...monthlyData.map(c => c.high));
        const monthlyLow = Math.min(...monthlyData.map(c => c.low));
        const avgPrice = monthlyData.reduce((sum, c) => sum + c.close, 0) / monthlyData.length;
        const rangePercent = ((monthlyHigh - monthlyLow) / avgPrice) * 100;
        
        if (rangePercent <= 22 && !channels.some(c => c.type === 'Weekly Tight' && 
            Math.abs(c.high - monthlyHigh) < 1 && Math.abs(c.low - monthlyLow) < 1)) {
          channels.push({
            startDate: monthlyData[0].date,
            endDate: monthlyData[monthlyData.length - 1].date,
            high: monthlyHigh,
            low: monthlyLow,
            type: 'Monthly Tight'
          });
        }
      }
    }
  }
  
  if (patternTimeframe === '30D' || patternTimeframe === 'all') {
    if (data.length >= 30) {
      const vcpData = data.slice(-30);
      const period1 = vcpData.slice(0, 10);
      const period3 = vcpData.slice(20, 30);
      
      const getRange = (c: typeof period1) => {
        const maxHigh = Math.max(...c.map(x => x.high));
        const minLow = Math.min(...c.map(x => x.low));
        const avgPrice = c.reduce((sum, x) => sum + x.close, 0) / c.length;
        return (maxHigh - minLow) / avgPrice;
      };
      
      const range1 = getRange(period1);
      const range3 = getRange(period3);
      
      if (range3 < range1) {
        const vcpHigh = Math.max(...period3.map(c => c.high));
        const vcpLow = Math.min(...period3.map(c => c.low));
        
        channels.push({
          startDate: period3[0].date,
          endDate: period3[period3.length - 1].date,
          high: vcpHigh,
          low: vcpLow,
          type: 'VCP'
        });
      }
    }
  }
  
  return channels;
}

export function MiniChart({ symbol, timeframe }: MiniChartProps) {
  const { data: history, isLoading, error } = useStockHistory(symbol);

  if (isLoading) {
    return (
      <div 
        className="h-[180px] w-full flex items-center justify-center bg-card rounded-lg border border-border"
        data-testid={`chart-loading-${symbol}`}
      >
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !history || history.length === 0) {
    return (
      <div 
        className="h-[180px] w-full flex items-center justify-center bg-card rounded-lg border border-border text-muted-foreground text-sm"
        data-testid={`chart-error-${symbol}`}
      >
        No data
      </div>
    );
  }

  let displayDays = 90;
  let patternTimeframe = 'all';
  
  if (timeframe === '20D') {
    displayDays = 60;
    patternTimeframe = '20D';
  } else if (timeframe === '30D') {
    displayDays = 90;
    patternTimeframe = '30D';
  } else if (timeframe === '60D') {
    displayDays = 120;
    patternTimeframe = '60D';
  }

  const slicedHistory = history.slice(-displayDays);
  const channels = detectConsolidationChannels(slicedHistory, patternTimeframe);

  const chartData = slicedHistory.map((item) => ({
    ...item,
    color: item.close >= item.open ? "#22c55e" : "#ef4444",
  }));

  const allPrices = slicedHistory.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  const pricePadding = priceRange * 0.05;

  return (
    <div 
      className="h-[180px] w-full bg-card rounded-lg border border-border p-2"
      data-testid={`chart-${symbol}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <XAxis dataKey="date" hide />
          <YAxis 
            domain={[minPrice - pricePadding, maxPrice + pricePadding]}
            hide
          />
          
          {channels.map((channel, index) => (
            <ReferenceArea
              key={`channel-${index}`}
              x1={channel.startDate}
              x2={channel.endDate}
              y1={channel.low}
              y2={channel.high}
              fill="#86efac"
              fillOpacity={0.4}
              stroke="#000000"
              strokeWidth={2}
            />
          ))}
          
          <Bar 
            dataKey={(item) => [item.open, item.close]} 
            fill="currentColor"
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
