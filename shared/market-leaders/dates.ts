/** A date the leaders book can rank. Empty or mistyped years stay unset. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function marketDateOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iso = value.trim().slice(0, 10);
  const match = ISO.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maxYear = new Date().getUTCFullYear() + 1;
  if (year < 2000 || year > maxYear) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return iso;
}
