import { fetchCompanyProfile } from "./finnhub";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 400_000;
const FETCH_MS = 8000;

type CacheHit = { body: Buffer; contentType: string; expires: number };
type CacheMiss = { miss: true; expires: number };

const cache = new Map<string, CacheHit | CacheMiss>();
const CACHE_KEY_PREFIX = "v2:";

const SYMBOL_RE = /^[A-Z0-9.-]{1,12}$/;

export function sanitizeLogoSymbol(raw: string): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

function isAllowedLogoUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return (
      host === "static.finnhub.io" ||
      host === "static2.finnhub.io" ||
      host.endsWith(".finnhub.io") ||
      host === "images.financialmodelingprep.com" ||
      host === "financialmodelingprep.com" ||
      host === "logo.clearbit.com"
    );
  } catch {
    return false;
  }
}

function hostFromWebUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.includes("/") || host.length > 80) return null;
    return host;
  } catch {
    return null;
  }
}

async function downloadLogo(url: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (!isAllowedLogoUrl(url)) return null;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!resp.ok) return null;
    const contentType = String(resp.headers.get("content-type") || "image/png").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    return { body: buf, contentType };
  } catch {
    return null;
  }
}

async function resolveLogo(symbol: string): Promise<{ body: Buffer; contentType: string } | null> {
  const profile = await fetchCompanyProfile(symbol).catch(() => null);
  if (profile?.logo) {
    const got = await downloadLogo(profile.logo);
    if (got) return got;
  }
  const fmp = await downloadLogo(`https://images.financialmodelingprep.com/symbol/${encodeURIComponent(symbol)}.png`);
  if (fmp) return fmp;
  const domain = hostFromWebUrl(profile?.weburl);
  if (domain) {
    return downloadLogo(`https://logo.clearbit.com/${domain}`);
  }
  return null;
}

export async function fetchCompanyLogoBytes(
  symbolRaw: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const symbol = sanitizeLogoSymbol(symbolRaw);
  if (!symbol) return null;

  const key = `${CACHE_KEY_PREFIX}${symbol}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    if ("miss" in cached) return null;
    return { body: cached.body, contentType: cached.contentType };
  }

  const got = await resolveLogo(symbol).catch(() => null);
  if (!got) {
    cache.set(key, { miss: true, expires: Date.now() + MISS_TTL_MS });
    return null;
  }
  cache.set(key, { ...got, expires: Date.now() + CACHE_TTL_MS });
  return got;
}
