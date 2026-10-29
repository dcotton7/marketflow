import { z } from "zod";

/** The row fields a plan write may set: Don's own corrections in Quinn's chat ("NTRA entry is 380.20", "my PANW stop
 *  is 360", "I have 50 shares of META", "I'm short CRWD"). */
export const PLAN_FIELDS = ["targetEntry", "stopPlan", "entryDate", "shares", "direction"] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];

const price = z.number().finite().positive().nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD").nullable();
const fields = {
  targetEntry: price,
  stopPlan: price,
  entryDate: day,
  shares: z.number().finite().min(0).nullable(),
  direction: z.enum(["long", "short"]),
};

export const planWriteSchema = z
  .object({
    ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
    /** What the caller last read for each field it sets; the write lands only on a row that still holds it. */
    expect: z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.nullable().optional()]))).strict(),
  })
  .strict()
  .refine((b) => PLAN_FIELDS.some((k) => (b as Record<string, unknown>)[k] !== undefined), "Nothing to set")
  .refine((b) => PLAN_FIELDS.every((k) => (b as Record<string, unknown>)[k] === undefined || k in (b.expect as object)),
    "expect must give the current value of every field set");

export type PlanWrite = { set: Partial<Record<PlanField, unknown>>; expect: Partial<Record<PlanField, unknown>> };

type Row = { userId: number } & Partial<Record<PlanField, unknown>>;

const same = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9) ||
  (a instanceof Date && typeof b === "string" && a.toISOString().slice(0, 10) === b);

/** Checks a plan write against the row as read: 404/403/400, 409 with the row's current values when any field the
 *  caller expected has changed, else what to set and the values the conditional UPDATE must still find. */
export function checkPlanWrite(
  item: Row | null | undefined,
  userId: number | undefined,
  body: unknown,
): { status: 200; write: PlanWrite } | { status: 400 | 403 | 404 | 409; error: string; current?: Record<string, unknown> } {
  if (!item) return { status: 404, error: "Watchlist item not found" };
  if (!userId || item.userId !== userId) return { status: 403, error: "Forbidden" };
  const parsed = planWriteSchema.safeParse(body);
  if (!parsed.success) return { status: 400, error: parsed.error.errors[0].message };
  const b = parsed.data as Record<string, unknown> & { expect: Record<string, unknown> };
  const set: PlanWrite["set"] = {};
  const expect: PlanWrite["expect"] = {};
  for (const k of PLAN_FIELDS) {
    if (b[k] === undefined) continue;
    set[k] = b[k];
    expect[k] = b.expect[k] ?? null;
  }
  const changed = (Object.keys(set) as PlanField[]).filter((k) => !same(item[k], expect[k]));
  if (changed.length)
    return { status: 409, error: `Changed since it was read: ${changed.join(", ")}`,
      current: Object.fromEntries(PLAN_FIELDS.map((k) => [k, item[k] ?? null])) };
  return { status: 200, write: { set, expect } };
}
