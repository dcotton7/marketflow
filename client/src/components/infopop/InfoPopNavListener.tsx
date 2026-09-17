import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  INFOPOP_CHANNEL,
  INFOPOP_STORAGE_KEY,
  type InfoPopMessage,
} from "./infopop-channel";

/** Main-window listener: ticker clicks in InfoPop drive Charts here. */
export function InfoPopNavListener() {
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (location.startsWith("/infopop")) return;
    const ch = new BroadcastChannel(INFOPOP_CHANNEL);
    ch.onmessage = (ev: MessageEvent<InfoPopMessage>) => {
      if (ev.data.type === "INFOPOP_CLOSED") {
        try {
          localStorage.removeItem(INFOPOP_STORAGE_KEY);
        } catch {
          /* ignore */
        }
      } else if (ev.data.type === "INFOPOP_NAVIGATE") {
        navigate(ev.data.path);
        try {
          window.focus();
        } catch {
          /* ignore */
        }
      }
    };
    return () => {
      ch.close();
    };
  }, [location, navigate]);

  return null;
}
