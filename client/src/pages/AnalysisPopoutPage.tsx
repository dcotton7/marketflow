/**
 * Standalone page for the Detailed Analysis report (detached window).
 * Reads ?symbol= from URL and listens for postMessage SYMBOL_CHANGE to update symbol.
 */
import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { AnalysisPanel } from "@/features/marketflow-analysis";

export default function AnalysisPopoutPage() {
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialSymbol = urlParams.get("symbol")?.toUpperCase() || "";

  const [symbol, setSymbol] = useState(initialSymbol);

  // React to URL changes (e.g. user navigates in popout)
  useEffect(() => {
    const urlParams = new URLSearchParams(searchString);
    const newSymbol = urlParams.get("symbol")?.toUpperCase() || "";
    if (newSymbol !== symbol) setSymbol(newSymbol);
  }, [searchString]);

  // Listen for postMessage from parent (e.g. Market Condition page driving this window)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "SYMBOL_CHANGE") {
        const newSymbol = event.data.symbol?.toUpperCase();
        if (newSymbol) setSymbol(newSymbol);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <div className="min-h-screen bg-slate-950">
      <AnalysisPanel
        symbol={symbol || null}
        open={true}
        onOpenChange={() => {}}
        showDetach={false}
      />
    </div>
  );
}
