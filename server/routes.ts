import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initializeDatabase, isDatabaseAvailable } from "./db";
import { api } from "@shared/routes";
import { z } from "zod";
import { detectCupAndHandle as sharedDetectCupAndHandle, CupAndHandleResult } from "@shared/patternDetection";
import { registerSentinelRoutes } from "./sentinel/routes";
import { registerPatternLearningRoutes } from "./pattern-learning/routes";
import { registerBigIdeaRoutes } from "./bigidea/routes";

import * as tiingo from "./tiingo";

// In-memory cache for stock history data (5 min TTL)
interface CacheEntry {
  data: any;
  timestamp: number;
}
const stockHistoryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedHistory(key: string): any | null {
  const entry = stockHistoryCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  stockHistoryCache.delete(key);
  return null;
}

function setCachedHistory(key: string, data: any): void {
  stockHistoryCache.set(key, { data, timestamp: Date.now() });
}

import { getSectorAndIndustry } from "./fundamentals";

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

// Full S&P 500 list (all ~500 stocks)
const SP_500 = [
  // S&P 100 (top 100)
  ...SP_100,
  // Additional S&P 500 stocks (remaining ~400)
  'A', 'AAL', 'AAP', 'AFRM', 'AFL', 'AIG', 'AIZ', 'AJG', 'AKAM', 'ALB',
  'ALGN', 'ALK', 'ALL', 'ALLE', 'AMAT', 'AMCR', 'AME', 'AMP', 'AMT', 'ANSS',
  'AON', 'AOS', 'APA', 'APD', 'APH', 'APTV', 'ARE', 'ATO', 'ATVI', 'AVB',
  'AVY', 'AWK', 'AZO', 'BAC', 'BALL', 'BAX', 'BBWI', 'BBY', 'BEN', 'BF.B',
  'BG', 'BIO', 'BK', 'BKNG', 'BMY', 'BR', 'BRO', 'BWA', 'BXP', 'C',
  'CAG', 'CAH', 'CARR', 'CCL', 'CDAY', 'CDNS', 'CDW', 'CE', 'CEG', 'CF',
  'CFG', 'CHD', 'CHRW', 'CHTR', 'CINF', 'CL', 'CLX', 'CMA', 'CMCSA', 'CMG',
  'CMI', 'CMS', 'CNC', 'CNP', 'COF', 'COO', 'CPAY', 'CPRT', 'CPT', 'CRL',
  'CRM', 'CRWD', 'CSCO', 'CSGP', 'CSX', 'CTAS', 'CTLT', 'CTRA', 'CTSH', 'CTVA',
  'D', 'DAL', 'DD', 'DECK', 'DFS', 'DG', 'DGX', 'DHI', 'DIS', 'DLR',
  'DLTR', 'DOV', 'DOW', 'DPZ', 'DRI', 'DTE', 'DVA', 'DVN', 'DXCM', 'EA',
  'EBAY', 'ECL', 'ED', 'EFX', 'EG', 'EIX', 'EL', 'ELV', 'EMN', 'EMR',
  'ENPH', 'EPAM', 'EPD', 'ES', 'ESS', 'ETN', 'ETR', 'EVRG', 'EW', 'EXC',
  'EXPD', 'EXPE', 'EXR', 'F', 'FANG', 'FAST', 'FCX', 'FDS', 'FDX', 'FE',
  'FFIV', 'FI', 'FICO', 'FIS', 'FITB', 'FLT', 'FMC', 'FOX', 'FOXA', 'FRC',
  'FRT', 'FSLR', 'FTNT', 'FTV', 'GD', 'GDDY', 'GEN', 'GILD', 'GIS', 'GL',
  'GLW', 'GM', 'GNRC', 'GPC', 'GPN', 'GPS', 'GRMN', 'GWW', 'HAL', 'HAS',
  'HBAN', 'HCA', 'HD', 'HES', 'HIG', 'HII', 'HLT', 'HOLX', 'HPE', 'HPQ',
  'HRL', 'HSIC', 'HST', 'HSY', 'HUM', 'HWM', 'IDXX', 'IEX', 'IFF', 'ILMN',
  'INCY', 'INTC', 'IP', 'IPG', 'IQV', 'IR', 'IRM', 'IT', 'ITW', 'IVZ',
  'J', 'JBHT', 'JCI', 'JKHY', 'JNPR', 'K', 'KDP', 'KEY', 'KEYS', 'KHC',
  'KIM', 'KLAC', 'KMB', 'KMI', 'KMX', 'KO', 'KR', 'L', 'LDOS', 'LEN',
  'LH', 'LHX', 'LKQ', 'LMT', 'LNC', 'LNT', 'LUMN', 'LUV', 'LVS', 'LW',
  'LYB', 'LYV', 'MAA', 'MAS', 'MCD', 'MCHP', 'MCK', 'MCO', 'MDLZ', 'MDT',
  'MET', 'MGM', 'MHK', 'MKC', 'MKTX', 'MLM', 'MMM', 'MNST', 'MOS', 'MPC',
  'MPWR', 'MRO', 'MS', 'MSCI', 'MSI', 'MTB', 'MTCH', 'MTD', 'NCLH', 'NDAQ',
  'NDSN', 'NEM', 'NI', 'NKE', 'NOC', 'NOW', 'NRG', 'NUE', 'NVR', 'NWL',
  'NWS', 'NWSA', 'NXPI', 'O', 'ODFL', 'OGN', 'OKE', 'OMC', 'ON', 'ORCL',
  'ORLY', 'OTIS', 'OXY', 'PARA', 'PAYC', 'PAYX', 'PCAR', 'PCG', 'PEAK', 'PEG',
  'PFE', 'PFG', 'PH', 'PHM', 'PKG', 'PKI', 'PLD', 'PNR', 'PNW', 'PODD',
  'POOL', 'PPG', 'PPL', 'PRU', 'PSA', 'PSX', 'PTC', 'PVH', 'PWR', 'PYPL',
  'QRVO', 'RCL', 'RE', 'REG', 'RF', 'RHI', 'RJF', 'RL', 'RMD', 'ROK',
  'ROL', 'ROP', 'ROST', 'RSG', 'RTX', 'SBAC', 'SBNY', 'SBUX', 'SEE', 'SHW',
  'SIVB', 'SJM', 'SLB', 'SNA', 'SNPS', 'SO', 'SPG', 'SRE', 'STE', 'STT',
  'STX', 'STZ', 'SWK', 'SWKS', 'SYF', 'SYK', 'SYY', 'TAP', 'TDG', 'TDY',
  'TECH', 'TEL', 'TER', 'TFC', 'TFX', 'TGT', 'TMO', 'TMUS', 'TPR', 'TRGP',
  'TRMB', 'TROW', 'TRV', 'TSCO', 'TSN', 'TT', 'TTWO', 'TXN', 'TXT', 'TYL',
  'UAL', 'UDR', 'UHS', 'ULTA', 'UNP', 'UPS', 'URI', 'USB', 'V', 'VFC',
  'VICI', 'VLO', 'VMC', 'VNO', 'VRSK', 'VRSN', 'VRTX', 'VTR', 'VTRS', 'VZ',
  'WAB', 'WAT', 'WBA', 'WBD', 'WDC', 'WEC', 'WELL', 'WFC', 'WHR', 'WM',
  'WMB', 'WMT', 'WRB', 'WRK', 'WST', 'WTW', 'WY', 'WYNN', 'XEL', 'XOM',
  'XRAY', 'XYL', 'YUM', 'ZBH', 'ZBRA', 'ZION', 'ZTS'
];

// Russell 2000 - Top 300 small cap stocks (representative sample)
const RUSSELL_2000 = [
  'SMCI', 'MARA', 'RIOT', 'CELH', 'CIEN', 'UPST', 'PLUG', 'LCID', 'RIVN', 'SOFI',
  'HOOD', 'AFRM', 'COIN', 'RBLX', 'U', 'DKNG', 'CHWY', 'ETSY', 'PINS', 'SNAP',
  'ROKU', 'SQ', 'TWLO', 'ZM', 'DOCU', 'CRSR', 'LMND', 'GOEV', 'OPEN', 'WISH',
  'SPCE', 'PLTR', 'SKLZ', 'CLOV', 'WKHS', 'RIDE', 'NKLA', 'HYLN', 'LAZR', 'VLDR',
  'ASTS', 'IONQ', 'DNA', 'MTTR', 'BBIG', 'AMC', 'GME', 'BB', 'NOK', 'SNDL',
  'TLRY', 'ACB', 'CGC', 'CRON', 'HEXO', 'VFF', 'GRWG', 'CURLF', 'GTBIF', 'TCNNF',
  'CRSP', 'BEAM', 'EDIT', 'NTLA', 'VERV', 'ARKG', 'PATH', 'CFLT', 'MDB', 'SNOW',
  'NET', 'BILL', 'HUBS', 'VEEV', 'TTD', 'OKTA', 'ZS', 'CRWD', 'DDOG', 'SPLK',
  'ESTC', 'NEWR', 'SUMO', 'PD', 'DT', 'RPD', 'TENB', 'QLYS', 'VRNS', 'CYBR',
  'PANW', 'FTNT', 'S', 'SAIL', 'AI', 'BBAI', 'SOUN', 'GFAI', 'AGFY', 'BIGC',
  'CLVT', 'RSKD', 'FLYW', 'RELY', 'DV', 'BRZE', 'DOCN', 'GTLB', 'MNDY', 'FROG',
  'APP', 'IS', 'MGNI', 'PUBM', 'DSP', 'TBLA', 'ZETA', 'KARO', 'IRNT', 'CWAN',
  'BLND', 'NOTV', 'VERA', 'VZIO', 'PLTK', 'BGFV', 'PRPL', 'LOVE', 'SNBR', 'LESL',
  'RVLV', 'CURV', 'POSH', 'REAL', 'ACCD', 'OSH', 'BROS', 'SHAK', 'WING', 'CAVA',
  'TXRH', 'PLAY', 'EAT', 'BJRI', 'BLMN', 'DIN', 'CAKE', 'CHUY', 'TACO', 'JACK',
  'LOCO', 'RRGB', 'NDLS', 'HABT', 'FAT', 'ARKR', 'DENN', 'FRGI', 'PTLO', 'KRUS',
  'KURA', 'PCYO', 'RICK', 'RCI', 'VSTO', 'SWBI', 'RGR', 'AOUT', 'AXON', 'DGII',
  'VIAV', 'LITE', 'COHR', 'IIVI', 'LSCC', 'SLAB', 'MXIM', 'IDCC', 'POWI', 'DIOD',
  'OLED', 'KOPN', 'EMAN', 'KLIC', 'UCTT', 'AEHR', 'ONTO', 'ACLS', 'BRKS', 'CRUS',
  'SITM', 'PLAB', 'RMBS', 'AOSL', 'ALGM', 'NVTS', 'WOLF', 'AMBA', 'HIMX', 'SGH',
  'PSTG', 'NTAP', 'NEOG', 'VRNT', 'CDXS', 'HLIT', 'MITK', 'PRGS', 'PING', 'JAMF',
  'SMAR', 'FRSH', 'APPF', 'EGHT', 'TOST', 'NCNO', 'ALTR', 'SMTC', 'FORM', 'AMSC',
  'SATS', 'MAXN', 'ARRY', 'SEDG', 'ENPH', 'RUN', 'NOVA', 'SHLS', 'CSIQ', 'JKS',
  'DQ', 'SPWR', 'FSLR', 'FLNC', 'STEM', 'BLNK', 'CHPT', 'EVGO', 'VLTA', 'DCFC',
  'ARVL', 'FSR', 'PTRA', 'XL', 'WKHS', 'GOEV', 'REE', 'SOLO', 'ELMS', 'CENN',
  'MULN', 'FFIE', 'NKLA', 'RIDE', 'HYLN', 'LEV', 'HYZN', 'CLVR', 'NIO', 'XPEV',
  'LI', 'BYDDF', 'TSLA', 'RIVN', 'LCID', 'F', 'GM', 'STLA', 'TM', 'HMC'
];

// Default stock universe (S&P 100)
const STOCK_UNIVERSE = SP_100;

// Helper function to get stock list by index
function getStocksByIndex(index?: string, watchlistSymbols?: string[]): string[] {
  switch (index) {
    case 'dow30': return DOW_30;
    case 'nasdaq100': return NASDAQ_100;
    case 'sp100': return SP_100;
    case 'sp500': return [...new Set(SP_500)]; // Full S&P 500
    case 'russell2000': return RUSSELL_2000;
    case 'watchlist': return watchlistSymbols || [];
    case 'all': return [...new Set([...SP_500, ...NASDAQ_100, ...DOW_30, ...RUSSELL_2000])];
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
import { STOCKS_BY_SECTOR, findSectorForSymbol } from "@shared/stocksBySector";

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
  'VGT': [
    { symbol: 'AAPL', name: 'Apple Inc.', weight: 17.5, marketCap: 3000e9 },
    { symbol: 'MSFT', name: 'Microsoft Corporation', weight: 16.0, marketCap: 2800e9 },
    { symbol: 'NVDA', name: 'NVIDIA Corporation', weight: 8.5, marketCap: 1200e9 },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weight: 4.2, marketCap: 350e9 },
    { symbol: 'CRM', name: 'Salesforce Inc.', weight: 2.8, marketCap: 250e9 },
  ],
  'VHT': [
    { symbol: 'LLY', name: 'Eli Lilly', weight: 10.5, marketCap: 550e9 },
    { symbol: 'UNH', name: 'UnitedHealth Group', weight: 9.0, marketCap: 500e9 },
    { symbol: 'JNJ', name: 'Johnson & Johnson', weight: 7.5, marketCap: 400e9 },
    { symbol: 'MRK', name: 'Merck & Co.', weight: 5.0, marketCap: 280e9 },
    { symbol: 'ABBV', name: 'AbbVie Inc.', weight: 4.8, marketCap: 280e9 },
  ],
  'VFH': [
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', weight: 12.5, marketCap: 800e9 },
    { symbol: 'JPM', name: 'JPMorgan Chase', weight: 9.5, marketCap: 500e9 },
    { symbol: 'V', name: 'Visa Inc.', weight: 7.0, marketCap: 500e9 },
    { symbol: 'MA', name: 'Mastercard', weight: 5.5, marketCap: 400e9 },
    { symbol: 'BAC', name: 'Bank of America', weight: 4.5, marketCap: 280e9 },
  ],
  'VDE': [
    { symbol: 'XOM', name: 'Exxon Mobil', weight: 20.0, marketCap: 450e9 },
    { symbol: 'CVX', name: 'Chevron', weight: 15.0, marketCap: 280e9 },
    { symbol: 'COP', name: 'ConocoPhillips', weight: 6.5, marketCap: 130e9 },
    { symbol: 'SLB', name: 'Schlumberger', weight: 4.0, marketCap: 60e9 },
    { symbol: 'EOG', name: 'EOG Resources', weight: 3.8, marketCap: 70e9 },
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
  
  // Get last 30-60 days of data
  const recentCandles = candles.slice(-Math.min(60, candles.length));
  
  // Divide into 3 periods to check for contraction
  const third = Math.floor(recentCandles.length / 3);
  const period1 = recentCandles.slice(0, third);
  const period2 = recentCandles.slice(third, third * 2);
  const period3 = recentCandles.slice(third * 2);
  
  // Calculate price range (volatility) for each period
  const getRange = (c: Candle[]) => {
    const highs = c.map(x => x.high);
    const lows = c.map(x => x.low);
    const maxHigh = Math.max(...highs);
    const minLow = Math.min(...lows);
    const avgPrice = c.reduce((sum, x) => sum + x.close, 0) / c.length;
    return (maxHigh - minLow) / avgPrice; // Normalized range as percentage
  };
  
  const range1 = getRange(period1);
  const range2 = getRange(period2);
  const range3 = getRange(period3);
  
  // VCP: Overall contraction from first to last period
  // Allow period 2 to vary, just require range3 < range1
  const rangeContracting = range3 < range1 * 0.95;
  
  // Check if current price is in upper half of consolidation range
  const consolidationHigh = Math.max(...recentCandles.map(c => c.high));
  const consolidationLow = Math.min(...recentCandles.map(c => c.low));
  const currentClose = recentCandles[recentCandles.length - 1].close;
  const inUpperHalf = currentClose > (consolidationHigh + consolidationLow) / 2;
  
  return rangeContracting && inUpperHalf;
}

// Detect VCP with loose rules (more variance allowed)
function detectVCPLoose(candles: Candle[]): boolean {
  if (candles.length < 20) return false;
  
  // Use 20-60 day window for consolidation detection
  const recentCandles = candles.slice(-Math.min(60, candles.length));
  
  // Get high-low range of the consolidation
  const consolidationHigh = Math.max(...recentCandles.map(c => c.high));
  const consolidationLow = Math.min(...recentCandles.map(c => c.low));
  const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
  const consolidationRange = (consolidationHigh - consolidationLow) / avgPrice * 100;
  
  // VCP-like: Consolidation within 5-25% range
  if (consolidationRange < 5 || consolidationRange > 25) return false;
  
  // Check if recent price action is tightening
  const last10 = candles.slice(-10);
  const last10High = Math.max(...last10.map(c => c.high));
  const last10Low = Math.min(...last10.map(c => c.low));
  const last10Range = (last10High - last10Low) / avgPrice * 100;
  
  // Recent 10 days should be tighter than full consolidation
  const isTightening = last10Range < consolidationRange * 0.8;
  
  // Current price should be in upper half
  const currentClose = candles[candles.length - 1].close;
  const inUpperHalf = currentClose > (consolidationHigh + consolidationLow) / 2;
  
  return isTightening && inUpperHalf;
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
  
  // Tight threshold: price range < 10% (tight) or < 18% (loose)
  const threshold = loose ? 18 : 10;
  
  // Must be current (last bar within range)
  const lastClose = recentCandles[recentCandles.length - 1].close;
  const isCurrent = lastClose >= minLow && lastClose <= maxHigh;
  
  // Volume check - relaxed in loose mode
  const firstHalfVol = recentCandles.slice(0, Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const secondHalfVol = recentCandles.slice(Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  // In loose mode, skip volume check entirely
  const volumeStable = loose ? true : secondHalfVol <= firstHalfVol * 1.3;
  
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
  
  // Monthly tight threshold: price range < 20% (tight) or < 30% (loose)
  const threshold = loose ? 30 : 20;
  
  // Must be current (last bar within range)
  const lastClose = recentCandles[recentCandles.length - 1].close;
  const isCurrent = lastClose >= minLow && lastClose <= maxHigh;
  
  // Volume check - relaxed in loose mode
  const firstHalfVol = recentCandles.slice(0, Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  const secondHalfVol = recentCandles.slice(Math.floor(recentCandles.length / 2))
    .reduce((sum, c) => sum + c.volume, 0);
  // In loose mode, skip volume check entirely
  const volumeStable = loose ? true : secondHalfVol <= firstHalfVol * 1.3;
  
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

// Cup and Handle detection using shared module
// Returns completion percentage, cupOnly flag, and detection status
interface CupAndHandleDetectionResult {
  detected: boolean;
  completionPct: number | null;
  cupOnly: boolean;
  extensionPct: number;
}

function detectCupAndHandleWithDetails(candles: Candle[], loose: boolean = false): CupAndHandleDetectionResult {
  // Use shared detection algorithm with proper strictness filtering
  // Tight: shows cups up to 6% extended above left peak
  // Loose: shows cups up to 11% extended above left peak
  const result = sharedDetectCupAndHandle(candles, loose);
  
  if (!result.detected) {
    return { detected: false, completionPct: null, cupOnly: false, extensionPct: 0 };
  }
  
  return {
    detected: true,
    completionPct: result.completionPct ?? null,
    cupOnly: result.cupOnly ?? false,
    extensionPct: result.extensionPct ?? 0
  };
}

// Wrapper for backward compatibility - just returns detection boolean
function detectCupAndHandle(candles: Candle[], loose: boolean = false): boolean {
  return detectCupAndHandleWithDetails(candles, loose).detected;
}

// Cup and Handle completion percentage calculation
function calculateCupAndHandleCompletion(candles: Candle[]): { pct: number | null; cupOnly: boolean } {
  const result = detectCupAndHandleWithDetails(candles, true); // Use loose for completion calc
  return { pct: result.completionPct, cupOnly: result.cupOnly };
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
    case 'High Tight Flag':
      lookbackDays = 20; // Look at consolidation portion
      break;
    case 'Cup and Handle':
      lookbackDays = 50; // Look at recent portion including handle
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
        options.pbMinGainPct || 15,
        options.pbUpPeriodCandles || 10,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 5,
        true  // loose mode for faster MAs
      );
    
    case 'pullback_10_dma':
      return detectPullbackToMA(
        candles, 10, 
        options.pbMinGainPct || 15,
        options.pbUpPeriodCandles || 10,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 5,
        true  // loose mode for faster MAs
      );
    
    case 'pullback_20_dma':
      return detectPullbackToMA(
        candles, 20, 
        options.pbMinGainPct || 20,
        options.pbUpPeriodCandles || 15,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 5,
        false
      );
    
    case 'pullback_50_dma':
      return detectPullbackToMA(
        candles, 50, 
        options.pbMinGainPct || 25,
        options.pbUpPeriodCandles || 20,
        options.pbMinCandles || 1,
        options.pbMaxCandles || 8,
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

  registerSentinelRoutes(app);
  registerPatternLearningRoutes(app);
  registerBigIdeaRoutes(app);

  // --- Stock History ---
  app.get(api.stocks.history.path, async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const interval = String(req.query.interval || '1d');
    let period = String(req.query.period || '3y'); // Default to 3 years for scrollback history
    
    if (interval === '5m') {
      period = '3mo';
    } else if (interval === '15m') {
      period = '6mo';
    } else if (interval === '30m') {
      period = '6mo';
    } else if (interval === '60m') {
      period = '6mo';
    } else if (interval === '1wk' || interval === '1mo') {
      period = '5y'; // Weekly/monthly can have longer history
    }
    
    // Check cache first
    const cacheKey = `${symbol}:${period}:${interval}`;
    const cached = getCachedHistory(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }
    
    try {
      const history = await tiingo.getChartData(symbol, period, interval);
      
      if (history.length === 0) {
        res.status(404).json({ message: `No data available for ${symbol}` });
        return;
      }
      
      setCachedHistory(cacheKey, history);
      res.json(history);
    } catch (error: any) {
      const isRateLimit = error.message?.includes('429');
      console.error(`Error fetching history for ${symbol}:`, error.message || error);
      
      if (isRateLimit) {
        res.status(429).json({ message: `Rate limited - please try again in a few seconds` });
      } else {
        res.status(404).json({ message: `Symbol ${symbol} not found or data unavailable` });
      }
    }
  });

  // --- Stock Quote ---
  app.get(api.stocks.quote.path, async (req, res) => {
    const symbol = String(req.params.symbol);
    try {
      const [quote, meta] = await Promise.all([
        tiingo.fetchCurrentQuote(symbol),
        tiingo.fetchTickerMeta(symbol),
      ]);

      if (!quote) {
        return res.status(404).json({ message: `Symbol ${symbol} not found` });
      }

      const price = quote.tngoLast || 0;
      const prevClose = quote.prevClose || 0;
      const change = prevClose ? price - prevClose : 0;
      const changePercent = prevClose ? (change / prevClose) * 100 : 0;

      const { sector, industry } = await getSectorAndIndustry(symbol.toUpperCase());
      let description = meta?.description || '';
      if (description) {
        const sentences = description.match(/[^.!?]+[.!?]+/g) || [];
        description = sentences.slice(0, 2).join(' ').trim();
      }
      if (!description) {
        description = `${meta?.name || symbol} is a publicly traded company.`;
      }

      const sectorETFs = SECTOR_ETFS[sector] || [];
      const sectorStocks = STOCKS_BY_SECTOR[sector] || [];
      const sameIndustryStocks = sectorStocks
        .filter(s => s.symbol !== symbol && s.industry === industry)
        .sort((a, b) => b.marketCap - a.marketCap);
      const otherSectorStocks = sectorStocks
        .filter(s => s.symbol !== symbol && s.industry !== industry)
        .sort((a, b) => b.marketCap - a.marketCap);
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

      const isETF = ETF_SYMBOLS.has(symbol.toUpperCase());
      const etfHoldings = isETF ? (ETF_HOLDINGS[symbol.toUpperCase()] || []).map(h => ({
        symbol: h.symbol,
        name: h.name,
        weight: h.weight,
        marketCap: h.marketCap,
      })) : undefined;

      res.json({
        symbol: symbol.toUpperCase(),
        price,
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        volume: quote.volume,
        companyName: meta?.name || symbol,
        marketCap: undefined,
        peRatio: undefined,
        sector,
        industry,
        description,
        sectorETFs,
        relatedStocks,
        isETF,
        etfHoldings,
        earnings: undefined,
      });
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      res.status(404).json({ message: `Symbol ${symbol} not found` });
    }
  });

  // --- Industry Comps (for evaluator) ---
  app.get('/api/industry-comps/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    try {
      const { sector, industry } = await getSectorAndIndustry(symbol);
      const sectorETFsList = SECTOR_ETFS[sector] || [];
      const sectorStocks = STOCKS_BY_SECTOR[sector] || [];
      const sameIndustry = sectorStocks
        .filter(s => s.symbol !== symbol && s.industry === industry)
        .sort((a, b) => b.marketCap - a.marketCap);

      let fmpPeers: { symbol: string; name: string; industry: string; marketCap: number }[] = [];
      if (sameIndustry.length < 8 && industry !== 'Unknown') {
        const { fetchIndustryPeersFromFMP } = await import('./fundamentals');
        const localSymbols = new Set(sectorStocks.map(s => s.symbol));
        localSymbols.add(symbol);
        fmpPeers = (await fetchIndustryPeersFromFMP(industry, sector, symbol, 20))
          .filter(p => !localSymbols.has(p.symbol));
      }

      const allSameIndustry = [...sameIndustry, ...fmpPeers];
      const seenSymbols = new Set(allSameIndustry.map(s => s.symbol));
      seenSymbols.add(symbol);
      const otherSector = sectorStocks
        .filter(s => !seenSymbols.has(s.symbol) && s.industry !== industry)
        .sort((a, b) => b.marketCap - a.marketCap);
      const peers = [...allSameIndustry, ...otherSector].slice(0, 20);

      const allSymbols = [...sectorETFsList, ...peers.map(p => p.symbol)];
      const quotes = await Promise.all(
        allSymbols.map(async (sym) => {
          try {
            const q = await tiingo.fetchCurrentQuote(sym);
            if (!q) return null;
            const price = q.tngoLast || 0;
            const prevClose = q.prevClose || 0;
            const change = prevClose ? price - prevClose : 0;
            const changePercent = prevClose ? (change / prevClose) * 100 : 0;
            return { symbol: sym, price, change: Math.round(change * 100) / 100, changePercent: Math.round(changePercent * 100) / 100, volume: q.volume || 0 };
          } catch { return null; }
        })
      );
      const quoteMap: Record<string, any> = {};
      quotes.filter(Boolean).forEach(q => { if (q) quoteMap[q.symbol] = q; });

      res.json({
        sector,
        industry,
        etfs: sectorETFsList.map(etf => ({
          symbol: etf,
          name: etf,
          ...(quoteMap[etf] || { price: 0, change: 0, changePercent: 0, volume: 0 }),
        })),
        peers: peers.map(p => ({
          symbol: p.symbol,
          name: p.name,
          industry: p.industry,
          ...(quoteMap[p.symbol] || { price: 0, change: 0, changePercent: 0, volume: 0 }),
        })),
      });
    } catch (error) {
      console.error(`Error fetching industry comps for ${symbol}:`, error);
      res.status(500).json({ message: 'Failed to fetch industry comps' });
    }
  });

  // --- News (for evaluator) ---
  app.get('/api/news/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    try {
      const articles = await tiingo.fetchNews(symbol, 15);
      res.json(articles);
    } catch (error) {
      console.error(`Error fetching news for ${symbol}:`, error);
      res.json([]);
    }
  });

  // --- Scanner ---
  app.post(api.scanner.run.path, async (req, res) => {
    try {
      const input = api.scanner.run.input.parse(req.body);
      const results = [];

      let watchlistSymbols: string[] = [];
      if (input.scannerIndex === 'watchlist') {
        const watchlistItems = await storage.getWatchlist();
        watchlistSymbols = watchlistItems.map(item => item.symbol);
      }
      const universe = getStocksByIndex(input.scannerIndex, watchlistSymbols);
      
      console.log('[Scanner] Running scan with filters:', {
        index: input.scannerIndex,
        chartPattern: input.chartPattern,
        maxChannelHeightPct: input.maxChannelHeightPct,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        minVolume: input.minVolume,
        smaFilter: input.smaFilter,
        patternStrictness: input.patternStrictness,
        technicalSignal: input.technicalSignal
      });

      for (const symbol of universe) {
        try {
          const quote = await tiingo.fetchCurrentQuote(symbol);
          if (!quote) continue;
          
          const price = quote.tngoLast || 0;
          const volume = quote.volume || 0;
          const prevClose = quote.prevClose || 0;
          const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
          
          if (input.minPrice && price < input.minPrice) {
            continue;
          }
          if (input.maxPrice && price > input.maxPrice) {
            continue;
          }
          
          if (input.minVolume && volume < input.minVolume) {
            continue;
          }

          let matchedPattern: string | undefined = undefined;
          let channelHeightPct: number | undefined = undefined;
          let completionPct: number | undefined = undefined;
          let isCupOnly: boolean = false;
          
          const hasChartFilter = input.chartPattern && input.chartPattern !== 'All';
          const hasTechnicalSignal = input.technicalSignal && input.technicalSignal !== 'none';
          const hasSMAFilter = input.smaFilter && input.smaFilter !== 'none';
          const hasProximityFilter = input.priceWithin50dPct !== undefined;
          const hasChannelHeightFilter = input.maxChannelHeightPct !== undefined && hasChartFilter;
          
          // Determine if we need historical data
          const needsHistory = hasChartFilter || hasTechnicalSignal || hasSMAFilter || hasProximityFilter;
          
          if (needsHistory) {
            const period = (hasSMAFilter || hasProximityFilter) ? '1y' : '3mo';
            const candles = await tiingo.getChartData(symbol, period);
            
            if (candles.length < 5) continue;
            
            if (hasSMAFilter) {
              if (!checkSMAFilter(candles, input.smaFilter!, price)) {
                continue;
              }
            }
            
            if (hasProximityFilter) {
              if (!checkPriceProximity(candles, price, input.priceWithin50dPct)) {
                continue;
              }
            }
            
            // Check chart pattern
            if (hasChartFilter) {
              // FIRST: Calculate channel height and filter by max channel height
              // This happens BEFORE pattern detection so the filter is effective
              channelHeightPct = calculateChannelHeightPct(candles, input.chartPattern!) ?? undefined;
              
              if (hasChannelHeightFilter && channelHeightPct !== undefined) {
                // Explicit numeric conversion to prevent string comparison issues
                const channelNum = Number(channelHeightPct);
                const maxChannelNum = Number(input.maxChannelHeightPct!);
                
                console.log(`[Scanner] ${symbol} channel height check: ${channelNum.toFixed(2)}% vs max ${maxChannelNum}%`);
                
                // Filter OUT stocks where channel height EXCEEDS the max
                // Higher max = more permissive, lower max = tighter filter
                if (channelNum > maxChannelNum) {
                  console.log(`[Scanner] ${symbol} FILTERED OUT: channelHeight ${channelNum.toFixed(2)}% > maxChannelHeight ${maxChannelNum}%`);
                  continue;
                } else {
                  console.log(`[Scanner] ${symbol} PASSED: channelHeight ${channelNum.toFixed(2)}% <= maxChannelHeight ${maxChannelNum}%`);
                }
              }
              
              // THEN: Run pattern detection on stocks that pass channel height filter
              const strictness = input.patternStrictness || 'tight';
              if (!detectChartPattern(
                candles, 
                input.chartPattern!, 
                strictness,
                input.htfTimeframe as 'weekly' | 'daily' | undefined,
                input.htfMinGainPct,
                input.htfPullbackPct
              )) {
                console.log(`[Scanner] ${symbol} filtered: pattern detection failed for ${input.chartPattern}`);
                continue;
              }
              
              matchedPattern = input.chartPattern;
              
              // Calculate completion percentage for Cup and Handle
              if (input.chartPattern === 'Cup and Handle') {
                const cupResult = calculateCupAndHandleCompletion(candles);
                completionPct = cupResult.pct ?? undefined;
                isCupOnly = cupResult.cupOnly;
              }
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
            symbol: symbol,
            price,
            changePercent: Math.round(changePercent * 100) / 100,
            volume,
            matchedPattern,
            sector: 'Technology',
            channelHeightPct,
            completionPct,
            cupOnly: isCupOnly
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
      const symbols = [
        { symbol: 'SPY', label: 'S&P 500' },
        { symbol: 'QQQ', label: 'NASDAQ' },
        { symbol: 'DIA', label: 'Dow' },
        { symbol: 'IWM', label: 'Russell 2K' },
        { symbol: 'GLD', label: 'Gold' },
        { symbol: 'VIXY', label: 'VIX' },
        { symbol: 'RSP', label: 'S&P EW' },
        { symbol: 'QQQE', label: 'NDX EW' },
      ];
      
      const results = await Promise.all(
        symbols.map(async ({ symbol, label }) => {
          try {
            const quote = await tiingo.fetchCurrentQuote(symbol);
            if (!quote) return { symbol, label, price: 0, changePercent: 0 };
            const price = quote.tngoLast || 0;
            const prevClose = quote.prevClose || 0;
            const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
            return {
              symbol,
              label,
              price,
              changePercent: Math.round(changePercent * 100) / 100,
            };
          } catch (error) {
            console.error(`Failed to fetch quote for ${symbol}:`, error);
            return { symbol, label, price: 0, changePercent: 0 };
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

  // Watchlist quotes - get change percent for all watchlist symbols
  app.get('/api/watchlist/quotes', async (req, res) => {
    try {
      const symbols = (req.query.symbols as string || '').split(',').filter(Boolean);
      
      if (symbols.length === 0) {
        const watchlistItems = await storage.getWatchlist();
        symbols.push(...watchlistItems.map(item => item.symbol));
      }
      
      if (symbols.length === 0) {
        return res.json([]);
      }

      const quotes = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const quote = await tiingo.fetchCurrentQuote(symbol);
            if (!quote) return { symbol, changePercent: 0, last: 0 };
            const prevClose = quote.prevClose || 0;
            const price = quote.tngoLast || 0;
            const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
            return {
              symbol,
              last: price,
              changePercent: Math.round(changePercent * 100) / 100,
            };
          } catch (err) {
            return { symbol, changePercent: 0 };
          }
        })
      );
      res.json(quotes);
    } catch (error) {
      console.error('Failed to fetch watchlist quotes:', error);
      res.status(500).json({ message: 'Failed to fetch watchlist quotes' });
    }
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

  // --- Saved Scans ---
  app.get(api.savedScans.list.path, async (req, res) => {
    const scans = await storage.getSavedScans();
    res.json(scans);
  });

  app.post(api.savedScans.create.path, async (req, res) => {
    try {
      const input = api.savedScans.create.input.parse(req.body);
      const scan = await storage.createSavedScan(input.name, input.criteria);
      res.status(201).json(scan);
    } catch (err) {
      console.error('Failed to save scan:', err);
      res.status(400).json({ message: 'Invalid scan data' });
    }
  });

  app.delete(api.savedScans.delete.path, async (req, res) => {
    const { id } = req.params;
    await storage.deleteSavedScan(Number(id));
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
