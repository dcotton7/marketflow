import { useStockHistory } from "@/hooks/use-stocks";
import { Loader2 } from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceArea
} from "recharts";
import { format } from "date-fns";

interface StockChartProps {
  symbol: string;
}

// Calculate Simple Moving Average
function calculateSMA(data: { close: number }[], period: number): (number | null)[] {
  const sma: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((acc, item) => acc + item.close, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

interface ConsolidationChannel {
  startDate: string;
  endDate: string;
  high: number;
  low: number;
  type: 'VCP' | 'Weekly Tight' | 'Monthly Tight';
}

// Detect consolidation channels for visualization
function detectConsolidationChannels(
  data: { date: string; high: number; low: number; close: number; volume: number }[]
): ConsolidationChannel[] {
  const channels: ConsolidationChannel[] = [];
  
  if (data.length < 5) return channels;
  
  // Weekly Tight: Last 20 trading days (1-4 weeks)
  const weeklyData = data.slice(-20);
  if (weeklyData.length >= 5) {
    const weeklyHigh = Math.max(...weeklyData.map(c => c.high));
    const weeklyLow = Math.min(...weeklyData.map(c => c.low));
    const avgPrice = weeklyData.reduce((sum, c) => sum + c.close, 0) / weeklyData.length;
    const rangePercent = ((weeklyHigh - weeklyLow) / avgPrice) * 100;
    
    if (rangePercent <= 12) { // Loose threshold
      channels.push({
        startDate: weeklyData[0].date,
        endDate: weeklyData[weeklyData.length - 1].date,
        high: weeklyHigh,
        low: weeklyLow,
        type: 'Weekly Tight'
      });
    }
  }
  
  // Monthly Tight: Last 60 trading days (3 months)
  if (data.length >= 20) {
    const monthlyData = data.slice(-60);
    if (monthlyData.length >= 20) {
      const monthlyHigh = Math.max(...monthlyData.map(c => c.high));
      const monthlyLow = Math.min(...monthlyData.map(c => c.low));
      const avgPrice = monthlyData.reduce((sum, c) => sum + c.close, 0) / monthlyData.length;
      const rangePercent = ((monthlyHigh - monthlyLow) / avgPrice) * 100;
      
      // Only add if not overlapping with weekly tight or if it's different range
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
  
  // VCP: Last 30 trading days with contracting ranges
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
    
    // Check for contraction
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
  
  return channels;
}

export function StockChart({ symbol }: StockChartProps) {
  const { data: history, isLoading, error } = useStockHistory(symbol);

  if (isLoading) {
    return (
      <div className="h-[400px] w-full flex items-center justify-center bg-white rounded-xl border border-gray-200">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !history) {
    return (
      <div className="h-[400px] w-full flex items-center justify-center bg-white rounded-xl border border-gray-200 text-gray-500">
        Failed to load chart data
      </div>
    );
  }

  // Calculate SMAs
  const sma20 = calculateSMA(history, 20);
  const sma50 = calculateSMA(history, 50);
  const sma200 = calculateSMA(history, 200);

  // Detect consolidation channels
  const channels = detectConsolidationChannels(history);

  // Format data for Recharts with SMAs
  const chartData = history.map((item, index) => ({
    ...item,
    bodyMin: Math.min(item.open, item.close),
    bodyHeight: Math.abs(item.open - item.close),
    color: item.close >= item.open ? "#22c55e" : "#ef4444",
    volumeColor: item.close >= item.open ? "#22c55e" : "#ef4444",
    sma20: sma20[index],
    sma50: sma50[index],
    sma200: sma200[index],
  }));

  // Get price domain
  const allPrices = history.flatMap(d => [d.high, d.low]);
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const priceRange = maxPrice - minPrice;
  const pricePadding = priceRange * 0.05;

  // Get volume domain
  const maxVolume = Math.max(...history.map(d => d.volume));

  // Helper for tooltip date formatting
  const formatDate = (dateStr: string) => format(new Date(dateStr), "MMM dd, yyyy");

  // Custom Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border p-3 rounded-lg shadow-xl">
          <p className="text-muted-foreground text-xs mb-2">{formatDate(label)}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono">
            <span className="text-muted-foreground">Open:</span>
            <span className="text-right">{data.open.toFixed(2)}</span>
            <span className="text-muted-foreground">High:</span>
            <span className="text-right">{data.high.toFixed(2)}</span>
            <span className="text-muted-foreground">Low:</span>
            <span className="text-right">{data.low.toFixed(2)}</span>
            <span className="text-muted-foreground">Close:</span>
            <span className={data.close >= data.open ? "text-green-500 text-right" : "text-red-500 text-right"}>
              {data.close.toFixed(2)}
            </span>
            <span className="text-muted-foreground mt-2">Vol:</span>
            <span className="text-right mt-2">{(data.volume / 1000000).toFixed(1)}M</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
      <div className="mb-4 flex justify-between items-center flex-wrap gap-2">
        <h3 className="font-semibold text-gray-900">Price History</h3>
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-pink-500 inline-block"></span>
              <span className="text-gray-600">SMA 20</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-red-600 inline-block"></span>
              <span className="text-gray-600">SMA 50</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-black inline-block"></span>
              <span className="text-gray-600">SMA 200</span>
            </span>
          </div>
          {channels.length > 0 && (
            <div className="flex gap-2 text-xs">
              {channels.map((ch, i) => (
                <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded border border-black bg-green-100">
                  <span className="text-gray-700 font-medium">{ch.type}</span>
                </span>
              ))}
            </div>
          )}
          <span className="text-xs text-gray-500 font-mono">Daily</span>
        </div>
      </div>
      
      {/* Price Chart */}
      <div className="h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} opacity={0.5} />
            <XAxis 
              dataKey="date" 
              tickFormatter={(val) => format(new Date(val), "MMM dd")}
              stroke="#9ca3af"
              tick={{ fontSize: 10 }}
              tickMargin={8}
              axisLine={false}
              hide
            />
            <YAxis 
              domain={[minPrice - pricePadding, maxPrice + pricePadding]}
              stroke="#9ca3af"
              tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickFormatter={(val) => val.toFixed(0)}
              width={50}
              orientation="right"
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#9ca3af', strokeWidth: 1, strokeDasharray: '4 4' }} />
            
            {/* Consolidation Channel Overlays */}
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
                strokeDasharray="0"
              />
            ))}
            
            {/* Candlestick bars */}
            <Bar 
              dataKey={(item) => [item.open, item.close]} 
              fill="currentColor"
              isAnimationActive={false}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>

            {/* SMA Lines */}
            <Line 
              type="monotone" 
              dataKey="sma20" 
              stroke="#ec4899" 
              dot={false} 
              strokeWidth={1.5}
              connectNulls={false}
            />
            <Line 
              type="monotone" 
              dataKey="sma50" 
              stroke="#dc2626" 
              dot={false} 
              strokeWidth={1.5}
              connectNulls={false}
            />
            <Line 
              type="monotone" 
              dataKey="sma200" 
              stroke="#000000" 
              dot={false} 
              strokeWidth={1.5}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Volume Chart */}
      <div className="h-[80px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <XAxis 
              dataKey="date" 
              tickFormatter={(val) => format(new Date(val), "MMM dd")}
              stroke="#9ca3af"
              tick={{ fontSize: 9 }}
              tickMargin={5}
              axisLine={false}
            />
            <YAxis 
              domain={[0, maxVolume * 1.1]}
              stroke="#9ca3af"
              tick={{ fontSize: 9 }}
              axisLine={false}
              tickFormatter={(val) => `${(val / 1000000).toFixed(0)}M`}
              width={50}
              orientation="right"
            />
            <Bar 
              dataKey="volume" 
              isAnimationActive={false}
            >
              {chartData.map((entry, index) => (
                <Cell key={`vol-${index}`} fill={entry.volumeColor} opacity={0.6} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
