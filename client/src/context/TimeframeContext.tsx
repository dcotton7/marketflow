import { createContext, useContext, useState, ReactNode } from "react";

type TimeframeValue = '5m' | '15m' | '30m' | '60m' | '1d' | '1wk' | '1mo';

interface TimeframeContextType {
  globalTimeframe: TimeframeValue;
  setGlobalTimeframe: (tf: TimeframeValue) => void;
}

const TimeframeContext = createContext<TimeframeContextType | undefined>(undefined);

export function TimeframeProvider({ children }: { children: ReactNode }) {
  const [globalTimeframe, setGlobalTimeframe] = useState<TimeframeValue>('1d');

  return (
    <TimeframeContext.Provider value={{ globalTimeframe, setGlobalTimeframe }}>
      {children}
    </TimeframeContext.Provider>
  );
}

export function useTimeframeContext() {
  const context = useContext(TimeframeContext);
  if (!context) {
    throw new Error("useTimeframeContext must be used within a TimeframeProvider");
  }
  return context;
}
