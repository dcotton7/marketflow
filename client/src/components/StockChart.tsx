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
  ReferenceLine
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
      <div className="mb-4 flex justify-between items-center">
        <h3 className="font-semibold text-gray-900">Price History</h3>
        <div className="flex gap-4 items-center">
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
