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

// Initial blank state - no filters selected until user makes a choice
const blankFilters: ScannerRunInput = {
  scannerIndex: "sp100",
  minPrice: undefined,
  maxPrice: undefined,
  minVolume: undefined,
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
  pbMinGainPct: 30,
  pbUpPeriodCandles: 10,
  pbMinCandles: 1,
  pbMaxCandles: 5,
};

// Default filters when starting a scan (with sensible defaults)
const defaultFilters: ScannerRunInput = {
  ...blankFilters,
  minPrice: 7,
  minVolume: 500000,
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
