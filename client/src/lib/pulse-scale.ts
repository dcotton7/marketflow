import { pickForegroundForBg } from "@/lib/readable-on-bg";

type PulseBandId =
  | "N5"
  | "N4"
  | "N3"
  | "N2"
  | "N1"
  | "Z"
  | "P1"
  | "P2"
  | "P3"
  | "P4"
  | "P5"
  | "P6"
  | "P7"
  | "P8"
  | "P9";

export interface PulseTone {
  bandId: PulseBandId;
  bgHex: string;
  textHex: string;
}

export const PULSE_BAND_ORDER: PulseBandId[] = [
  "N5",
  "N4",
  "N3",
  "N2",
  "N1",
  "Z",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
];

interface PulseScaleInput {
  value: number;
  neutral: number;
  min: number;
  max: number;
  negativeCuts: number[];
  positiveCuts: number[];
  neutralBandAbs?: number;
  surface?: "bar" | "matrix";
}

const PULSE_BAND_COLORS: Record<PulseBandId, string> = {
  N5: "#5A0F12",
  N4: "#7A161A",
  N3: "#9E1F1F",
  N2: "#C33A24",
  N1: "#E56A2E",
  Z: "#E7C84A",
  P1: "#B9C84A",
  P2: "#9FCC47",
  P3: "#84CF45",
  P4: "#67C94A",
  P5: "#4DBB58",
  P6: "#39A96A",
  P7: "#2E967A",
  P8: "#2B8384",
  P9: "#2A6F8A",
};

const NEGATIVE_IDS: PulseBandId[] = ["N1", "N2", "N3", "N4", "N5"];
const POSITIVE_IDS: PulseBandId[] = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"];
const MATRIX_ALPHA = 0.82;

const DEFAULT_NEGATIVE_CUTS = [0.24, 0.44, 0.62, 0.8, 1.0];
const DEFAULT_POSITIVE_CUTS = [0.08, 0.16, 0.24, 0.34, 0.46, 0.58, 0.72, 0.86, 1.0];

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}

function findBandIndex(ratio: number, cuts: number[]) {
  for (let i = 0; i < cuts.length; i += 1) {
    if (ratio <= cuts[i]) return i;
  }
  return cuts.length - 1;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return { r, g, b };
}

function toRgba(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function resolvePulseBandId({
  value,
  neutral,
  min,
  max,
  negativeCuts,
  positiveCuts,
  neutralBandAbs = 0,
}: Omit<PulseScaleInput, "surface">): PulseBandId {
  const safeValue = clamp(value, min, max);
  if (Math.abs(safeValue - neutral) <= neutralBandAbs) return "Z";

  if (safeValue < neutral) {
    const span = Math.max(1e-9, neutral - min);
    const ratio = clamp((neutral - safeValue) / span, 0, 1);
    const idx = findBandIndex(ratio, negativeCuts);
    return NEGATIVE_IDS[idx] ?? "N5";
  }

  const span = Math.max(1e-9, max - neutral);
  const ratio = clamp((safeValue - neutral) / span, 0, 1);
  const idx = findBandIndex(ratio, positiveCuts);
  return POSITIVE_IDS[idx] ?? "P9";
}

export function getPulseTone(input: PulseScaleInput): PulseTone {
  const bandId = resolvePulseBandId(input);
  return getPulseToneByBandId(bandId, input.surface);
}

export function getPulseToneByBandId(bandId: PulseBandId, surface: "bar" | "matrix" = "bar"): PulseTone {
  const bgHex = PULSE_BAND_COLORS[bandId];
  const textHex = pickForegroundForBg(bgHex);
  return {
    bandId,
    bgHex: surface === "matrix" ? toRgba(bgHex, MATRIX_ALPHA) : bgHex,
    textHex,
  };
}

export function getScorePulseTone(score: number, surface: "bar" | "matrix" = "bar") {
  return getPulseTone({
    value: score,
    neutral: 50,
    min: 0,
    max: 100,
    negativeCuts: DEFAULT_NEGATIVE_CUTS,
    positiveCuts: DEFAULT_POSITIVE_CUTS,
    neutralBandAbs: 2.5,
    surface,
  });
}

export function getRoutePulseTone(score: number) {
  return getPulseTone({
    value: clamp(score, -0.99, 0.99),
    neutral: 0,
    min: -0.99,
    max: 0.99,
    negativeCuts: DEFAULT_NEGATIVE_CUTS,
    positiveCuts: DEFAULT_POSITIVE_CUTS,
    neutralBandAbs: 0.03,
    surface: "matrix",
  });
}

export function getScoreBandIndex(score: number): number {
  const tone = getScorePulseTone(score, "bar");
  const idx = PULSE_BAND_ORDER.indexOf(tone.bandId);
  return idx >= 0 ? idx : PULSE_BAND_ORDER.indexOf("Z");
}
