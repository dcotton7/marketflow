/**
 * SEC EDGAR route for earnings dates and reported numbers (research/fundamentals/REPORT.md, "Build-ready
 * definition"). Switched OFF until SEC_USER_AGENT holds a real name and contact email (the SEC asks automated
 * clients for one, and Don has not chosen it yet): with it empty the job does nothing and says so in the log.
 *
 * Tables (append-only, never pruned; every row keyed by when it became public):
 *   sec_ticker_map  ticker <-> CIK, one snapshot a day the job runs
 *   sec_filings     every filing of the forms used, with the acceptance time and 8-K items
 *   sec_facts       XBRL facts, one row per (filing, concept, unit, period): a restatement is a new row from its
 *                   own filing, so a read "as of D" uses only rows with filed <= D
 * Phase 2 (13F holdings) is not laid here.
 */
import { sql } from "drizzle-orm";

export const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS sec_ticker_map (snapshot_date DATE NOT NULL, ticker TEXT NOT NULL, cik INTEGER NOT NULL, name TEXT, exchange TEXT, PRIMARY KEY (snapshot_date, ticker))`,
  `CREATE TABLE IF NOT EXISTS sec_filings (accession_no TEXT PRIMARY KEY, cik INTEGER NOT NULL, form TEXT NOT NULL, filing_date DATE NOT NULL, accepted_at TIMESTAMPTZ NOT NULL, report_date DATE, items TEXT, primary_doc TEXT, first_seen_at TIMESTAMPTZ DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS idx_sec_filings_cik ON sec_filings (cik, accepted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sec_filings_form ON sec_filings (form, accepted_at)`,
  `CREATE TABLE IF NOT EXISTS sec_facts (accession_no TEXT NOT NULL, cik INTEGER NOT NULL, taxonomy TEXT NOT NULL, concept TEXT NOT NULL, unit TEXT NOT NULL, period_start DATE, period_end DATE NOT NULL, fy INTEGER, fp TEXT, form TEXT, filed DATE NOT NULL, value DOUBLE PRECISION NOT NULL, frame TEXT, first_seen_at TIMESTAMPTZ DEFAULT NOW())`,
  // period_start is NULL for instant facts, so the key is a unique index over COALESCE (a primary key cannot hold NULL)
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sec_facts ON sec_facts (accession_no, taxonomy, concept, unit, period_end, COALESCE(period_start, '0001-01-01'::date))`,
  `CREATE INDEX IF NOT EXISTS idx_sec_facts_cik ON sec_facts (cik, concept, filed)`,
];

export const FORMS = /^(8-K|8-K\/A|10-Q|10-Q\/A|10-K|10-K\/A|6-K|20-F|40-F|S-1|S-1\/A|S-3|S-3ASR|424B\d|SC 13D|SC 13G|SC 13D\/A|SC 13G\/A)$/;
const PERIODIC = /^(10-Q|10-K|20-F|40-F)(\/A)?$/;
export const CONCEPTS: Record<string, string[]> = {
  "us-gaap": ["EarningsPerShareDiluted", "EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "NetIncomeLoss", "OperatingIncomeLoss", "GrossProfit", "StockholdersEquity", "CashAndCashEquivalentsAtCarryingValue", "LongTermDebt", "WeightedAverageNumberOfDilutedSharesOutstanding"],
  dei: ["EntityCommonStockSharesOutstanding", "EntityPublicFloat"],
  "ifrs-full": ["Revenue", "ProfitLoss", "BasicEarningsLossPerShare", "DilutedEarningsLossPerShare"],
};

export function secUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  return (env.SEC_USER_AGENT ?? "").trim();
}

export interface FilingRow { accessionNo: string; cik: number; form: string; filingDate: string; acceptedAt: string; reportDate: string | null; items: string | null; primaryDoc: string | null }
export interface FactRow { accessionNo: string; cik: number; taxonomy: string; concept: string; unit: string; periodStart: string | null; periodEnd: string; fy: number | null; fp: string | null; form: string | null; filed: string; value: number; frame: string | null }

/** Filings of the kept forms from a submissions "recent" block (or one of its older pages). */
export function parseFilings(cik: number, block: any): FilingRow[] {
  const out: FilingRow[] = [];
  const f = block ?? {};
  (f.form ?? []).forEach((form: string, i: number) => {
    if (!FORMS.test(form)) return;
    const accepted = f.acceptanceDateTime?.[i];
    if (!accepted || !f.accessionNumber?.[i] || !f.filingDate?.[i]) return;
    out.push({
      accessionNo: f.accessionNumber[i], cik, form, filingDate: f.filingDate[i], acceptedAt: accepted,
      reportDate: f.reportDate?.[i] || null, items: f.items?.[i] || null, primaryDoc: f.primaryDocument?.[i] || null,
    });
  });
  return out;
}

/** Every version of the kept concepts from a companyfacts response. */
export function parseFacts(cik: number, cf: any): FactRow[] {
  const out: FactRow[] = [];
  for (const [tax, list] of Object.entries(CONCEPTS)) {
    for (const concept of list) {
      const g = cf?.facts?.[tax]?.[concept];
      if (!g?.units) continue;
      for (const [unit, vals] of Object.entries<any[]>(g.units)) {
        for (const v of vals) {
          if (!v?.accn || !v.end || !v.filed || typeof v.val !== "number") continue;
          out.push({ accessionNo: v.accn, cik, taxonomy: tax, concept, unit, periodStart: v.start ?? null, periodEnd: v.end, fy: v.fy ?? null, fp: v.fp ?? null, form: v.form ?? null, filed: v.filed, value: v.val, frame: v.frame ?? null });
        }
      }
    }
  }
  return out;
}

/** The first session that could react to an 8-K accepted at `acceptedAt`: before 16:00 ET on a session, that session. */
export function reactionSession(acceptedAt: string, sessions: string[]): string | null {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(new Date(acceptedAt)).map((x) => [x.type, x.value]),
  );
  const d = `${p.year}-${p.month}-${p.day}`, mins = (Number(p.hour) % 24) * 60 + Number(p.minute);
  if (sessions.includes(d) && mins < 960) return d;
  return sessions.find((s) => s > d) ?? null;
}

type Exec = { execute: (q: any) => Promise<any> };
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const affected = (r: any): number => Number(r?.rowCount ?? r?.affectedRows ?? 0);

export async function insertFilings(db: Exec, rows: FilingRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 300) {
    const v = rows.slice(i, i + 300).map((r) => sql`(${r.accessionNo}, ${r.cik}, ${r.form}, ${r.filingDate}::date, ${r.acceptedAt}::timestamptz, ${r.reportDate}::date, ${r.items}, ${r.primaryDoc})`);
    n += affected(await db.execute(sql`INSERT INTO sec_filings (accession_no, cik, form, filing_date, accepted_at, report_date, items, primary_doc) VALUES ${sql.join(v, sql`, `)} ON CONFLICT (accession_no) DO NOTHING`));
  }
  return n;
}
export async function insertFacts(db: Exec, rows: FactRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const v = rows.slice(i, i + 500).map((r) => sql`(${r.accessionNo}, ${r.cik}, ${r.taxonomy}, ${r.concept}, ${r.unit}, ${r.periodStart}::date, ${r.periodEnd}::date, ${r.fy}, ${r.fp}, ${r.form}, ${r.filed}::date, ${r.value}, ${r.frame})`);
    n += affected(await db.execute(sql`INSERT INTO sec_facts (accession_no, cik, taxonomy, concept, unit, period_start, period_end, fy, fp, form, filed, value, frame) VALUES ${sql.join(v, sql`, `)} ON CONFLICT DO NOTHING`));
  }
  return n;
}

/** An HTTP getter that keeps to the SEC's limit (5 requests a second here; it allows 10) with the given User-Agent. */
export function secGetter(ua: string, fetchImpl: typeof fetch = fetch) {
  let last = 0;
  return async (url: string): Promise<any | null> => {
    for (let a = 0; a < 4; a++) {
      const wait = 210 - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const r = await fetchImpl(url, { headers: { "User-Agent": ua, Accept: "application/json" } }).catch(() => null);
      if (r?.status === 404) return null;
      if (r?.ok) return r.json();
      await new Promise((res) => setTimeout(res, 3000 * (a + 1)));
    }
    throw new Error(`SEC request failed: ${url}`);
  };
}

let offLoggedOn: string | null = null; // the "switched off" line is logged once a day, not on every check

/**
 * The daily SEC job. Off (returns at once, logs why) while SEC_USER_AGENT is empty. On: snapshot the ticker map;
 * for each followed ticker's CIK read its submissions (and, the first time, its older pages from 2010), insert
 * filings not yet stored; read company facts the first time and whenever a new periodic report (10-Q/10-K/20-F/
 * 40-F) arrived, insert versions not yet stored.
 */
export async function runSecJob(
  db: Exec,
  follow: string[],
  opts: { env?: NodeJS.ProcessEnv; get?: (url: string) => Promise<any | null>; today?: string; shouldStop?: () => boolean } = {},
): Promise<Record<string, unknown>> {
  const ua = secUserAgent(opts.env);
  if (!ua) {
    const day = new Date().toISOString().slice(0, 10);
    if (offLoggedOn !== day) console.log("[SEC] SEC_USER_AGENT is empty: the SEC filings job is switched off (it needs a name and contact email; nothing was requested).");
    offLoggedOn = day;
    return { off: true, reason: "SEC_USER_AGENT is empty" };
  }
  for (const s of DDL) await db.execute(sql.raw(s));
  const get = opts.get ?? secGetter(ua);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const map = await get("https://www.sec.gov/files/company_tickers_exchange.json");
  const fields: string[] = map?.fields ?? [];
  const [ci, ni, ti, ei] = ["cik", "name", "ticker", "exchange"].map((f) => fields.indexOf(f));
  const ciks = new Map<string, number>();
  const mapRows: any[] = [];
  for (const row of map?.data ?? []) {
    const t = String(row[ti] ?? "").toUpperCase();
    if (!t || ciks.has(t)) continue;
    ciks.set(t, Number(row[ci]));
    mapRows.push(sql`(${today}::date, ${t}, ${Number(row[ci])}, ${row[ni] ?? null}, ${row[ei] ?? null})`);
  }
  for (let i = 0; i < mapRows.length; i += 500) {
    await db.execute(sql`INSERT INTO sec_ticker_map (snapshot_date, ticker, cik, name, exchange) VALUES ${sql.join(mapRows.slice(i, i + 500), sql`, `)} ON CONFLICT DO NOTHING`);
  }
  const known = new Set(rowsOf(await db.execute(sql`SELECT DISTINCT cik FROM sec_filings`)).map((x) => Number(x.cik)));
  const withFacts = new Set(rowsOf(await db.execute(sql`SELECT DISTINCT cik FROM sec_facts`)).map((x) => Number(x.cik)));
  const out = { companies: 0, noCik: 0, filings: 0, facts: 0, stopped: false };
  const done = new Set<number>();
  for (const sym of follow) {
    if (opts.shouldStop?.()) { out.stopped = true; break; }
    const cik = ciks.get(sym.toUpperCase().replace(".", "-")) ?? ciks.get(sym.toUpperCase());
    if (!cik) { out.noCik++; continue; }
    if (done.has(cik)) continue;
    done.add(cik);
    const c10 = String(cik).padStart(10, "0");
    const sub = await get(`https://data.sec.gov/submissions/CIK${c10}.json`);
    if (!sub) continue;
    let filings = parseFilings(cik, sub.filings?.recent);
    if (!known.has(cik)) {
      for (const page of sub.filings?.files ?? []) {
        if (page.filingTo < "2010-01-01") continue;
        filings = filings.concat(parseFilings(cik, await get(`https://data.sec.gov/submissions/${page.name}`)));
      }
    }
    const before = out.filings;
    out.filings += await insertFilings(db, filings);
    const newPeriodic = out.filings > before && filings.some((f) => PERIODIC.test(f.form));
    if (!withFacts.has(cik) || newPeriodic) {
      const cf = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c10}.json`);
      if (cf) out.facts += await insertFacts(db, parseFacts(cik, cf));
    }
    out.companies++;
  }
  return out;
}

/** Earnings reaction sessions from 8-K item 2.02 filings, for the setups (empty while the SEC job is off). */
export async function secEarningsReports(db: Exec, from: string): Promise<{ symbol: string; acceptedAt: string; accession: string }[]> {
  try {
    const r = await db.execute(sql`SELECT m.ticker AS symbol, f.accepted_at, f.accession_no FROM sec_filings f JOIN (SELECT cik, ticker FROM sec_ticker_map WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM sec_ticker_map)) m ON m.cik = f.cik WHERE f.form LIKE '8-K%' AND f.items LIKE '%2.02%' AND f.accepted_at >= ${from}::date`);
    return rowsOf(r).map((x) => ({ symbol: String(x.symbol), acceptedAt: new Date(x.accepted_at).toISOString(), accession: String(x.accession_no) }));
  } catch {
    return []; // the tables exist only once the job has been switched on
  }
}
