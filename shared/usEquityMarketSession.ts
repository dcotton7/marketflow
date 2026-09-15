const ET_TIME_ZONE = "America/New_York";

export type UsEquityMarketSession = "pre_market" | "regular" | "after_hours" | "closed";

type EtClock = {
  dateKey: string;
  weekday: string;
  minuteOfDay: number;
};

const ET_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function getEtClock(at: Date = new Date()): EtClock {
  const parts = ET_CLOCK_FORMATTER.formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const weekday = value("weekday");
  const hour = parseInt(value("hour") || "0", 10) % 24;
  const minute = parseInt(value("minute") || "0", 10);

  return {
    dateKey: `${year}-${month}-${day}`,
    weekday,
    minuteOfDay: hour * 60 + minute,
  };
}

export function getUsEquityMarketSession(at: Date = new Date()): UsEquityMarketSession {
  const { weekday, minuteOfDay } = getEtClock(at);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  if (minuteOfDay >= 4 * 60 && minuteOfDay < 9 * 60 + 30) return "pre_market";
  if (minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60) return "regular";
  if (minuteOfDay >= 16 * 60 && minuteOfDay < 20 * 60) return "after_hours";
  return "closed";
}
