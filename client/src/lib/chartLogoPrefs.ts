export const DEFAULT_COMPANY_LOGO_OPACITY = 0.28;

const LS_KEY = "chartCompanyLogoOpacity";
export const COMPANY_LOGO_OPACITY_EVENT = "sps-company-logo-opacity-changed";

export function clampCompanyLogoOpacity(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return DEFAULT_COMPANY_LOGO_OPACITY;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

export function companyLogoOpacityToPercent(opacity: number): number {
  return Math.round(clampCompanyLogoOpacity(opacity) * 100);
}

export function companyLogoOpacityFromPercent(percent: unknown): number {
  const n = typeof percent === "number" ? percent : parseInt(String(percent), 10);
  if (!Number.isFinite(n)) return DEFAULT_COMPANY_LOGO_OPACITY;
  return clampCompanyLogoOpacity(n / 100);
}

export function getCompanyLogoOpacity(): number {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw == null || raw === "") return DEFAULT_COMPANY_LOGO_OPACITY;
    return clampCompanyLogoOpacity(parseFloat(raw));
  } catch {
    return DEFAULT_COMPANY_LOGO_OPACITY;
  }
}

function notifyCompanyLogoOpacityChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COMPANY_LOGO_OPACITY_EVENT));
}

export function setCompanyLogoOpacity(opacity: number): void {
  const clamped = clampCompanyLogoOpacity(opacity);
  try {
    localStorage.setItem(LS_KEY, String(clamped));
  } catch {
    /* ignore */
  }
  notifyCompanyLogoOpacityChanged();
}

export function resetCompanyLogoOpacity(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  notifyCompanyLogoOpacityChanged();
}

export function subscribeCompanyLogoOpacity(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(COMPANY_LOGO_OPACITY_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COMPANY_LOGO_OPACITY_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
