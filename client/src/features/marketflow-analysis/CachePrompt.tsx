/**
 * CachePrompt - Use Cached vs Re-run for MarketFlow analysis
 */

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export interface CacheMeta {
  exists: boolean;
  generated_at: string | null;
  version: string | null;
  modules_present: string[];
}

interface CachePromptProps {
  symbol: string;
  meta: CacheMeta;
  onUseCached: () => void;
  onReRun: () => void;
  isLoadingCached?: boolean;
  isReRunning?: boolean;
}

export function CachePrompt({
  symbol,
  meta,
  onUseCached,
  onReRun,
  isLoadingCached = false,
  isReRunning = false,
}: CachePromptProps) {
  const hasCache = meta.exists && meta.generated_at;

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 space-y-2">
      <p className="text-sm text-muted-foreground">
        {hasCache ? (
          <>Cached analysis from {meta.generated_at ? new Date(meta.generated_at).toLocaleString() : "—"}</>
        ) : (
          <>No recent cache for {symbol}. Run analysis to generate.</>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onUseCached}
          disabled={!hasCache || isLoadingCached || isReRunning}
        >
          {isLoadingCached ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Use Cached
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={onReRun}
          disabled={isLoadingCached || isReRunning}
        >
          {isReRunning ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          Re-run
        </Button>
      </div>
    </div>
  );
}
