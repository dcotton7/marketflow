import type { BriefingMode } from "@/components/market-condition/ThemeBriefingPickerDialog";
import {
  THEME_REVIEW_PRODUCT,
  themeReviewTitleDash,
} from "@/lib/theme-review-naming";

export interface ThemeBriefingResponse {
  mode: BriefingMode;
  referenceSession: string;
  generatedAt: string;
  cached?: boolean;
  cachedAt?: string;
  dataQuality: {
    intradaySlots: { available: number; expected: number; complete: boolean };
    warnings: string[];
  };
  narrative: {
    executiveSummary: string;
    sections: Array<{ id: string; title: string; body: string }>;
    watchList: Array<{ themeId: string; themeName: string; reason: string }>;
    source: string;
  };
  synthesisModel?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bodyToPlainText(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body.replace(/\*\*(.*?)\*\*/g, "$1");
  if (Array.isArray(body)) return body.map((item) => bodyToPlainText(item)).filter(Boolean).join("\n");
  if (typeof body === "object") {
    try {
      const s = JSON.stringify(body, null, 2);
      return s.length > 8000 ? `${s.slice(0, 8000)}…` : s;
    } catch {
      return "[content unavailable]";
    }
  }
  return String(body);
}

function formatSessionDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function briefingToPlainText(data: ThemeBriefingResponse): string {
  const lines: string[] = [];
  lines.push(themeReviewTitleDash(data.mode));
  lines.push(`Session: ${formatSessionDate(data.referenceSession)}`);
  lines.push(`Generated: ${new Date(data.generatedAt).toLocaleString()}`);
  lines.push("");
  lines.push("EXECUTIVE SUMMARY");
  lines.push(bodyToPlainText(data.narrative.executiveSummary));
  lines.push("");

  for (const section of data.narrative.sections) {
    lines.push(section.title.toUpperCase());
    lines.push(bodyToPlainText(section.body));
    lines.push("");
  }

  if (data.narrative.watchList.length > 0) {
    lines.push("WATCH LIST");
    for (const w of data.narrative.watchList) {
      lines.push(`• ${w.themeName} — ${w.reason}`);
    }
    lines.push("");
  }

  if (data.dataQuality.warnings.length > 0) {
    lines.push("DATA NOTES");
    for (const w of data.dataQuality.warnings) {
      lines.push(`• ${w}`);
    }
  }

  return lines.join("\n").trim();
}

export function buildBriefingPdfHtml(data: ThemeBriefingResponse): string {
  const dateStr = formatSessionDate(data.referenceSession);
  const generatedStr = new Date(data.generatedAt).toLocaleString();
  const label = themeReviewTitleDash(data.mode);
  const sourceLabel =
    data.narrative.source === "llm"
      ? `AI synthesis${data.synthesisModel ? ` · ${data.synthesisModel}` : ""}`
      : "Rules-based narrative";

  const sectionsHtml = data.narrative.sections
    .map(
      (section) => `
    <section class="block">
      <h2>${escapeHtml(section.title)}</h2>
      ${bodyToPlainText(section.body)
        .split("\n")
        .filter(Boolean)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("")}
    </section>`
    )
    .join("");

  const watchListHtml =
    data.narrative.watchList.length > 0
      ? `<section class="block watch">
      <h2>Watch list</h2>
      <ul>${data.narrative.watchList
        .map(
          (w) =>
            `<li><strong>${escapeHtml(w.themeName)}</strong> — ${escapeHtml(w.reason)}</li>`
        )
        .join("")}</ul>
    </section>`
      : "";

  const warningsHtml =
    data.dataQuality.warnings.length > 0
      ? `<section class="block warn">
      <h2>Data notes</h2>
      <ul>${data.dataQuality.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
    </section>`
      : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(label)}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none; } }
  body { font-family: Georgia, "Times New Roman", serif; max-width: 720px; margin: 1.5em auto; padding: 0 1.25em; color: #1e293b; line-height: 1.55; }
  h1 { font-size: 1.35rem; margin-bottom: 0.25em; font-family: system-ui, sans-serif; }
  .meta { color: #64748b; font-size: 0.875rem; margin-bottom: 1.25em; font-family: system-ui, sans-serif; }
  .summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1em; margin: 1em 0; }
  h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: #0f766e; margin: 0 0 0.5em; font-family: system-ui, sans-serif; }
  .block { margin: 1.25em 0; padding-bottom: 1em; border-bottom: 1px solid #e2e8f0; }
  .block p { margin: 0.4em 0; font-size: 0.95rem; }
  .watch { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 1em; }
  .warn { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 1em; }
  ul { margin: 0.35em 0; padding-left: 1.25em; }
  li { margin: 0.35em 0; }
  footer { margin-top: 2em; font-size: 0.75rem; color: #94a3b8; font-family: system-ui, sans-serif; }
</style></head><body>
  <h1>${escapeHtml(label)}</h1>
  <p class="meta">${escapeHtml(dateStr)} · ${escapeHtml(sourceLabel)} · Generated ${escapeHtml(generatedStr)}</p>
  <section class="summary">
    <h2>Executive summary</h2>
    <p>${escapeHtml(bodyToPlainText(data.narrative.executiveSummary))}</p>
  </section>
  ${sectionsHtml}
  ${watchListHtml}
  ${warningsHtml}
  <footer>Stock Pattern Stream · ${THEME_REVIEW_PRODUCT}</footer>
</body></html>`;
}

/** Open print dialog once — choose &quot;Save as PDF&quot; to export. Uses a hidden iframe (no popup). */
export function printBriefingAsPdf(data: ThemeBriefingResponse): void {
  const html = buildBriefingPdfHtml(data);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", `${THEME_REVIEW_PRODUCT} print`);
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    iframe.remove();
    window.alert("Could not open print preview. Try again or use the browser Print menu.");
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  let printed = false;
  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 600);
  };

  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      win.focus();
      win.print();
    } catch {
      window.alert("Print failed. Try again from Save as PDF.");
    }
    cleanup();
  };

  // Single print after layout — avoid double print() which can freeze Chrome/Edge
  const schedulePrint = () => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(doPrint));
  };

  if (doc.readyState === "complete") {
    schedulePrint();
  } else {
    iframe.onload = schedulePrint;
  }

  window.setTimeout(() => {
    if (!printed) schedulePrint();
  }, 1500);
}

/** Open default mail client with briefing text; pair with Save as PDF for attachment. */
export function emailBriefingReport(data: ThemeBriefingResponse): void {
  const dateStr = formatSessionDate(data.referenceSession);
  const subject = `${themeReviewTitleDash(data.mode)} · ${dateStr}`;
  const body = [
    briefingToPlainText(data),
    "",
    "---",
    `Tip: In ${THEME_REVIEW_PRODUCT}, use Save as PDF and attach that file for the full formatted report.`,
  ].join("\n");

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
}
