import { Fragment, type ReactNode } from "react";

type TextPart = { text: string; className?: string };

/** Ordered — earlier rules claim neutral spans first. Keep selective; do not blanket-color paragraphs. */
const ENRICH_HIGHLIGHT_RULES: { pattern: RegExp; className: string }[] = [
  { pattern: /\bShort-watch\b/gi, className: "text-rs-yellow font-medium" },
  { pattern: /\bWATCH\b/g, className: "text-rs-yellow font-medium" },
  { pattern: /\bwatch for\b/gi, className: "text-rs-yellow" },
  { pattern: /\bpivot watch\b/gi, className: "text-rs-yellow" },
  { pattern: /\bWatch pullback\b/gi, className: "text-rs-yellow" },

  { pattern: /\bPower setup\b[^.;]*/gi, className: "text-rs-green font-medium" },
  { pattern: /\bLong-friendly\b/gi, className: "text-rs-green font-medium" },
  { pattern: /\b\d+ SMA U&R\b/gi, className: "text-rs-green font-medium" },
  { pattern: /\b\d+ EMA U&R\b/gi, className: "text-rs-green font-medium" },
  { pattern: /undercut-and-rally/gi, className: "text-rs-green" },
  { pattern: /\bbuyable now\b/gi, className: "text-rs-green font-medium" },
  { pattern: /\breclaimed on last bar\b/gi, className: "text-rs-green" },
  { pattern: /topping wick[^.]*TBD/gi, className: "text-rs-yellow" },
  { pattern: /follow-through still TBD/gi, className: "text-rs-yellow" },
  { pattern: /recent mid-chart coil/gi, className: "text-rs-green" },
  { pattern: /healthy MA stack/gi, className: "text-rs-green" },
  { pattern: /reclaims? the 200d[^.;]*/gi, className: "text-rs-green" },
  { pattern: /200d reclaim[^.;]*/gi, className: "text-rs-green" },
  { pattern: /Volume contracting[^.;]*/gi, className: "text-rs-green" },
  { pattern: /supply drying up/gi, className: "text-rs-green" },
  { pattern: /constructive coil/gi, className: "text-rs-green" },
  { pattern: /RS vs SPY \+\d[^.;]*/gi, className: "text-rs-green" },
  { pattern: /now (triggered|extended) above/gi, className: "text-rs-green" },
  { pattern: /coiled near base ceiling/gi, className: "text-rs-green" },
  { pattern: /breakout \/ trigger leg/gi, className: "text-rs-green" },

  { pattern: /\d+ SMA declining[^.;]*/gi, className: "text-rs-pink" },
  { pattern: /Below 200d[^.;]*/gi, className: "text-rs-pink" },
  { pattern: /Below 50d[^.;]*/gi, className: "text-rs-pink" },
  { pattern: /negative for long[^.;]*/gi, className: "text-rs-pink" },
  { pattern: /lagging benchmark/gi, className: "text-rs-pink" },
  { pattern: /Theme structural weakness[^.;]*/gi, className: "text-rs-pink" },
  { pattern: /intermediate trend damaged/gi, className: "text-rs-pink" },
  { pattern: /fragile long structure/gi, className: "text-rs-pink" },
  { pattern: /Long headwinds:/gi, className: "text-rs-pink font-medium" },
  { pattern: /declining (20|50|200) SMA/gi, className: "text-rs-pink" },
  { pattern: /under a falling 200d/gi, className: "text-rs-pink" },
  { pattern: /avoid-long/gi, className: "text-rs-pink" },
  { pattern: /weak laggard/gi, className: "text-rs-pink" },
  { pattern: /Breakdown posture/gi, className: "text-rs-pink" },
  { pattern: /Distribution session/gi, className: "text-rs-pink" },
  { pattern: /repair-zone coil, not leadership/gi, className: "text-rs-pink" },
];

function splitPart(part: TextPart, rule: (typeof ENRICH_HIGHLIGHT_RULES)[number]): TextPart[] {
  if (part.className) return [part];
  const { pattern, className } = rule;
  const re = new RegExp(pattern.source, pattern.flags);
  const out: TextPart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(part.text)) !== null) {
    if (m.index > last) out.push({ text: part.text.slice(last, m.index) });
    out.push({ text: m[0], className });
    last = m.index + m[0].length;
    if (!re.global) break;
  }
  if (last < part.text.length) out.push({ text: part.text.slice(last) });
  return out.length ? out : [part];
}

function highlightParts(text: string): TextPart[] {
  let parts: TextPart[] = [{ text }];
  for (const rule of ENRICH_HIGHLIGHT_RULES) {
    parts = parts.flatMap((p) => splitPart(p, rule));
  }
  return parts;
}

export function enrichTextToNodes(text: string): ReactNode[] {
  return highlightParts(text).map((part, i) =>
    part.className ? (
      <span key={i} className={part.className}>
        {part.text}
      </span>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    )
  );
}

export function EnrichHighlightedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <span className={className}>{enrichTextToNodes(text)}</span>;
}
