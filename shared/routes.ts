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
          isETF: z.boolean().optional(),
          etfHoldings: z.array(z.object({
            symbol: z.string(),
            name: z.string(),
            weight: z.number().optional(),
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
        scannerIndex: z.enum(['sp500', 'russell2000', 'russell3000', 'watchlist']).optional(),
        minPrice: z.number().optional(),
        maxPrice: z.number().optional(),
        minVolume: z.number().optional(),
        chartPattern: z.enum(['All', 'VCP', 'Weekly Tight', 'Monthly Tight', 'High Tight Flag', 'Cup and Handle']).optional(),
        patternStrictness: z.enum(['tight', 'loose', 'both']).optional(),
        smaFilter: z.enum(['none', 'stacked', 'above50_200']).optional(),
        priceWithin50dPct: z.number().min(0).max(100).optional(),
        maxChannelHeightPct: z.number().min(1).max(50).optional(),
        htfTimeframe: z.enum(['weekly', 'daily']).optional(),
        htfMinGainPct: z.number().min(1).max(500).optional(),
        htfPullbackPct: z.number().min(1).max(50).optional(),
        // Technical Indicator Signals
        technicalSignal: z.enum(['none', '6_20_cross', 'ride_21_ema', 'pullback_5_dma', 'pullback_10_dma', 'pullback_20_dma', 'pullback_50_dma']).optional(),
        // 6/20 Cross settings
        crossDirection: z.enum(['up', 'down']).optional(),
        // Ride the 21 EMA settings
        emaBreakThresholdPct: z.number().min(0.1).max(10).optional(),
        emaPbThresholdPct: z.number().min(0.5).max(20).optional(),
        // Pullback settings (moved from chart patterns)
        pbMinGainPct: z.number().min(1).max(200).optional(),
        pbUpPeriodCandles: z.number().min(1).max(100).optional(),
        pbMinCandles: z.number().min(1).max(50).optional(),
        pbMaxCandles: z.number().min(1).max(50).optional(),
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
          completionPct: z.number().optional(),
          cupOnly: z.boolean().optional(),
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
  savedScans: {
    list: {
      method: 'GET' as const,
      path: '/api/saved-scans',
      responses: {
        200: z.array(z.custom<typeof savedScans.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/saved-scans',
      input: z.object({
        name: z.string().min(1).max(100),
        criteria: z.record(z.unknown()),
      }),
      responses: {
        201: z.custom<typeof savedScans.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/saved-scans/:id',
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
