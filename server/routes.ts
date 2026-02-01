import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initializeDatabase, isDatabaseAvailable } from "./db";
import { api } from "@shared/routes";
import { z } from "zod";

// Dynamic import to handle ESM/CJS compatibility
let yahooFinance: any = null;

async function getYahooFinance() {
  if (!yahooFinance) {
    try {
      const YahooFinanceModule = await import('yahoo-finance2');
      const YahooFinance = YahooFinanceModule.default || YahooFinanceModule;
      if (typeof YahooFinance === 'function') {
        yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
      } else if (YahooFinance.default && typeof YahooFinance.default === 'function') {
        yahooFinance = new YahooFinance.default({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
      } else {
        yahooFinance = YahooFinance;
      }
      console.log("Yahoo Finance initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Yahoo Finance:", error);
      throw error;
    }
  }
  return yahooFinance;
}

// Helper to calculate date for period
function getPeriodStartDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case '1mo':
      return new Date(now.setMonth(now.getMonth() - 1));
    case '3mo':
      return new Date(now.setMonth(now.getMonth() - 3));
    case '6mo':
      return new Date(now.setMonth(now.getMonth() - 6));
    case '1y':
      return new Date(now.setFullYear(now.getFullYear() - 1));
    case '2y':
      return new Date(now.setFullYear(now.getFullYear() - 2));
    default:
      return new Date(now.setFullYear(now.getFullYear() - 1));
  }
}

// Helper to get chart data (historical data)
async function getChartData(yf: any, symbol: string, period: string = '1y', interval: string = '1d'): Promise<Candle[]> {
  const startDate = getPeriodStartDate(period);
  const result = await yf.chart(symbol, { period1: startDate, period2: new Date(), interval });
  if (!result.quotes || result.quotes.length === 0) {
    return [];
  }
  return result.quotes
    .filter((item: any) => item.open != null && item.close != null)
    .map((item: any) => ({
      date: interval.includes('m') ? new Date(item.date).toISOString() : new Date(item.date).toISOString().split('T')[0],
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume || 0,
    }));
}

// Stock index lists
const DOW_30 = [
  'AAPL', 'AMGN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS', 'DOW',
  'GS', 'HD', 'HON', 'IBM', 'INTC', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM',
  'MRK', 'MSFT', 'NKE', 'PG', 'TRV', 'UNH', 'V', 'VZ', 'WBA', 'WMT'
];

const NASDAQ_100 = [
  'AAPL', 'ABNB', 'ADBE', 'ADI', 'ADP', 'ADSK', 'AEP', 'AMAT', 'AMD', 'AMGN',
  'AMZN', 'ANSS', 'ARM', 'ASML', 'AVGO', 'AZN', 'BIIB', 'BKNG', 'BKR', 'CCEP',
  'CDNS', 'CDW', 'CEG', 'CHTR', 'CMCSA', 'COST', 'CPRT', 'CRWD', 'CSCO', 'CSGP',
  'CSX', 'CTAS', 'CTSH', 'DDOG', 'DLTR', 'DXCM', 'EA', 'EXC', 'FANG', 'FAST',
  'FTNT', 'GEHC', 'GFS', 'GILD', 'GOOG', 'GOOGL', 'HON', 'IDXX', 'ILMN', 'INTC',
  'INTU', 'ISRG', 'KDP', 'KHC', 'KLAC', 'LIN', 'LRCX', 'LULU', 'MAR', 'MCHP',
  'MDB', 'MDLZ', 'MELI', 'META', 'MNST', 'MRNA', 'MRVL', 'MSFT', 'MU', 'NFLX',
  'NVDA', 'NXPI', 'ODFL', 'ON', 'ORLY', 'PANW', 'PAYX', 'PCAR', 'PDD', 'PEP',
  'PYPL', 'QCOM', 'REGN', 'ROP', 'ROST', 'SBUX', 'SNPS', 'SPLK', 'TEAM', 'TMUS',
  'TSLA', 'TTD', 'TTWO', 'TXN', 'VRSK', 'VRTX', 'WBD', 'WDAY', 'XEL', 'ZS'
];

const SP_100 = [
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'UNH',
  'XOM', 'JNJ', 'JPM', 'V', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'LLY',
  'ABBV', 'PEP', 'KO', 'AVGO', 'COST', 'TMO', 'MCD', 'WMT', 'CSCO', 'ABT',
  'ACN', 'CRM', 'DHR', 'NEE', 'LIN', 'ADBE', 'TXN', 'AMD', 'PM', 'NFLX',
  'WFC', 'RTX', 'CMCSA', 'HON', 'T', 'UNP', 'LOW', 'BA', 'ORCL', 'AMGN',
  'IBM', 'SPGI', 'QCOM', 'GE', 'CAT', 'INTC', 'INTU', 'SBUX', 'PLD', 'MDLZ',
  'GILD', 'GS', 'AXP', 'BLK', 'DE', 'ADI', 'CVS', 'ISRG', 'BKNG', 'SYK',
  'REGN', 'MMC', 'VRTX', 'TJX', 'SCHW', 'CB', 'PGR', 'CI', 'MO', 'DUK',
  'SO', 'LRCX', 'BDX', 'BSX', 'CME', 'COP', 'EOG', 'EQIX', 'FIS', 'ICE',
  'MMM', 'MU', 'NSC', 'PNC', 'USB', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD'
];

// Default stock universe (S&P 100)
const STOCK_UNIVERSE = SP_100;

// Helper function to get stock list by index
function getStocksByIndex(index?: string): string[] {
  switch (index) {
    case 'dow30': return DOW_30;
    case 'nasdaq100': return NASDAQ_100;
    case 'sp100': return SP_100;
    case 'sp500': return [...SP_100]; // For now use SP100 as SP500 subset
    case 'all': return [...new Set([...SP_100, ...NASDAQ_100, ...DOW_30])];
    default: return SP_100;
  }
}

// Sector ETF mappings
const SECTOR_ETFS: Record<string, string[]> = {
  'Technology': ['XLK', 'QQQ', 'VGT'],
  'Healthcare': ['XLV', 'VHT', 'IBB'],
  'Financial Services': ['XLF', 'VFH', 'KBE'],
  'Consumer Cyclical': ['XLY', 'VCR', 'FDIS'],
  'Consumer Defensive': ['XLP', 'VDC', 'FSTA'],
  'Energy': ['XLE', 'VDE', 'OIH'],
  'Industrials': ['XLI', 'VIS', 'FIDU'],
  'Basic Materials': ['XLB', 'VAW', 'FMAT'],
  'Real Estate': ['XLRE', 'VNQ', 'IYR'],
  'Utilities': ['XLU', 'VPU', 'FUTY'],
  'Communication Services': ['XLC', 'VOX', 'FCOM'],
};

// Pre-computed stocks by sector with market caps (in billions, approximate)
const STOCKS_BY_SECTOR: Record<string, { symbol: string; name: string; industry: string; marketCap: number }[]> = {
  'Technology': [
    { symbol: 'AAPL', name: 'Apple Inc.', industry: 'Consumer Electronics', marketCap: 3000e9 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', industry: 'Software', marketCap: 2800e9 },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', industry: 'Semiconductors', marketCap: 1200e9 },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', industry: 'Internet Services', marketCap: 1800e9 },
    { symbol: 'META', name: 'Meta Platforms', industry: 'Internet Services', marketCap: 900e9 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', industry: 'Semiconductors', marketCap: 350e9 },
    { symbol: 'ORCL', name: 'Oracle Corporation', industry: 'Software', marketCap: 320e9 },
    { symbol: 'CRM', name: 'Salesforce Inc.', industry: 'Software', marketCap: 250e9 },
    { symbol: 'AMD', name: 'Advanced Micro Devices', industry: 'Semiconductors', marketCap: 200e9 },
    { symbol: 'CSCO', name: 'Cisco Systems', industry: 'Networking', marketCap: 200e9 },
    { symbol: 'ADBE', name: 'Adobe Inc.', industry: 'Software', marketCap: 240e9 },
    { symbol: 'INTC', name: 'Intel Corporation', industry: 'Semiconductors', marketCap: 150e9 },
    { symbol: 'IBM', name: 'IBM', industry: 'IT Services', marketCap: 150e9 },
    { symbol: 'TXN', name: 'Texas Instruments', industry: 'Semiconductors', marketCap: 160e9 },
    { symbol: 'QCOM', name: 'Qualcomm Inc.', industry: 'Semiconductors', marketCap: 170e9 },
    { symbol: 'MU', name: 'Micron Technology', industry: 'Semiconductors', marketCap: 90e9 },
    { symbol: 'LRCX', name: 'Lam Research', industry: 'Semiconductor Equipment', marketCap: 100e9 },
  ],
  'Healthcare': [
    { symbol: 'UNH', name: 'UnitedHealth Group', industry: 'Health Insurance', marketCap: 500e9 },
    { symbol: 'JNJ', name: 'Johnson & Johnson', industry: 'Pharmaceuticals', marketCap: 400e9 },
    { symbol: 'LLY', name: 'Eli Lilly', industry: 'Pharmaceuticals', marketCap: 550e9 },
    { symbol: 'PFE', name: 'Pfizer Inc.', industry: 'Pharmaceuticals', marketCap: 160e9 },
    { symbol: 'ABBV', name: 'AbbVie Inc.', industry: 'Pharmaceuticals', marketCap: 280e9 },
    { symbol: 'MRK', name: 'Merck & Co.', industry: 'Pharmaceuticals', marketCap: 280e9 },
    { symbol: 'TMO', name: 'Thermo Fisher Scientific', industry: 'Life Sciences', marketCap: 210e9 },
    { symbol: 'ABT', name: 'Abbott Laboratories', industry: 'Medical Devices', marketCap: 190e9 },
    { symbol: 'DHR', name: 'Danaher Corporation', industry: 'Life Sciences', marketCap: 180e9 },
    { symbol: 'BMY', name: 'Bristol-Myers Squibb', industry: 'Pharmaceuticals', marketCap: 120e9 },
    { symbol: 'AMGN', name: 'Amgen Inc.', industry: 'Biotechnology', marketCap: 150e9 },
    { symbol: 'GILD', name: 'Gilead Sciences', industry: 'Biotechnology', marketCap: 100e9 },
    { symbol: 'MDT', name: 'Medtronic', industry: 'Medical Devices', marketCap: 110e9 },
    { symbol: 'BSX', name: 'Boston Scientific', industry: 'Medical Devices', marketCap: 90e9 },
    { symbol: 'BDX', name: 'Becton Dickinson', industry: 'Medical Devices', marketCap: 70e9 },
  ],
  'Financial Services': [
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', industry: 'Diversified', marketCap: 800e9 },
    { symbol: 'JPM', name: 'JPMorgan Chase', industry: 'Banking', marketCap: 500e9 },
    { symbol: 'V', name: 'Visa Inc.', industry: 'Payment Processing', marketCap: 500e9 },
    { symbol: 'MA', name: 'Mastercard', industry: 'Payment Processing', marketCap: 400e9 },
    { symbol: 'BAC', name: 'Bank of America', industry: 'Banking', marketCap: 280e9 },
    { symbol: 'WFC', name: 'Wells Fargo', industry: 'Banking', marketCap: 180e9 },
    { symbol: 'GS', name: 'Goldman Sachs', industry: 'Investment Banking', marketCap: 140e9 },
    { symbol: 'MS', name: 'Morgan Stanley', industry: 'Investment Banking', marketCap: 150e9 },
    { symbol: 'SPGI', name: 'S&P Global', industry: 'Financial Data', marketCap: 130e9 },
    { symbol: 'BLK', name: 'BlackRock', industry: 'Asset Management', marketCap: 120e9 },
    { symbol: 'AXP', name: 'American Express', industry: 'Credit Services', marketCap: 170e9 },
    { symbol: 'C', name: 'Citigroup', industry: 'Banking', marketCap: 100e9 },
    { symbol: 'CME', name: 'CME Group', industry: 'Exchanges', marketCap: 80e9 },
    { symbol: 'ICE', name: 'Intercontinental Exchange', industry: 'Exchanges', marketCap: 70e9 },
    { symbol: 'PNC', name: 'PNC Financial', industry: 'Banking', marketCap: 65e9 },
    { symbol: 'USB', name: 'US Bancorp', industry: 'Banking', marketCap: 60e9 },
  ],
  'Consumer Cyclical': [
    { symbol: 'AMZN', name: 'Amazon.com', industry: 'E-Commerce', marketCap: 1500e9 },
    { symbol: 'TSLA', name: 'Tesla Inc.', industry: 'Auto Manufacturers', marketCap: 700e9 },
    { symbol: 'HD', name: 'Home Depot', industry: 'Home Improvement', marketCap: 350e9 },
    { symbol: 'MCD', name: "McDonald's", industry: 'Restaurants', marketCap: 210e9 },
    { symbol: 'NKE', name: 'Nike Inc.', industry: 'Footwear', marketCap: 140e9 },
    { symbol: 'SBUX', name: 'Starbucks', industry: 'Restaurants', marketCap: 110e9 },
    { symbol: 'LOW', name: "Lowe's", industry: 'Home Improvement', marketCap: 140e9 },
    { symbol: 'TJX', name: 'TJX Companies', industry: 'Retail', marketCap: 110e9 },
    { symbol: 'BKNG', name: 'Booking Holdings', industry: 'Travel', marketCap: 130e9 },
  ],
  'Consumer Defensive': [
    { symbol: 'WMT', name: 'Walmart Inc.', industry: 'Discount Stores', marketCap: 420e9 },
    { symbol: 'PG', name: 'Procter & Gamble', industry: 'Consumer Products', marketCap: 380e9 },
    { symbol: 'COST', name: 'Costco Wholesale', industry: 'Warehouse Clubs', marketCap: 300e9 },
    { symbol: 'KO', name: 'Coca-Cola', industry: 'Beverages', marketCap: 270e9 },
    { symbol: 'PEP', name: 'PepsiCo', industry: 'Beverages', marketCap: 240e9 },
    { symbol: 'PM', name: 'Philip Morris', industry: 'Tobacco', marketCap: 150e9 },
    { symbol: 'MO', name: 'Altria Group', industry: 'Tobacco', marketCap: 80e9 },
    { symbol: 'CL', name: 'Colgate-Palmolive', industry: 'Consumer Products', marketCap: 75e9 },
  ],
  'Energy': [
    { symbol: 'XOM', name: 'Exxon Mobil', industry: 'Oil & Gas', marketCap: 450e9 },
    { symbol: 'CVX', name: 'Chevron', industry: 'Oil & Gas', marketCap: 280e9 },
    { symbol: 'COP', name: 'ConocoPhillips', industry: 'Oil & Gas', marketCap: 130e9 },
    { symbol: 'EOG', name: 'EOG Resources', industry: 'Oil & Gas', marketCap: 70e9 },
  ],
  'Industrials': [
    { symbol: 'CAT', name: 'Caterpillar', industry: 'Heavy Machinery', marketCap: 170e9 },
    { symbol: 'RTX', name: 'RTX Corporation', industry: 'Aerospace & Defense', marketCap: 150e9 },
    { symbol: 'HON', name: 'Honeywell', industry: 'Aerospace & Defense', marketCap: 140e9 },
    { symbol: 'UNP', name: 'Union Pacific', industry: 'Railroads', marketCap: 150e9 },
    { symbol: 'BA', name: 'Boeing', industry: 'Aerospace & Defense', marketCap: 130e9 },
    { symbol: 'UPS', name: 'United Parcel Service', industry: 'Shipping', marketCap: 120e9 },
    { symbol: 'DE', name: 'Deere & Company', industry: 'Farm Machinery', marketCap: 120e9 },
    { symbol: 'LMT', name: 'Lockheed Martin', industry: 'Aerospace & Defense', marketCap: 120e9 },
    { symbol: 'GE', name: 'General Electric', industry: 'Aerospace & Defense', marketCap: 170e9 },
    { symbol: 'MMM', name: '3M Company', industry: 'Conglomerate', marketCap: 60e9 },
    { symbol: 'NSC', name: 'Norfolk Southern', industry: 'Railroads', marketCap: 55e9 },
    { symbol: 'NOC', name: 'Northrop Grumman', industry: 'Aerospace & Defense', marketCap: 75e9 },
    { symbol: 'GD', name: 'General Dynamics', industry: 'Aerospace & Defense', marketCap: 80e9 },
    { symbol: 'TDG', name: 'TransDigm Group', industry: 'Aerospace & Defense', marketCap: 65e9 },
    { symbol: 'HII', name: 'Huntington Ingalls', industry: 'Aerospace & Defense', marketCap: 12e9 },
    { symbol: 'LHX', name: 'L3Harris Technologies', industry: 'Aerospace & Defense', marketCap: 45e9 },
    { symbol: 'TXT', name: 'Textron Inc.', industry: 'Aerospace & Defense', marketCap: 18e9 },
  ],
  'Communication Services': [
    { symbol: 'GOOG', name: 'Alphabet Inc.', industry: 'Internet Services', marketCap: 1800e9 },
    { symbol: 'DIS', name: 'Walt Disney', industry: 'Entertainment', marketCap: 200e9 },
    { symbol: 'NFLX', name: 'Netflix', industry: 'Streaming', marketCap: 250e9 },
    { symbol: 'CMCSA', name: 'Comcast', industry: 'Cable', marketCap: 160e9 },
    { symbol: 'VZ', name: 'Verizon', industry: 'Telecom', marketCap: 170e9 },
    { symbol: 'T', name: 'AT&T', industry: 'Telecom', marketCap: 140e9 },
    { symbol: 'TMUS', name: 'T-Mobile', industry: 'Telecom', marketCap: 200e9 },
  ],
  'Utilities': [
    { symbol: 'NEE', name: 'NextEra Energy', industry: 'Utilities', marketCap: 150e9 },
    { symbol: 'DUK', name: 'Duke Energy', industry: 'Utilities', marketCap: 80e9 },
    { symbol: 'SO', name: 'Southern Company', industry: 'Utilities', marketCap: 85e9 },
  ],
  'Real Estate': [
    { symbol: 'AMT', name: 'American Tower', industry: 'REITs', marketCap: 100e9 },
    { symbol: 'PLD', name: 'Prologis', industry: 'REITs', marketCap: 110e9 },
    { symbol: 'EQIX', name: 'Equinix', industry: 'Data Centers', marketCap: 75e9 },
  ],
};

// Pre-computed ETF holdings (top stocks by weight)
const ETF_HOLDINGS: Record<string, { symbol: string; name: string; weight: number; marketCap: number }[]> = {
  'SPY': [
    { symbol: 'AAPL', name: 'Apple Inc.', weight: 7.2, marketCap: 3000e9 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', weight: 6.8, marketCap: 2800e9 },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', weight: 3.5, marketCap: 1200e9 },
    { symbol: 'AMZN', name: 'Amazon.com', weight: 3.3, marketCap: 1500e9 },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', weight: 2.2, marketCap: 1800e9 },
    { symbol: 'META', name: 'Meta Platforms', weight: 2.0, marketCap: 900e9 },
  ],
  'QQQ': [
    { symbol: 'AAPL', name: 'Apple Inc.', weight: 11.5, marketCap: 3000e9 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', weight: 10.2, marketCap: 2800e9 },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', weight: 7.8, marketCap: 1200e9 },
    { symbol: 'AMZN', name: 'Amazon.com', weight: 5.5, marketCap: 1500e9 },
    { symbol: 'META', name: 'Meta Platforms', weight: 4.2, marketCap: 900e9 },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', weight: 3.8, marketCap: 1800e9 },
  ],
  'XLK': [
    { symbol: 'AAPL', name: 'Apple Inc.', weight: 22.0, marketCap: 3000e9 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', weight: 21.0, marketCap: 2800e9 },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', weight: 6.5, marketCap: 1200e9 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weight: 4.8, marketCap: 350e9 },
    { symbol: 'CRM', name: 'Salesforce Inc.', weight: 2.5, marketCap: 250e9 },
  ],
  'XLV': [
    { symbol: 'LLY', name: 'Eli Lilly', weight: 12.0, marketCap: 550e9 },
    { symbol: 'UNH', name: 'UnitedHealth Group', weight: 10.5, marketCap: 500e9 },
    { symbol: 'JNJ', name: 'Johnson & Johnson', weight: 8.0, marketCap: 400e9 },
    { symbol: 'MRK', name: 'Merck & Co.', weight: 5.5, marketCap: 280e9 },
    { symbol: 'ABBV', name: 'AbbVie Inc.', weight: 5.2, marketCap: 280e9 },
  ],
  'XLF': [
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', weight: 14.0, marketCap: 800e9 },
    { symbol: 'JPM', name: 'JPMorgan Chase', weight: 10.5, marketCap: 500e9 },
    { symbol: 'V', name: 'Visa Inc.', weight: 8.0, marketCap: 500e9 },
    { symbol: 'MA', name: 'Mastercard', weight: 6.5, marketCap: 400e9 },
    { symbol: 'BAC', name: 'Bank of America', weight: 5.0, marketCap: 280e9 },
  ],
  'XLE': [
    { symbol: 'XOM', name: 'Exxon Mobil', weight: 23.0, marketCap: 450e9 },
    { symbol: 'CVX', name: 'Chevron', weight: 18.0, marketCap: 280e9 },
    { symbol: 'COP', name: 'ConocoPhillips', weight: 7.5, marketCap: 130e9 },
    { symbol: 'EOG', name: 'EOG Resources', weight: 4.5, marketCap: 70e9 },
  ],
  'XLY': [
    { symbol: 'AMZN', name: 'Amazon.com', weight: 22.0, marketCap: 1500e9 },
    { symbol: 'TSLA', name: 'Tesla Inc.', weight: 12.0, marketCap: 700e9 },
    { symbol: 'HD', name: 'Home Depot', weight: 9.5, marketCap: 350e9 },
    { symbol: 'MCD', name: "McDonald's", weight: 5.0, marketCap: 210e9 },
    { symbol: 'LOW', name: "Lowe's", weight: 4.0, marketCap: 140e9 },
  ],
  'XLP': [
    { symbol: 'PG', name: 'Procter & Gamble', weight: 15.0, marketCap: 380e9 },
    { symbol: 'COST', name: 'Costco Wholesale', weight: 12.0, marketCap: 300e9 },
    { symbol: 'KO', name: 'Coca-Cola', weight: 10.0, marketCap: 270e9 },
    { symbol: 'WMT', name: 'Walmart Inc.', weight: 9.5, marketCap: 420e9 },
    { symbol: 'PEP', name: 'PepsiCo', weight: 9.0, marketCap: 240e9 },
  ],
  'XLI': [
    { symbol: 'GE', name: 'General Electric', weight: 5.5, marketCap: 170e9 },
    { symbol: 'CAT', name: 'Caterpillar', weight: 5.2, marketCap: 170e9 },
    { symbol: 'UNP', name: 'Union Pacific', weight: 5.0, marketCap: 150e9 },
    { symbol: 'RTX', name: 'RTX Corporation', weight: 4.8, marketCap: 150e9 },
    { symbol: 'HON', name: 'Honeywell', weight: 4.5, marketCap: 140e9 },
  ],
  'XLU': [
    { symbol: 'NEE', name: 'NextEra Energy', weight: 15.0, marketCap: 150e9 },
    { symbol: 'SO', name: 'Southern Company', weight: 8.5, marketCap: 85e9 },
    { symbol: 'DUK', name: 'Duke Energy', weight: 8.0, marketCap: 80e9 },
  ],
  'XLC': [
    { symbol: 'META', name: 'Meta Platforms', weight: 23.0, marketCap: 900e9 },
    { symbol: 'GOOG', name: 'Alphabet Inc.', weight: 22.0, marketCap: 1800e9 },
    { symbol: 'NFLX', name: 'Netflix', weight: 6.0, marketCap: 250e9 },
    { symbol: 'DIS', name: 'Walt Disney', weight: 5.0, marketCap: 200e9 },
    { symbol: 'TMUS', name: 'T-Mobile', weight: 4.5, marketCap: 200e9 },
  ],
  'DIA': [
    { symbol: 'UNH', name: 'UnitedHealth Group', weight: 9.5, marketCap: 500e9 },
    { symbol: 'GS', name: 'Goldman Sachs', weight: 7.5, marketCap: 140e9 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', weight: 6.5, marketCap: 2800e9 },
    { symbol: 'HD', name: 'Home Depot', weight: 6.0, marketCap: 350e9 },
    { symbol: 'CAT', name: 'Caterpillar', weight: 5.5, marketCap: 170e9 },
  ],
  'IWM': [
    { symbol: 'SMCI', name: 'Super Micro Computer', weight: 0.8, marketCap: 30e9 },
    { symbol: 'MARA', name: 'Marathon Digital', weight: 0.6, marketCap: 5e9 },
    { symbol: 'CELH', name: 'Celsius Holdings', weight: 0.5, marketCap: 10e9 },
    { symbol: 'CIEN', name: 'Ciena Corporation', weight: 0.4, marketCap: 8e9 },
  ],
};

// List of known ETF symbols
const ETF_SYMBOLS = new Set(Object.keys(ETF_HOLDINGS).concat([
  'VOO', 'IVV', 'VTI', 'VTV', 'VUG', 'VIG', 'VYM', 'SCHD', 'ARKK', 'ARKG',
  'VGT', 'VHT', 'VFH', 'VDE', 'VIS', 'VNQ', 'VNQI', 'BND', 'AGG', 'TLT',
  'GLD', 'SLV', 'USO', 'EEM', 'EFA', 'IEMG', 'VWO', 'VEA', 'VXUS',
]));

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Helper to detect patterns
function detectPattern(candles: Candle[], patternType: string): boolean {
  if (candles.length < 5) return false;
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  const isGreen = (c: Candle) => c.close > c.open;
  const isRed = (c: Candle) => c.close < c.open;
  const bodySize = (c: Candle) => Math.abs(c.close - c.open);
  const upperShadow = (c: Candle) => c.high - Math.max(c.open, c.close);
  const lowerShadow = (c: Candle) => Math.min(c.open, c.close) - c.low;

  switch (patternType) {
    case 'Doji':
      return bodySize(current) <= (current.high - current.low) * 0.1;
    
    case 'Hammer':
      return (
        lowerShadow(current) >= bodySize(current) * 2 &&
        upperShadow(current) <= bodySize(current) * 0.5
      );

    case 'Bullish Engulfing':
      return (
        isRed(prev) &&
        isGreen(current) &&
        current.open <= prev.close &&
        current.close >= prev.open
      );

    case 'Bearish Engulfing':
       return (
        isGreen(prev) &&
        isRed(current) &&
        current.open >= prev.close &&
        current.close <= prev.open
       );
       
    case 'Morning Star':
      const first = candles[candles.length - 3];
      return (
        isRed(first) &&
        bodySize(prev) < bodySize(first) * 0.5 &&
        isGreen(current) &&
        current.close > (first.open + first.close) / 2
      );

    case 'VCP':
      return detectVCP(candles);

    default:
      return false;
  }
}

// VCP (Volatility Contraction Pattern) Detection
// Looks for progressively tightening price ranges with decreasing volume
function detectVCP(candles: Candle[]): boolean {
  if (candles.length < 30) return false;
  
  // Get last 30 days of data
  const recentCandles = candles.slice(-30);
  
  // Divide into 3 periods to check for contraction
  const period1 = recentCandles.slice(0, 10);
  const period2 = recentCandles.slice(10, 20);
  const period3 = recentCandles.slice(20, 30);
  
  // Calculate price range (volatility) for each period
  const getRange = (c: Candle[]) => {
    const highs = c.map(x => x.high);
    const lows = c.map(x => x.low);
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const avgPrice = c.reduce((sum, x) => sum + x.close, 0) / c.length;
    return (maxHigh - minLow) / avgPrice; // Normalized range as percentage
  };
  
  // Calculate average volume for each period
  const getAvgVolume = (c: Candle[]) => c.reduce((sum, x) => sum + x.volume, 0) / c.length;
  
  const range1 = getRange(period1);
  const range2 = getRange(period2);
  const range3 = getRange(period3);
  
  const vol1 = getAvgVolume(period1);
  const vol2 = getAvgVolume(period2);
  const vol3 = getAvgVolume(period3);
  
  // VCP characteristics:
  // 1. Price range should be contracting (each period smaller than previous)
  // 2. Volume should be decreasing or stable
  // 3. Price should be near highs of the consolidation (not breaking down)
  
  const rangeContracting = range2 < range1 * 0.9 && range3 < range2 * 0.9;
  const volumeDecreasing = vol2 <= vol1 * 1.1 && vol3 <= vol2 * 1.1;
  
  // Check if current price is in upper half of consolidation range
  const consolidationHigh = Math.max(...recentCandles.map(c => c.high));
  const consolidationLow = Math.min(...recentCandles.map(c => c.low));
  const currentClose = recentCandles[recentCandles.length - 1].close;
  const inUpperHalf = currentClose > (consolidationHigh + consolidationLow) / 2;
  
  return rangeContracting && volumeDecreasing && inUpperHalf;
}

// Detect VCP with loose rules (more variance allowed)
function detectVCPLoose(candles: Candle[]): boolean {
  if (candles.length < 30) return false;
  
  const recentCandles = candles.slice(-30);
  const period1 = recentCandles.slice(0, 10);
  const period2 = recentCandles.slice(10, 20);
  const period3 = recentCandles.slice(20, 30);
  
  const getRange = (c: Candle[]) => {
    const highs = c.map(x => x.high);
    const lows = c.map(x => x.low);
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const avgPrice = c.reduce((sum, x) => sum + x.close, 0) / c.length;
    return (maxHigh - minLow) / avgPrice;
  };
  
  const getAvgVolume = (c: Candle[]) => c.reduce((sum, x) => sum + x.volume, 0) / c.length;
  
  const range1 = getRange(period1);
  const range2 = getRange(period2);
  const range3 = getRange(period3);
  
  const vol1 = getAvgVolume(period1);
  const vol2 = getAvgVolume(period2);
  const vol3 = getAvgVolume(period3);
  
  // Loose: Allow more variance (1.0 instead of 0.9, 1.3 instead of 1.1)
  const rangeContracting = range3 < range1 * 1.0; // Just need overall contraction
  const volumeStable = vol3 <= vol1 * 1.3;
  
  const consolidationHigh = Math.max(...recentCandles.map(c => c.high));
  const consolidationLow = Math.min(...recentCandles.map(c => c.low));
  const currentClose = recentCandles[recentCandles.length - 1].close;
  const inUpperThird = currentClose > consolidationLow + (consolidationHigh - consolidationLow) * 0.4;
  
  return rangeContracting && volumeStable && inUpperThird;
}

// Weekly Tight: 1-4 weeks of tight consolidation (current)
function detectWeeklyTight(candles: Candle[], loose: boolean = false): boolean {
  if (candles.length < 5) return false;
  
  // Look at last 5-20 trading days (1-4 weeks)
  const recentCandles = candles.slice(-20);
  if (recentCandles.length < 5) return false;
  
  // Calculate the price range as percentage of average price
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const rangePercent = ((maxHigh - minLow) / avgPrice) * 100;
  
  // Tight threshold: price range < 8% (tight) or < 12% (loose)
  const threshold = loose ? 12 : 8;
  
  // Must be current (last bar within range)
  const lastClose = recentCandles[recentCandles.length - 1].close;
  const isCurrent = lastClose >= minLow && lastClose <= maxHigh;
  
  // Volume should be decreasing or stable
  const firstHalfVol = recentCandles.slice(0, Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const secondHalfVol = recentCandles.slice(Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const volumeStable = secondHalfVol <= firstHalfVol * (loose ? 1.5 : 1.2);
  
  return rangePercent <= threshold && isCurrent && volumeStable;
}

// Monthly Tight: 1-4 months of tight consolidation (current)
function detectMonthlyTight(candles: Candle[], loose: boolean = false): boolean {
  if (candles.length < 20) return false;
  
  // Look at last 20-80 trading days (1-4 months)
  const recentCandles = candles.slice(-80);
  if (recentCandles.length < 20) return false;
  
  // Calculate the price range as percentage of average price
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const rangePercent = ((maxHigh - minLow) / avgPrice) * 100;
  
  // Monthly tight threshold: price range < 15% (tight) or < 22% (loose)
  const threshold = loose ? 22 : 15;
  
  // Must be current (last bar within range)
  const lastClose = recentCandles[recentCandles.length - 1].close;
  const isCurrent = lastClose >= minLow && lastClose <= maxHigh;
  
  // Volume should be lower in recent period
  const firstHalfVol = recentCandles.slice(0, Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const secondHalfVol = recentCandles.slice(Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const volumeStable = secondHalfVol <= firstHalfVol * (loose ? 1.5 : 1.2);
  
  return rangePercent <= threshold && isCurrent && volumeStable;
}

// High Tight Flag: Stock has risen sharply (configurable %) then consolidated tightly
// New configurable rules:
// - timeframe: 'weekly' or 'daily' (affects bar ranges)
// - minGainPct: minimum price lift % (default 65%)
// - pullbackPct: maximum pullback % (default 8%)
// Weekly: Lift within 2-8 bars, pullback within 2-8 bars
// Daily: Lift within 3-10 bars, pullback within 2-6 bars
function detectHighTightFlag(
  candles: Candle[], 
  timeframe: 'weekly' | 'daily' = 'weekly',
  minGainPct: number = 65, 
  pullbackPct: number = 8,
  loose: boolean = false
): boolean {
  // Define bar ranges based on timeframe
  const liftMinBars = timeframe === 'weekly' ? 2 : 3;
  const liftMaxBars = timeframe === 'weekly' ? 8 : 10;
  const pbMinBars = 2;
  const pbMaxBars = timeframe === 'weekly' ? 8 : 6;
  
  const totalBarsNeeded = liftMaxBars + pbMaxBars;
  if (candles.length < totalBarsNeeded) return false;
  
  // Allow loose mode to expand lift range slightly
  const effectiveLiftMax = loose ? liftMaxBars + 2 : liftMaxBars;
  const effectivePbMax = loose ? pbMaxBars + 2 : pbMaxBars;
  const effectivePullbackPct = loose ? pullbackPct * 1.5 : pullbackPct;
  
  // Try different lift period lengths to find a valid HTF pattern
  for (let liftLen = liftMinBars; liftLen <= effectiveLiftMax; liftLen++) {
    for (let pbLen = pbMinBars; pbLen <= effectivePbMax; pbLen++) {
      const totalLen = liftLen + pbLen;
      if (candles.length < totalLen) continue;
      
      // Get the lift candles and pullback candles
      const liftCandles = candles.slice(-(totalLen), -(pbLen));
      const pbCandles = candles.slice(-(pbLen));
      
      if (liftCandles.length < liftMinBars) continue;
      
      // Calculate the lift: low at start, high at end
      const liftLow = Math.min(...liftCandles.map(c => c.low));
      const liftHigh = Math.max(...liftCandles.map(c => c.high));
      const liftGainPct = ((liftHigh - liftLow) / liftLow) * 100;
      
      // Check if lift meets minimum gain threshold
      if (liftGainPct < minGainPct) continue;
      
      // Calculate pullback from the high
      const pbLow = Math.min(...pbCandles.map(c => c.low));
      const pbHigh = Math.max(...pbCandles.map(c => c.high));
      const actualPullbackPct = ((liftHigh - pbLow) / liftHigh) * 100;
      
      // Check if pullback is within threshold (tight consolidation)
      if (actualPullbackPct > effectivePullbackPct) continue;
      
      // Current price should be near highs (not breaking down)
      const currentClose = pbCandles[pbCandles.length - 1].close;
      const nearHighs = currentClose >= liftHigh * 0.92; // Within 8% of lift high
      
      if (nearHighs) {
        return true;
      }
    }
  }
  
  return false;
}

// Cup and Handle: U-shaped price pattern followed by a small pullback (handle)
function detectCupAndHandle(candles: Candle[], loose: boolean = false): boolean {
  if (candles.length < 50) return false;
  
  // Look at last 50-100 candles for cup formation
  const lookback = Math.min(candles.length, 100);
  const recentCandles = candles.slice(-lookback);
  
  // Find the cup: left high, low point, right high
  const leftSection = recentCandles.slice(0, 20);
  const middleSection = recentCandles.slice(20, lookback - 20);
  const rightSection = recentCandles.slice(-20);
  
  const leftHigh = Math.max(...leftSection.map(c => c.high));
  const cupLow = Math.min(...middleSection.map(c => c.low));
  const rightHigh = Math.max(...rightSection.map(c => c.high));
  
  // Cup depth: should be 12-35% (tight) or 10-50% (loose)
  const avgCupPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const cupDepthPct = ((leftHigh - cupLow) / leftHigh) * 100;
  
  const minDepth = loose ? 10 : 12;
  const maxDepth = loose ? 50 : 35;
  
  if (cupDepthPct < minDepth || cupDepthPct > maxDepth) return false;
  
  // Right side should recover to near left high
  const symmetryThreshold = loose ? 0.85 : 0.92;
  if (rightHigh < leftHigh * symmetryThreshold) return false;
  
  // Handle: small pullback from right high (last 5-10 candles)
  const handleCandles = recentCandles.slice(-10);
  const handleLow = Math.min(...handleCandles.map(c => c.low));
  const handleDepthPct = ((rightHigh - handleLow) / rightHigh) * 100;
  
  // Handle should be shallow: < 15% (tight) or < 20% (loose)
  const handleThreshold = loose ? 20 : 15;
  if (handleDepthPct > handleThreshold) return false;
  
  // Current price should be near handle high
  const currentClose = recentCandles[recentCandles.length - 1].close;
  const handleHigh = Math.max(...handleCandles.map(c => c.high));
  const nearHandleHigh = currentClose >= handleHigh * 0.95;
  
  return nearHandleHigh;
}

// Pullback to Moving Average: Stock that had a gain then pulled back to MA
function detectPullbackToMA(
  candles: Candle[], 
  maPeriod: number,
  minGainPct: number = 30,
  upPeriodCandles: number = 10,
  pbMinCandles: number = 1,
  pbMaxCandles: number = 5,
  loose: boolean = false
): boolean {
  const lookbackTotal = maPeriod + upPeriodCandles + pbMaxCandles;
  if (candles.length < lookbackTotal) return false;
  
  // Calculate the current MA
  const ma = calculateSMA(candles, maPeriod);
  if (!ma) return false;
  
  // Split candles into: uptrend phase, pullback phase, and current
  // We look at: the up period before the pullback, the pullback itself, and now
  const recentCandles = candles.slice(-pbMaxCandles);
  const upPeriodStart = candles.length - pbMaxCandles - upPeriodCandles;
  const upPeriodEnd = candles.length - pbMaxCandles;
  const upPeriodCandlesData = candles.slice(upPeriodStart, upPeriodEnd);
  
  if (upPeriodCandlesData.length < upPeriodCandles) return false;
  
  // Calculate gain during up period
  const startLow = Math.min(...upPeriodCandlesData.slice(0, Math.max(1, Math.floor(upPeriodCandles / 3))).map(c => c.low));
  const peakHigh = Math.max(...upPeriodCandlesData.map(c => c.high));
  const gainPct = ((peakHigh - startLow) / startLow) * 100;
  
  if (gainPct < minGainPct) return false;
  
  // Current price should be near the MA (within 2-5%)
  const currentClose = candles[candles.length - 1].close;
  const distanceFromMA = Math.abs((currentClose - ma) / ma) * 100;
  
  const proximityThreshold = loose ? 5 : 2;
  if (distanceFromMA > proximityThreshold) return false;
  
  // Price should be approaching from above (pullback, not breakdown)
  // Check the pullback phase for approach from above
  const pbRecentHigh = Math.max(...recentCandles.map(c => c.high));
  const wasAboveMA = pbRecentHigh > ma * 1.02;
  
  return wasAboveMA;
}

// Detect chart patterns with strictness setting
function detectChartPattern(
  candles: Candle[], 
  pattern: string, 
  strictness: string = 'tight',
  htfTimeframe?: 'weekly' | 'daily',
  htfMinGainPct?: number,
  htfPullbackPct?: number,
  pbMinGainPct?: number,
  pbUpPeriodCandles?: number,
  pbMinCandles?: number,
  pbMaxCandles?: number
): boolean {
  const useTight = strictness === 'tight' || strictness === 'both';
  const useLoose = strictness === 'loose' || strictness === 'both';
  
  switch (pattern) {
    case 'VCP':
      if (useTight && detectVCP(candles)) return true;
      if (useLoose && detectVCPLoose(candles)) return true;
      return false;
    case 'Weekly Tight':
      if (useTight && detectWeeklyTight(candles, false)) return true;
      if (useLoose && detectWeeklyTight(candles, true)) return true;
      return false;
    case 'Monthly Tight':
      if (useTight && detectMonthlyTight(candles, false)) return true;
      if (useLoose && detectMonthlyTight(candles, true)) return true;
      return false;
    case 'High Tight Flag':
      const htfTf = htfTimeframe || 'weekly';
      const htfGain = htfMinGainPct || 65;
      const htfPb = htfPullbackPct || 8;
      if (useTight && detectHighTightFlag(candles, htfTf, htfGain, htfPb, false)) return true;
      if (useLoose && detectHighTightFlag(candles, htfTf, htfGain, htfPb, true)) return true;
      return false;
    case 'Cup and Handle':
      if (useTight && detectCupAndHandle(candles, false)) return true;
      if (useLoose && detectCupAndHandle(candles, true)) return true;
      return false;
    case 'Pullback to 5 DMA':
      const pb5Gain = pbMinGainPct || 30;
      const pb5Up = pbUpPeriodCandles || 10;
      const pb5Min = pbMinCandles || 1;
      const pb5Max = pbMaxCandles || 5;
      if (useTight && detectPullbackToMA(candles, 5, pb5Gain, pb5Up, pb5Min, pb5Max, false)) return true;
      if (useLoose && detectPullbackToMA(candles, 5, pb5Gain, pb5Up, pb5Min, pb5Max, true)) return true;
      return false;
    case 'Pullback to 10 DMA':
      const pb10Gain = pbMinGainPct || 30;
      const pb10Up = pbUpPeriodCandles || 10;
      const pb10Min = pbMinCandles || 1;
      const pb10Max = pbMaxCandles || 5;
      if (useTight && detectPullbackToMA(candles, 10, pb10Gain, pb10Up, pb10Min, pb10Max, false)) return true;
      if (useLoose && detectPullbackToMA(candles, 10, pb10Gain, pb10Up, pb10Min, pb10Max, true)) return true;
      return false;
    case 'Pullback to 20 DMA':
      const pb20Gain = pbMinGainPct || 30;
      const pb20Up = pbUpPeriodCandles || 10;
      const pb20Min = pbMinCandles || 1;
      const pb20Max = pbMaxCandles || 5;
      if (useTight && detectPullbackToMA(candles, 20, pb20Gain, pb20Up, pb20Min, pb20Max, false)) return true;
      if (useLoose && detectPullbackToMA(candles, 20, pb20Gain, pb20Up, pb20Min, pb20Max, true)) return true;
      return false;
    case 'Pullback to 50 DMA':
      const pb50Gain = pbMinGainPct || 30;
      const pb50Up = pbUpPeriodCandles || 10;
      const pb50Min = pbMinCandles || 1;
      const pb50Max = pbMaxCandles || 5;
      if (useTight && detectPullbackToMA(candles, 50, pb50Gain, pb50Up, pb50Min, pb50Max, false)) return true;
      if (useLoose && detectPullbackToMA(candles, 50, pb50Gain, pb50Up, pb50Min, pb50Max, true)) return true;
      return false;
    default:
      return false;
  }
}

// Calculate Simple Moving Average
function calculateSMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const recentCandles = candles.slice(-period);
  const sum = recentCandles.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

// Check SMA filter conditions
function checkSMAFilter(candles: Candle[], smaFilter: string, currentPrice: number): boolean {
  if (!smaFilter || smaFilter === 'none') return true;
  
  const sma5 = calculateSMA(candles, 5);
  const sma20 = calculateSMA(candles, 20);
  const sma50 = calculateSMA(candles, 50);
  const sma200 = calculateSMA(candles, 200);
  
  if (smaFilter === 'stacked') {
    // Price > 5d SMA > 20d SMA > 50d SMA > 200d SMA
    if (!sma5 || !sma20 || !sma50 || !sma200) return false;
    return currentPrice > sma5 && sma5 > sma20 && sma20 > sma50 && sma50 > sma200;
  }
  
  if (smaFilter === 'above50_200') {
    // Price > 50d SMA > 200d SMA
    if (!sma50 || !sma200) return false;
    return currentPrice > sma50 && sma50 > sma200;
  }
  
  return true;
}

// Check price proximity to 50d SMA
function checkPriceProximity(candles: Candle[], currentPrice: number, maxPct: number | undefined): boolean {
  if (maxPct === undefined) return true;
  
  const sma50 = calculateSMA(candles, 50);
  if (!sma50) return true; // Skip filter if not enough data
  
  const pctDiff = Math.abs((currentPrice - sma50) / sma50) * 100;
  return pctDiff <= maxPct;
}

// Calculate channel height percentage for consolidation patterns
function calculateChannelHeightPct(candles: Candle[], pattern: string): number | null {
  let lookbackDays: number;
  
  switch (pattern) {
    case 'VCP':
      lookbackDays = 30;
      break;
    case 'Weekly Tight':
      lookbackDays = 20;
      break;
    case 'Monthly Tight':
      lookbackDays = 80;
      break;
    default:
      return null;
  }
  
  if (candles.length < lookbackDays) return null;
  
  const recentCandles = candles.slice(-lookbackDays);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  
  return ((maxHigh - minLow) / avgPrice) * 100;
}

// Calculate EMA
function calculateEMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0) / period;
  
  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }
  return ema;
}

// Detect 6/20 SMA Cross (on daily data approximating 5-min signal)
// Looks for 6 SMA and 20 SMA crossover within last 3 bars
function detect620Cross(candles: Candle[], direction: 'up' | 'down' = 'up'): boolean {
  if (candles.length < 25) return false;
  
  // Calculate 6 SMA and 20 SMA for recent bars
  const getSMA = (data: Candle[], period: number): number | null => {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((sum, c) => sum + c.close, 0) / period;
  };
  
  // Check last 3 bars for a crossover
  for (let i = 2; i >= 0; i--) {
    const currentData = candles.slice(0, candles.length - i);
    const prevData = candles.slice(0, candles.length - i - 1);
    
    if (currentData.length < 20 || prevData.length < 20) continue;
    
    const currentSMA6 = getSMA(currentData, 6);
    const currentSMA20 = getSMA(currentData, 20);
    const prevSMA6 = getSMA(prevData, 6);
    const prevSMA20 = getSMA(prevData, 20);
    
    if (!currentSMA6 || !currentSMA20 || !prevSMA6 || !prevSMA20) continue;
    
    if (direction === 'up') {
      // Cross Up: SMA6 was below SMA20, now above
      if (prevSMA6 <= prevSMA20 && currentSMA6 > currentSMA20) {
        return true;
      }
    } else {
      // Cross Down: SMA6 was above SMA20, now below
      if (prevSMA6 >= prevSMA20 && currentSMA6 < currentSMA20) {
        return true;
      }
    }
  }
  
  return false;
}

// Detect "Ride the 21 EMA" pattern
// Price has been riding the 21 EMA without breaking through by more than breakThreshold%
// and has pulled back by at least pbThreshold% from a recent high
function detectRide21EMA(
  candles: Candle[], 
  breakThresholdPct: number = 1, 
  pbThresholdPct: number = 2.5
): boolean {
  if (candles.length < 30) return false;
  
  const recentCandles = candles.slice(-30);
  
  // Calculate 21 EMA for each day
  const emas: number[] = [];
  const multiplier = 2 / (21 + 1);
  let ema = candles.slice(candles.length - 30 - 21, candles.length - 30).reduce((sum, c) => sum + c.close, 0) / 21;
  
  for (const c of recentCandles) {
    ema = (c.close - ema) * multiplier + ema;
    emas.push(ema);
  }
  
  // Check if price has stayed close to EMA (riding it)
  let ridingCount = 0;
  let breakCount = 0;
  
  for (let i = 0; i < recentCandles.length; i++) {
    const price = recentCandles[i].close;
    const emaValue = emas[i];
    const distancePct = ((price - emaValue) / emaValue) * 100;
    
    // Check if price broke below EMA by more than threshold
    if (distancePct < -breakThresholdPct) {
      breakCount++;
    }
    
    // Check if price is near EMA (within 3%)
    if (Math.abs(distancePct) <= 3) {
      ridingCount++;
    }
  }
  
  // Price should be riding the EMA most of the time
  const isRiding = ridingCount >= recentCandles.length * 0.5;
  // Should not have broken below EMA too many times
  const notBroken = breakCount <= 3;
  
  // Check for pullback from high
  const recentHigh = Math.max(...recentCandles.map(c => c.high));
  const currentPrice = recentCandles[recentCandles.length - 1].close;
  const pullbackPct = ((recentHigh - currentPrice) / recentHigh) * 100;
  const hasPullback = pullbackPct >= pbThresholdPct;
  
  return isRiding && notBroken && hasPullback;
}

// Detect technical signals
function detectTechnicalSignal(
  candles: Candle[],
  signal: string,
  options: {
    crossDirection?: 'up' | 'down';
    emaBreakThresholdPct?: number;
    emaPbThresholdPct?: number;
    pbMinGainPct?: number;
    pbUpPeriodCandles?: number;
    pbMinCandles?: number;
    pbMaxCandles?: number;
  } = {}
): boolean {
  switch (signal) {
    case '6_20_cross':
      return detect620Cross(candles, options.crossDirection || 'up');
    
    case 'ride_21_ema':
      return detectRide21EMA(
        candles, 
        options.emaBreakThresholdPct || 1, 
        options.emaPbThresholdPct || 2.5
      );
    
    case 'pullback_5_dma':
      return detectPullbackToMA(
        candles, 5, 
        options.pbMinGainPct || 30,
        options.pbUpPeriodCandles || 10,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 5,
        false
      );
    
    case 'pullback_10_dma':
      return detectPullbackToMA(
        candles, 10, 
        options.pbMinGainPct || 30,
        options.pbUpPeriodCandles || 10,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 5,
        false
      );
    
    case 'pullback_20_dma':
      return detectPullbackToMA(
        candles, 20, 
        options.pbMinGainPct || 30,
        options.pbUpPeriodCandles || 10,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 5,
        false
      );
    
    case 'pullback_50_dma':
      return detectPullbackToMA(
        candles, 50, 
        options.pbMinGainPct || 30,
        options.pbUpPeriodCandles || 10,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 5,
        false
      );
    
    default:
      return false;
  }
}

// Get signal display name
function getSignalDisplayName(signal: string, direction?: string): string {
  switch (signal) {
    case '6_20_cross':
      return `6/20 Cross ${direction === 'down' ? 'Down' : 'Up'}`;
    case 'ride_21_ema':
      return 'Ride 21 EMA';
    case 'pullback_5_dma':
      return 'Pullback to 5 DMA';
    case 'pullback_10_dma':
      return 'Pullback to 10 DMA';
    case 'pullback_20_dma':
      return 'Pullback to 20 DMA';
    case 'pullback_50_dma':
      return 'Pullback to 50 DMA';
    default:
      return signal;
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize database connection (non-blocking, app works without it)
  console.log("Attempting database connection...");
  await initializeDatabase();
  
  if (isDatabaseAvailable()) {
    console.log("Database is available");
  } else {
    console.warn("Database is not available - watchlist features will be limited");
  }

  // --- Stock History ---
  app.get(api.stocks.history.path, async (req, res) => {
    const symbol = String(req.params.symbol);
    const interval = String(req.query.interval || '1d');
    let period = String(req.query.period || '2y'); // Default to 2 years for SMA 200
    
    // For intraday, use shorter periods
    if (['5m', '15m', '30m'].includes(interval)) {
      period = '1mo'; // Yahoo limits intraday to ~60 days
    } else if (interval === '60m') {
      period = '3mo';
    }
    
    try {
      const yf = await getYahooFinance();
      const history = await getChartData(yf, symbol, period, interval);
      
      if (history.length === 0) {
        res.status(404).json({ message: `No data available for ${symbol}` });
        return;
      }
      
      res.json(history);
    } catch (error) {
      console.error(`Error fetching history for ${symbol}:`, error);
      res.status(404).json({ message: `Symbol ${symbol} not found or data unavailable` });
    }
  });

  // --- Stock Quote ---
  app.get(api.stocks.quote.path, async (req, res) => {
    const symbol = String(req.params.symbol);
    try {
      const yf = await getYahooFinance();
      const quote = await yf.quote(symbol);
      
      // Try to get more detailed info from quoteSummary for sector/industry
      let sector = quote.sector || 'Unknown';
      let industry = quote.industry || 'Unknown';
      let description = quote.longBusinessSummary || '';
      let earningsData: { quarterlyGrowthPct?: number; surprisePct?: number } | undefined;
      
      try {
        const summary = await yf.quoteSummary(symbol, { modules: ['assetProfile', 'earnings', 'defaultKeyStatistics'] });
        
        if (summary.assetProfile) {
          sector = summary.assetProfile.sector || sector;
          industry = summary.assetProfile.industry || industry;
          description = summary.assetProfile.longBusinessSummary || description;
        }
        
        // Get earnings data from earnings module
        if (summary.earnings?.earningsChart?.quarterly?.length > 0) {
          const quarters = summary.earnings.earningsChart.quarterly;
          const latestQ = quarters[quarters.length - 1];
          if (latestQ) {
            const actual = latestQ.actual?.raw ?? latestQ.actual;
            const estimate = latestQ.estimate?.raw ?? latestQ.estimate;
            if (actual !== undefined && estimate !== undefined && estimate !== 0) {
              earningsData = {
                quarterlyGrowthPct: undefined,
                surprisePct: ((actual - estimate) / Math.abs(estimate)) * 100
              };
            }
          }
        }
        
        // Also check earningsQuarterlyGrowth
        if (summary.defaultKeyStatistics?.earningsQuarterlyGrowth) {
          const growth = summary.defaultKeyStatistics.earningsQuarterlyGrowth;
          const growthValue = typeof growth === 'object' ? (growth as { raw?: number }).raw : growth;
          if (growthValue !== undefined) {
            earningsData = {
              ...earningsData,
              quarterlyGrowthPct: (growthValue as number) * 100
            };
          }
        }
      } catch (e) {
        // quoteSummary failed, use basic quote data
        console.log(`quoteSummary failed for ${symbol}, using basic quote`);
      }
      
      // Fallback earnings from basic quote
      if (!earningsData && quote.earningsQuarterlyGrowth !== undefined) {
        earningsData = {
          quarterlyGrowthPct: quote.earningsQuarterlyGrowth * 100,
          surprisePct: undefined
        };
      }
      
      // Get sector ETFs
      const sectorETFs = SECTOR_ETFS[sector] || [];
      
      // Get related stocks - prioritize same industry (sub-sector) over sector
      // First get all stocks from the sector
      const sectorStocks = STOCKS_BY_SECTOR[sector] || [];
      
      // Filter for same industry first (e.g., Aerospace & Defense, not just Industrials)
      const sameIndustryStocks = sectorStocks
        .filter(s => s.symbol !== symbol && s.industry === industry)
        .sort((a, b) => b.marketCap - a.marketCap);
      
      // Get other sector stocks (different industry) as backup
      const otherSectorStocks = sectorStocks
        .filter(s => s.symbol !== symbol && s.industry !== industry)
        .sort((a, b) => b.marketCap - a.marketCap);
      
      // Combine: same industry first, then fill with other sector stocks
      // Minimum 5, more if same industry is large
      const minCount = 5;
      const combined = [...sameIndustryStocks, ...otherSectorStocks];
      const relatedStocks = combined
        .slice(0, Math.max(minCount, sameIndustryStocks.length))
        .map(s => ({
          symbol: s.symbol,
          name: s.name,
          description: s.industry,
          marketCap: s.marketCap,
        }));
      
      if (!description) {
        description = `${quote.longName || quote.shortName || symbol} is a publicly traded company.`;
      }
      
      // Check if this symbol is an ETF
      const isETF = ETF_SYMBOLS.has(symbol.toUpperCase()) || 
                    quote.quoteType === 'ETF' ||
                    (quote.longName && quote.longName.toLowerCase().includes('etf'));
      
      // Get ETF holdings if this is an ETF
      const etfHoldings = isETF ? (ETF_HOLDINGS[symbol.toUpperCase()] || []).map(h => ({
        symbol: h.symbol,
        name: h.name,
        weight: h.weight,
        marketCap: h.marketCap,
      })) : undefined;
      
      res.json({
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        companyName: quote.longName || quote.shortName,
        marketCap: quote.marketCap,
        peRatio: quote.trailingPE || quote.forwardPE,
        sector: sector,
        industry: industry,
        description: description,
        sectorETFs,
        relatedStocks,
        isETF,
        etfHoldings,
        earnings: earningsData,
      });
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      res.status(404).json({ message: `Symbol ${symbol} not found` });
    }
  });

  // --- Scanner ---
  app.post(api.scanner.run.path, async (req, res) => {
    try {
      const yf = await getYahooFinance();
      const input = api.scanner.run.input.parse(req.body);
      const results = [];

      // Get stock universe based on selected index
      const universe = getStocksByIndex(input.scannerIndex);

      for (const symbol of universe) {
        try {
          // Get quote for price/volume filter
          const quote = await yf.quote(symbol);
          
          // Filter by Price
          if (input.minPrice && quote.regularMarketPrice < input.minPrice) continue;
          if (input.maxPrice && quote.regularMarketPrice > input.maxPrice) continue;
          
          // Filter by Volume
          if (input.minVolume && quote.regularMarketVolume < input.minVolume) continue;

          let matchedPattern: string | undefined = undefined;
          let channelHeightPct: number | undefined = undefined;
          
          const hasChartFilter = input.chartPattern && input.chartPattern !== 'All';
          const hasTechnicalSignal = input.technicalSignal && input.technicalSignal !== 'none';
          const hasSMAFilter = input.smaFilter && input.smaFilter !== 'none';
          const hasProximityFilter = input.priceWithin50dPct !== undefined;
          const hasChannelHeightFilter = input.maxChannelHeightPct !== undefined && hasChartFilter;
          
          // Determine if we need historical data
          const needsHistory = hasChartFilter || hasTechnicalSignal || hasSMAFilter || hasProximityFilter;
          
          if (needsHistory) {
            // Get history for pattern detection (1y for SMA 200)
            const period = (hasSMAFilter || hasProximityFilter) ? '1y' : '3mo';
            const candles = await getChartData(yf, symbol, period);
            
            if (candles.length < 5) continue;
            
            // Check SMA filter
            if (hasSMAFilter) {
              if (!checkSMAFilter(candles, input.smaFilter!, quote.regularMarketPrice)) {
                continue;
              }
            }
            
            // Check price proximity to 50d SMA
            if (hasProximityFilter) {
              if (!checkPriceProximity(candles, quote.regularMarketPrice, input.priceWithin50dPct)) {
                continue;
              }
            }
            
            // Check chart pattern
            if (hasChartFilter) {
              const strictness = input.patternStrictness || 'tight';
              if (!detectChartPattern(
                candles, 
                input.chartPattern!, 
                strictness,
                input.htfTimeframe as 'weekly' | 'daily' | undefined,
                input.htfMinGainPct,
                input.htfPullbackPct
              )) {
                continue;
              }
              
              // Calculate channel height for chart patterns
              channelHeightPct = calculateChannelHeightPct(candles, input.chartPattern!) ?? undefined;
              
              // Filter by max channel height if specified
              if (hasChannelHeightFilter && channelHeightPct !== undefined) {
                if (channelHeightPct > input.maxChannelHeightPct!) {
                  continue;
                }
              }
              
              matchedPattern = input.chartPattern;
            }
            
            // Check technical signal
            if (hasTechnicalSignal) {
              const signalMatched = detectTechnicalSignal(candles, input.technicalSignal!, {
                crossDirection: input.crossDirection as 'up' | 'down' | undefined,
                emaBreakThresholdPct: input.emaBreakThresholdPct,
                emaPbThresholdPct: input.emaPbThresholdPct,
                pbMinGainPct: input.pbMinGainPct,
                pbUpPeriodCandles: input.pbUpPeriodCandles,
                pbMinCandles: input.pbMinCandles,
                pbMaxCandles: input.pbMaxCandles,
              });
              
              if (!signalMatched) continue;
              
              const signalName = getSignalDisplayName(input.technicalSignal!, input.crossDirection);
              matchedPattern = matchedPattern 
                ? `${matchedPattern}, ${signalName}` 
                : signalName;
            }
          }

          results.push({
            symbol: quote.symbol,
            price: quote.regularMarketPrice,
            changePercent: quote.regularMarketChangePercent,
            volume: quote.regularMarketVolume,
            matchedPattern,
            sector: 'Technology',
            channelHeightPct
          });

        } catch (err) {
          console.error(`Failed to scan ${symbol}`, err);
        }
      }

      res.json(results);
    } catch (error) {
       console.error("Scanner error:", error);
       res.status(500).json({ message: "Failed to run scanner" });
    }
  });

  // --- Market Indicators ---
  app.get('/api/market/indicators', async (req, res) => {
    try {
      const yf = await getYahooFinance();
      const symbols = [
        { symbol: 'SPY', label: 'S&P 500' },
        { symbol: 'QQQ', label: 'NASDAQ' },
        { symbol: 'DIA', label: 'Dow' },
        { symbol: 'IWM', label: 'Russell 2K' },
        { symbol: 'GLD', label: 'Gold' },
        { symbol: '^VIX', label: 'VIX' },
        { symbol: 'RSP', label: 'S&P EW' },
        { symbol: 'QQQE', label: 'NDX EW' },
      ];
      
      const results = await Promise.all(
        symbols.map(async ({ symbol, label }) => {
          try {
            const quote = await yf.quote(symbol);
            return {
              symbol,
              label,
              price: quote.regularMarketPrice || 0,
              changePercent: quote.regularMarketChangePercent || 0,
            };
          } catch (error) {
            console.error(`Failed to fetch quote for ${symbol}:`, error);
            return {
              symbol,
              label,
              price: 0,
              changePercent: 0,
            };
          }
        })
      );
      
      res.json(results);
    } catch (error) {
      console.error('Market indicators error:', error);
      res.status(500).json({ message: 'Failed to fetch market indicators' });
    }
  });

  // --- Watchlist ---
  app.get(api.watchlist.list.path, async (req, res) => {
    const items = await storage.getWatchlist();
    res.json(items);
  });

  app.post(api.watchlist.add.path, async (req, res) => {
    try {
      const input = api.watchlist.add.input.parse(req.body);
      const item = await storage.addToWatchlist(input);
      res.status(201).json(item);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.delete(api.watchlist.delete.path, async (req, res) => {
    const { id } = req.params;
    await storage.removeFromWatchlist(Number(id));
    res.status(204).send();
  });

  // Seed default watchlist if empty (only if database is available)
  if (isDatabaseAvailable()) {
    try {
      const watchlist = await storage.getWatchlist();
      if (watchlist.length === 0) {
        const defaultSymbols = ['AAPL', 'MSFT', 'SPY', 'NVDA'];
        for (const symbol of defaultSymbols) {
          await storage.addToWatchlist({ symbol });
        }
        console.log('Seeded default watchlist');
      }
    } catch (error) {
      console.error('Failed to seed watchlist:', error);
    }
  }

  return httpServer;
}
