import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CssVariables } from "@/context/SystemSettingsContext";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { StartHereWidgetChrome } from "./StartHereWidgetChrome";
import { StartHereGroupPicker, useStartHere, useStartHereGroup } from "./StartHereContext";
import { startHereNewsModeStorageKey } from "./dashboard-persistence";

export type NewsPortalMode = "ticker" | "top";

interface NewsArticle {
  id: number;
  headline: string;
  summary: string;
  url: string;
  source: string;
  datetime: number;
  image?: string;
}

export function NewsPortalWidget({
  cssVariables,
  userId,
  instanceId,
  groupId,
  accentColor,
  onClose,
}: {
  cssVariables: CssVariables;
  userId: number;
  instanceId: string;
  groupId: string;
  accentColor?: string;
  onClose: () => void;
}) {
  const { symbol, accentLabel } = useStartHereGroup(groupId);
  const { activeStartId } = useStartHere();
  const sym = symbol.trim().toUpperCase();
  const modeStorageKey = startHereNewsModeStorageKey(
    userId,
    instanceId,
    activeStartId
  );

  const [mode, setMode] = useState<NewsPortalMode>("ticker");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(modeStorageKey);
      if (raw === "top" || raw === "ticker") setMode(raw);
    } catch {
      /* ignore */
    }
  }, [modeStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(modeStorageKey, mode);
    } catch {
      /* ignore */
    }
  }, [modeStorageKey, mode]);

  const { data: tickerNews, isLoading: tickerLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", "ticker", sym],
    enabled: mode === "ticker" && !!sym,
    queryFn: async () => {
      const res = await fetch(`/api/news/${sym}?days=14`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: topNews, isLoading: topLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", "top"],
    enabled: mode === "top",
    queryFn: async () => {
      const res = await fetch("/api/news/top", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch top news");
      return res.json();
    },
    staleTime: 60_000,
  });

  const loading = mode === "ticker" ? tickerLoading : topLoading;
  const articles = mode === "ticker" ? tickerNews : topNews;

  const toggle = (
    <div className="flex items-center gap-2">
      <StartHereGroupPicker instanceId={instanceId} cssVariables={cssVariables} />
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(v) => {
          if (v === "ticker" || v === "top") setMode(v);
        }}
        className="h-8 justify-end"
      >
        <ToggleGroupItem value="ticker" aria-label="Ticker news" className="px-2 text-xs">
          Ticker News
        </ToggleGroupItem>
        <ToggleGroupItem value="top" aria-label="Top news" className="px-2 text-xs">
          Top News
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );

  return (
    <StartHereWidgetChrome
      title="News"
      cssVariables={cssVariables}
      onClose={onClose}
      headerExtra={toggle}
      accentColor={accentColor}
      accentLabel={accentLabel}
    >
      <div className="flex h-full min-h-0 flex-col">
        {mode === "ticker" && !sym ? (
          <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
            Pick a ticker from a linked watchlist or enter one in Chart preview.
          </p>
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: cssVariables.textColorSmall }} />
          </div>
        ) : !articles?.length ? (
          <p style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeSmall }}>
            No articles found.
          </p>
        ) : (
          <ScrollArea className="min-h-0 flex-1 pr-2">
            <ul className="space-y-2">
              {articles.slice(0, 25).map((article, idx) => (
                <li key={`${article.id}-${article.datetime}-${idx}`}>
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-md border p-2 transition-colors hover:bg-white/5"
                    style={{
                      borderColor: `${cssVariables.secondaryOverlayColor}44`,
                      color: cssVariables.textColorNormal,
                      fontSize: cssVariables.fontSizeSmall,
                    }}
                  >
                    <div className="font-medium" style={{ color: cssVariables.textColorHeader }}>
                      {article.headline}
                    </div>
                    {article.summary ? (
                      <p
                        className="mt-1 line-clamp-2"
                        style={{ color: cssVariables.textColorSmall, fontSize: cssVariables.fontSizeTiny }}
                      >
                        {article.summary}
                      </p>
                    ) : null}
                    <div
                      className="mt-1 flex gap-2"
                      style={{ color: cssVariables.textColorTiny, fontSize: cssVariables.fontSizeTiny }}
                    >
                      <span>{article.source}</span>
                      <span>·</span>
                      <span>{new Date(article.datetime * 1000).toLocaleDateString()}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
    </StartHereWidgetChrome>
  );
}
