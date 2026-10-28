import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { LineChart } from "lucide-react";
import { TickerReviewChartViewer } from "@/components/market-condition/TickerReviewChartViewer";
import { onHostCommand, postToHost } from "@/lib/embed-host";

const SYMBOL_RX = /^[A-Z0-9.\-^/]{1,12}$/;
const MAX_HISTORY = 30;

/**
 * /embed/big-chart — the Market Flow daily + intraday chart pair for Anima's floating chart window.
 * The host sends { source: "anima", type: "set-symbol" } to switch ticker without a reload; prev / next walk
 * the tickers opened this session. Close tells the host to close its window. ?eth=1 starts with extended hours on.
 */
export default function EmbedBigChartPage() {
  const search = useSearch();
  const initial = useMemo(() => {
    const s = new URLSearchParams(search).get("symbol")?.trim().toUpperCase() ?? "";
    return SYMBOL_RX.test(s) ? s : "";
  }, [search]);
  const eth = useMemo(() => ["1", "true", "on"].includes(new URLSearchParams(search).get("eth") ?? ""), [search]);
  const [history, setHistory] = useState<string[]>(initial ? [initial] : []);
  const [current, setCurrent] = useState(initial);

  useEffect(() => {
    postToHost({ type: "ready", page: "big-chart" });
    return onHostCommand((cmd) => {
      if (cmd.type !== "set-symbol") return;
      setHistory((h) => [...h.filter((s) => s !== cmd.symbol), cmd.symbol].slice(-MAX_HISTORY));
      setCurrent(cmd.symbol);
    });
  }, []);

  useEffect(() => {
    if (current) postToHost({ type: "symbol", symbol: current });
  }, [current]);

  const close = () => {
    if (!postToHost({ type: "close-big" })) window.close();
  };

  if (!current || history.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-slate-950 text-center text-xs text-slate-500">
        <LineChart className="h-6 w-6 opacity-40" />
        <span className="text-slate-300">No ticker yet.</span>
        <span>Type a ticker in the window title bar.</span>
      </div>
    );
  }

  return (
    <TickerReviewChartViewer
      open
      symbols={history}
      startIndex={Math.max(0, history.indexOf(current))}
      onClose={close}
      queueLabel="MarketFlow charts"
      contextLabel="MarketFlow charts"
      closeReturnLabel="Close chart window"
      initialShowETH={eth}
    />
  );
}
