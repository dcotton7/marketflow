import { z } from 'zod';
import { insertScanSchema, insertWatchlistSchema, savedScans, watchlistItems } from './schema';

// ============================================
// SHARED ERROR SCHEMAS
// ============================================
export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

// ============================================
// API CONTRACT
// ============================================
export const api = {
  stocks: {
    history: {
      method: 'GET' as const,
      path: '/api/stocks/:symbol/history',
      queryParams: z.object({
        interval: z.enum(['5m', '15m', '30m', '60m', '1d', '1wk', '1mo']).optional(),
        period: z.enum(['1mo', '3mo', '6mo', '1y', '2y']).optional(),
      }).optional(),
      responses: {
        200: z.array(z.object({
          date: z.string(),
          open: z.number(),
          high: z.number(),
          low: z.number(),
          close: z.number(),
          volume: z.number(),
        })),
        404: errorSchemas.notFound,
      },
    },
    quote: {
      method: 'GET' as const,
      path: '/api/stocks/:symbol/quote',
      responses: {
        200: z.object({
          symbol: z.string(),
          price: z.number(),
          change: z.number(),
          changePercent: z.number(),
          volume: z.number(),
          companyName: z.string().optional(),
          marketCap: z.number().optional(),
          peRatio: z.number().optional(),
          sector: z.string().optional(),
          industry: z.string().optional(),
          description: z.string().optional(),
          sectorETFs: z.array(z.string()).optional(),
          relatedStocks: z.array(z.object({
            symbol: z.string(),
            name: z.string(),
            description: z.string().optional(),
            marketCap: z.number().optional(),
          })).optional(),
          earnings: z.object({
            quarterlyGrowthPct: z.number().optional(),
            surprisePct: z.number().optional(),
            lastQuarterDate: z.string().optional(),
          }).optional(),
        }),
        404: errorSchemas.notFound,
      },
    }
  },
  scanner: {
    run: {
      method: 'POST' as const,
      path: '/api/scanner/run',
      input: z.object({
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        minVolume: z.number().optional(),
        candlestickPattern: z.enum(['All', 'Doji', 'Hammer', 'Bullish Engulfing', 'Bearish Engulfing', 'Morning Star']).optional(),
        chartPattern: z.enum(['All', 'VCP', 'Weekly Tight', 'Monthly Tight', 'High Tight Flag', 'Cup and Handle', 'Pullback to 5 DMA', 'Pullback to 10 DMA', 'Pullback to 20 DMA', 'Pullback to 50 DMA']).optional(),
        patternStrictness: z.enum(['tight', 'loose', 'both']).optional(),
        smaFilter: z.enum(['none', 'stacked', 'above50_200']).optional(),
        priceWithin50dPct: z.number().min(0).max(100).optional(),
        maxChannelHeightPct: z.number().min(1).max(50).optional(),
        htfMinGainPct: z.number().min(1).max(500).optional(),
        pbMinGainPct: z.number().min(1).max(200).optional(),
        pbCandleCount: z.number().min(3).max(100).optional(),
        pbTimeframe: z.enum(['15m', '1d']).optional(),
      }),
      responses: {
        200: z.array(z.object({
          symbol: z.string(),
          price: z.number(),
          changePercent: z.number(),
          volume: z.number(),
          matchedPattern: z.string().optional(),
          sector: z.string().optional(),
          channelHeightPct: z.number().optional(),
        })),
      },
    },
  },
  watchlist: {
    list: {
      method: 'GET' as const,
      path: '/api/watchlist',
      responses: {
        200: z.array(z.custom<typeof watchlistItems.$inferSelect>()),
      },
    },
    add: {
      method: 'POST' as const,
      path: '/api/watchlist',
      input: insertWatchlistSchema,
      responses: {
        201: z.custom<typeof watchlistItems.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/watchlist/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================
export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

// ============================================
// TYPE HELPERS
// ============================================
export type StockHistoryResponse = z.infer<typeof api.stocks.history.responses[200]>;
export type StockQuoteResponse = z.infer<typeof api.stocks.quote.responses[200]>;
export type ScannerRunInput = z.infer<typeof api.scanner.run.input>;
export type ScannerResult = z.infer<typeof api.scanner.run.responses[200]>;
export type WatchlistListResponse = z.infer<typeof api.watchlist.list.responses[200]>;
