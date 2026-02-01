import { createContext, useContext, useState, type ReactNode } from "react";
import { type ScannerRunInput, type ScannerResult } from "@shared/routes";

import type { Dispatch, SetStateAction } from "react";

interface ScannerContextType {
  filters: ScannerRunInput;
  setFilters: Dispatch<SetStateAction<ScannerRunInput>>;
  results: ScannerResult | null;
  setResults: Dispatch<SetStateAction<ScannerResult | null>>;
  currentPage: number;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  isScanning: boolean;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
}

const defaultFilters: ScannerRunInput = {
  scannerIndex: "sp100",
  minPrice: undefined,
  maxPrice: undefined,
  minVolume: undefined,
  candlestickPattern: "All",
  chartPattern: "All",
  patternStrictness: "tight",
  smaFilter: "none",
  priceWithin50dPct: undefined,
  maxChannelHeightPct: undefined,
  htfTimeframe: "weekly",
  htfMinGainPct: 65,
  htfPullbackPct: 8,
  pbMinGainPct: 30,
  pbUpPeriodCandles: 10,
  pbMinCandles: 1,
  pbMaxCandles: 5,
};

const ScannerContext = createContext<ScannerContextType | undefined>(undefined);

export function ScannerProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<ScannerRunInput>(defaultFilters);
  const [results, setResults] = useState<ScannerResult | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isScanning, setIsScanning] = useState(false);

  return (
    <ScannerContext.Provider
      value={{
        filters,
        setFilters,
        results,
        setResults,
        currentPage,
        setCurrentPage,
        isScanning,
        setIsScanning,
      }}
    >
      {children}
    </ScannerContext.Provider>
  );
}

export function useScannerContext() {
  const context = useContext(ScannerContext);
  if (context === undefined) {
    throw new Error("useScannerContext must be used within a ScannerProvider");
  }
  return context;
}
