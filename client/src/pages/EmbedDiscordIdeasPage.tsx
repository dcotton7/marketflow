import { useEffect } from "react";
import { DiscordRoomIdeas } from "@/components/discord/DiscordRoomIdeas";
import { DEFAULT_TRADERS } from "@/components/discord/discord-trade-seen";
import { useSystemSettings } from "@/context/SystemSettingsContext";
import { postToHost } from "@/lib/embed-host";

/**
 * /embed/discord-ideas — the Discord room's ideas (tickers, trade calls) for an Anima Lab panel. Clicking a ticker
 * opens its big chart in Anima.
 */
export default function EmbedDiscordIdeasPage() {
  const { pageShellStyle } = useSystemSettings();

  useEffect(() => {
    postToHost({ type: "ready", page: "discord-ideas" });
  }, []);

  return (
    <div className="sentinel-page h-dvh overflow-auto p-1" style={pageShellStyle as React.CSSProperties}>
      <DiscordRoomIdeas traders={DEFAULT_TRADERS} onSymbol={(symbol) => postToHost({ type: "open-big", symbol })} />
    </div>
  );
}
