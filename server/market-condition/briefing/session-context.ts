import {
  getMarketDateTime,
  subtractTradingDays,
  type RaceTerminalState,
} from "../utils/theme-tracker-time";
import {
  getLatestMarketDateWithHourlySnapshots,
  listIntradaySnapshotSlots,
} from "../engine/theme-snapshots";
import type { BriefingMode, BriefingPreview } from "./types";

const ET = "America/New_York";
/** Enough stored slots to treat today's session as the post-market reference. */
const MIN_SLOTS_FOR_TODAY_SESSION = 12;

export interface BriefingSessionContext {
  mode: BriefingMode;
  referenceSession: string;
  priorSession: string | null;
  terminalState: RaceTerminalState;
  anchor: Date;
  /** Set when post-mode uses a prior stored session instead of calendar today. */
  sessionFallbackNote?: string;
}

function getFallbackTerminalState(anchor: Date): RaceTerminalState {
  const etNow = new Date(anchor.toLocaleString("en-US", { timeZone: ET }));
  const day = etNow.getDay();
  if (day === 0 || day === 6) return "CLOSED";
  const mins = etNow.getHours() * 60 + etNow.getMinutes();
  if (mins < 9 * 60 + 30) return "PRE_OPEN";
  if (mins < 16 * 60) return "LIVE";
  return "AFTER_HOURS";
}

function formatMarketDateET(d: Date): string {
  const etString = d.toLocaleString("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [month, day, year] = etString.split(/[/, ]/);
  return `${year}-${month}-${day}`;
}

function priorTradingDateSync(anchor: Date): string {
  return formatMarketDateET(subtractTradingDays(anchor, 1));
}

export function resolveBriefingMode(requested: string | undefined, anchor: Date = new Date()): BriefingMode {
  if (requested === "pre" || requested === "post") return requested;
  const state = getFallbackTerminalState(anchor);
  if (state === "PRE_OPEN") return "pre";
  return "post";
}

async function resolvePostReferenceSession(
  anchor: Date
): Promise<{ referenceSession: string; priorSession: string | null; sessionFallbackNote?: string }> {
  const { date: todayEt } = getMarketDateTime(anchor);
  const prior = priorTradingDateSync(anchor);
  const todaySlots = await listIntradaySnapshotSlots(todayEt);

  if (todaySlots.length >= MIN_SLOTS_FOR_TODAY_SESSION) {
    return { referenceSession: todayEt, priorSession: prior };
  }

  const latestStored = await getLatestMarketDateWithHourlySnapshots();
  if (latestStored && latestStored !== todayEt) {
    const storedSlots = await listIntradaySnapshotSlots(latestStored);
    if (storedSlots.length > 0) {
      const priorStored = priorTradingDateSync(new Date(`${latestStored}T12:00:00`));
      return {
        referenceSession: latestStored,
        priorSession: priorStored,
        sessionFallbackNote:
          todaySlots.length === 0
            ? `Post-market report uses last stored session (${latestStored}) — no hourly tape saved yet for ${todayEt}.`
            : `Post-market report uses last complete stored session (${latestStored}) — today's tape is partial (${todaySlots.length} slots).`,
      };
    }
  }

  return { referenceSession: todayEt, priorSession: prior };
}

export async function resolveBriefingSession(
  mode: BriefingMode,
  anchor: Date = new Date()
): Promise<BriefingSessionContext> {
  const terminalState = getFallbackTerminalState(anchor);
  const prior = priorTradingDateSync(anchor);

  if (mode === "pre") {
    return {
      mode,
      referenceSession: prior,
      priorSession: null,
      terminalState,
      anchor,
    };
  }

  const post = await resolvePostReferenceSession(anchor);
  return {
    mode,
    referenceSession: post.referenceSession,
    priorSession: post.priorSession,
    terminalState,
    anchor,
    sessionFallbackNote: post.sessionFallbackNote,
  };
}

function formatSessionLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: ET,
  });
}

export async function buildBriefingPreviews(anchor: Date = new Date()): Promise<BriefingPreview[]> {
  const { date: todayEt } = getMarketDateTime(anchor);
  const prior = priorTradingDateSync(anchor);
  const terminalState = getFallbackTerminalState(anchor);
  const recommendPost =
    terminalState === "AFTER_HOURS" || terminalState === "CLOSED" || terminalState === "LIVE";
  const recommendPre = terminalState === "PRE_OPEN";

  const postRef = (await resolvePostReferenceSession(anchor)).referenceSession;

  return [
    {
      mode: "post",
      label: "Post-market briefing",
      referenceSession: postRef,
      description: `Theme flow for ${formatSessionLabel(postRef)} — session ranks, rotation, late moves, and catalysts where evidence exists.`,
      recommended: recommendPost && !recommendPre,
    },
    {
      mode: "pre",
      label: "Pre-market briefing",
      referenceSession: prior,
      description: `Prepare for the open using ${formatSessionLabel(prior)} close data, intraday tape (if stored), and partial overnight context.`,
      recommended: recommendPre,
    },
  ];
}
