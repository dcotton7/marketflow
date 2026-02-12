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
  hasScanned: boolean;
  setHasScanned: Dispatch<SetStateAction<boolean>>;
  clearAll: () => void;
}

// Initial filters with sensible defaults that show in the UI
const blankFilters: ScannerRunInput = {
  scannerIndex: "sp100",
  minPrice: 7,
  maxPrice: undefined,
  minVolume: 500000,
  chartPattern: "All",
  patternStrictness: "tight",
  smaFilter: "none",
  priceWithin50dPct: undefined,
  maxChannelHeightPct: undefined,
  htfTimeframe: "weekly",
  htfMinGainPct: 65,
  htfPullbackPct: 8,
  technicalSignal: "none",
  crossDirection: "up",
  emaBreakThresholdPct: 1,
  emaPbThresholdPct: 2.5,
  pbMinGainPct: 15, // Default for 5/10 DMA (will be adjusted per signal)
  pbUpPeriodCandles: 10,
  pbMinCandles: 1,
  pbMaxCandles: 5,
};

const ScannerContext = createContext<ScannerContextType | undefined>(undefined);

export function ScannerProvider({ children }: { children: ReactNode }) {
  // Start with blank filters (no results, no criteria shown)
  const [filters, setFilters] = useState<ScannerRunInput>(blankFilters);
  const [results, setResults] = useState<ScannerResult | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);

  const clearAll = () => {
    setFilters(blankFilters);
    setResults(null);
    setCurrentPage(1);
    setHasScanned(false);
  };

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
        hasScanned,
        setHasScanned,
        clearAll,
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

export function useScannerContextSafe() {
  return useContext(ScannerContext);
}
