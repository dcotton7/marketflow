// ETFs tab for Focused Theme (Flow Map): only the selected theme’s proxies, bucketed by type.
// Symbol clicks use the same handler as Theme Members (Choose On Click Action).
import type { ETFProxy, ThemeRow } from "@/data/mockThemeData";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

const ETF_TYPE_COLORS: Record<string, string> = {
  direct: "bg-green-500/20 text-green-400 border-green-500/30",
  adjacent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  macro: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  hedge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  inverse: "bg-red-500/20 text-red-300 border-red-500/30",
  leveraged: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  other: "bg-slate-500/20 text-slate-300 border-slate-500/35",
};

type EtfBucket = "themeEtfs" | "leveraged" | "shorts" | "macroHedge" | "other";

/**
 * Buckets every `etfProxies` row for the focused theme.
 * Canonical `proxyType` values (trimmed, lowercased) match
 * `ETFProxyType` in `server/market-condition/universe.ts` and `useMarketCondition`:
 * `direct`, `adjacent`, `macro`, `hedge`, `inverse`, `leveraged`.
 * Anything else (missing / typo / future type) → `other` so nothing is dropped or mislabeled.
 */
function partitionProxies(proxies: ETFProxy[]) {
  const themeEtfs: ETFProxy[] = [];
  const leveraged: ETFProxy[] = [];
  const shorts: ETFProxy[] = [];
  const macroHedge: ETFProxy[] = [];
  const other: ETFProxy[] = [];

  for (const p of proxies) {
    const t = (p.proxyType ?? "").trim().toLowerCase();
    switch (t) {
      case "leveraged":
        leveraged.push(p);
        break;
      case "inverse":
        shorts.push(p);
        break;
      case "macro":
      case "hedge":
        macroHedge.push(p);
        break;
      case "direct":
      case "adjacent":
        themeEtfs.push(p);
        break;
      default:
        other.push(p);
    }
  }

  if (import.meta.env.DEV) {
    const n =
      themeEtfs.length +
      leveraged.length +
      shorts.length +
      macroHedge.length +
      other.length;
    if (n !== proxies.length) {
      console.error(
        "[ThemeDetailPanelEtfs] partition count mismatch",
        n,
        "vs",
        proxies.length
      );
    }
  }

  return { themeEtfs, leveraged, shorts, macroHedge, other };
}

const BUCKET_META: Record<EtfBucket, { title: string; hint: string }> = {
  themeEtfs: {
    title: "ETFs",
    hint: "Direct and adjacent proxies for this theme.",
  },
  leveraged: {
    title: "Leveraged ETFs",
    hint: "Leveraged exposure to the theme or benchmark.",
  },
  shorts: {
    title: "Short / inverse ETFs",
    hint: "Inverse or short-benchmark vehicles.",
  },
  macroHedge: {
    title: "Macro & hedge",
    hint: "Macro = broad sector or index proxies (e.g. SPY, sector SPDRs). Hedge = defensive / diversifying sleeves (e.g. staples vs discretionary, TLT, GLD).",
  },
  other: {
    title: "Other",
    hint: "Missing or non-standard proxyType from data — still included and clickable.",
  },
};

function EtfRow({
  proxy,
  themeName,
  onSymbolClick,
}: {
  proxy: ETFProxy;
  themeName: string;
  onSymbolClick: (symbol: string) => void;
}) {
  const proxyName = proxy.name?.trim();
  const displayName =
    proxyName || `${themeName} · ${proxy.proxyType} proxy`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded p-1.5 text-left transition-colors hover:bg-slate-700/50"
          onClick={() => onSymbolClick(proxy.symbol)}
        >
          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "px-1 text-[10px]",
                ETF_TYPE_COLORS[
                  (proxy.proxyType ?? "").trim().toLowerCase()
                ] ?? ETF_TYPE_COLORS.other
              )}
            >
              {proxy.proxyType}
            </Badge>
            <span className="font-mono text-sm font-medium transition-colors group-hover:text-cyan-400">
              {proxy.symbol}
            </span>
          </div>
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
            {displayName}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-sm space-y-1 text-xs">
        <p className="font-semibold text-foreground">{themeName}</p>
        <p>
          <span className="font-mono">{proxy.symbol}</span>
          {proxyName ? (
            <> — {proxyName}</>
          ) : (
            <> — Uses Choose On Click Action from Theme Members.</>
          )}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function BucketBlock({
  bucket,
  proxies,
  themeName,
  onSymbolClick,
}: {
  bucket: EtfBucket;
  proxies: ETFProxy[];
  themeName: string;
  onSymbolClick: (symbol: string) => void;
}) {
  if (proxies.length === 0) return null;
  const meta = BUCKET_META[bucket];
  return (
    <div className="rounded border border-slate-700/40 bg-slate-800/30 p-2">
      <div className="mb-1.5 flex items-center gap-1">
        <span className="text-[11px] font-semibold text-slate-200">
          {meta.title}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 shrink-0 cursor-help text-slate-500" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{meta.hint}</TooltipContent>
        </Tooltip>
      </div>
      <div className="space-y-0.5">
        {proxies.map((p) => (
          <EtfRow
            key={`${p.symbol}-${p.proxyType}`}
            proxy={p}
            themeName={themeName}
            onSymbolClick={onSymbolClick}
          />
        ))}
      </div>
    </div>
  );
}

export interface ThemeDetailPanelEtfsProps {
  theme: ThemeRow | null;
  onEtfSymbolClick: (symbol: string) => void;
}

export function ThemeDetailPanelEtfs({
  theme,
  onEtfSymbolClick,
}: ThemeDetailPanelEtfsProps) {
  if (!theme) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Select a theme in the flow map to see its ETF proxies here.
      </div>
    );
  }

  const proxies = theme.etfProxies ?? [];
  const parts = partitionProxies(proxies);

  return (
    <div className="space-y-3 p-2 pb-4">
      <p className="flex items-start gap-1.5 rounded border border-slate-700/40 bg-slate-800/40 px-2 py-1.5 text-[10px] leading-snug text-slate-400">
        <Info className="mt-0.5 h-3 w-3 shrink-0 text-cyan-500/80" />
        <span>
          <span className="font-medium text-slate-300">{theme.name}</span>
          {" — "}
          Each row uses the same{" "}
          <span className="font-medium text-slate-300">Choose On Click Action</span>{" "}
          as Theme Members: MarketSurge sync, internal charts, detailed analysis, or
          default chart navigation when none are enabled.
        </span>
      </p>

      {proxies.length === 0 ? (
        <div className="rounded border border-dashed border-slate-600/50 p-4 text-center text-xs text-muted-foreground">
          No ETF proxies are configured for this theme yet.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <BucketBlock
            bucket="themeEtfs"
            proxies={parts.themeEtfs}
            themeName={theme.name}
            onSymbolClick={onEtfSymbolClick}
          />
          <BucketBlock
            bucket="leveraged"
            proxies={parts.leveraged}
            themeName={theme.name}
            onSymbolClick={onEtfSymbolClick}
          />
          <BucketBlock
            bucket="shorts"
            proxies={parts.shorts}
            themeName={theme.name}
            onSymbolClick={onEtfSymbolClick}
          />
          <BucketBlock
            bucket="macroHedge"
            proxies={parts.macroHedge}
            themeName={theme.name}
            onSymbolClick={onEtfSymbolClick}
          />
          <BucketBlock
            bucket="other"
            proxies={parts.other}
            themeName={theme.name}
            onSymbolClick={onEtfSymbolClick}
          />
        </div>
      )}
    </div>
  );
}
