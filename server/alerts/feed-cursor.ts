const MAX_LIMIT = 50;

const id = (v: unknown): number | null => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return v != null && v !== "" && Number.isInteger(n) && n >= 0 ? n : null;
};

/** ?after=<position alert id>&events_after=<alert event id>&limit=; a missing or bad id is null. */
export function parseFeedCursor(query: Record<string, unknown>) {
  const limit = Number(query.limit);
  return {
    after: id(query.after),
    eventsAfter: id(query.events_after),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(MAX_LIMIT, limit) : MAX_LIMIT,
  };
}
