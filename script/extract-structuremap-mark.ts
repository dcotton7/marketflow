/**
 * Extract the StructureMap mark (icon only: pillars + arrow, no wordmark).
 *
 * Strategy:
 * 1. Find the whitespace gutter and then the first sustained "baseline" ink columns
 *    (wordmark) — cut is to the *left* of that, so the arrow tip stays inside the strip.
 * 2. Keep only the largest 8-connected ink component in that strip (drops stray dots).
 * 3. Morphological dilate by 1px on the mask to recover anti-aliased tips, then tight bbox.
 *
 * Run:
 *   npx tsx script/extract-structuremap-mark.ts [inputPath] [outputPath]
 *
 * Defaults: client/public/structuremap-logo.png -> client/public/structuremap-mark.png
 *
 * Optional: --ratio=0.34  (fallback text boundary as fraction of width if detection fails)
 */
import { createCanvas, loadImage } from "canvas";
import fs from "fs";
import path from "path";

const defaultIn = path.resolve("client/public/structuremap-logo.png");
const defaultOut = path.resolve("client/public/structuremap-mark.png");

const inputPath = process.argv[2] ?? defaultIn;
const outputPath = process.argv[3] ?? defaultOut;

function distFromWhite(r: number, g: number, b: number, a: number): number {
  if (a < 8) return 999;
  return Math.hypot(255 - r, 255 - g, 255 - b);
}

/** Slightly looser than before so arrow AA pixels count as ink */
function isInk(r: number, g: number, b: number, a: number): boolean {
  if (a < 14) return false;
  return distFromWhite(r, g, b, a) > 14;
}

function getPixel(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!] as const;
}

function columnBandDensity(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y0: number,
  y1: number
): number {
  let c = 0;
  for (let y = y0; y < y1; y++) {
    const [r, g, b, a] = getPixel(data, w, x, y);
    if (isInk(r, g, b, a)) c++;
  }
  return c;
}

/** Mid-height band — gutter between mark and wordmark */
function columnDensitiesMid(data: Uint8ClampedArray, w: number, h: number): number[] {
  const y0 = Math.floor(h * 0.12);
  const y1 = Math.floor(h * 0.88);
  const dens: number[] = new Array(w).fill(0);
  for (let x = 0; x < w; x++) dens[x] = columnBandDensity(data, w, h, x, y0, y1);
  return dens;
}

/** Lower half — letters dominate here vs arrow tip in upper area */
function columnDensitiesBottom(data: Uint8ClampedArray, w: number, h: number): number[] {
  const y0 = Math.floor(h * 0.52);
  const y1 = Math.floor(h * 0.92);
  const dens: number[] = new Array(w).fill(0);
  for (let x = 0; x < w; x++) dens[x] = columnBandDensity(data, w, h, x, y0, y1);
  return dens;
}

/**
 * Gutter center between mark and wordmark — only search left of ~0.36W so we never
 * pick a "quiet" band inside the letters.
 */
function findGutterCenterX(dens: number[], w: number): number {
  const maxD = Math.max(...dens, 1);
  const win = Math.max(5, Math.floor(w * 0.014));
  const x0 = Math.floor(w * 0.28);
  const x1 = Math.floor(w * 0.36);
  let bestX = Math.floor(w * 0.32);
  let bestAvg = Infinity;
  for (let x = x0; x <= x1 - win; x++) {
    let sum = 0;
    for (let k = 0; k < win; k++) sum += dens[x + k]!;
    const avg = sum / win;
    if (avg < bestAvg) {
      bestAvg = avg;
      bestX = x;
    }
  }
  if (bestAvg > maxD * 0.24) return Math.floor(w * 0.318);
  return bestX + Math.floor(win / 2);
}

function smooth1d(a: number[], rad: number): number[] {
  const n = a.length;
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = -rad; k <= rad; k++) {
      const j = i + k;
      if (j >= 0 && j < n) {
        s += a[j]!;
        c++;
      }
    }
    out[i] = s / c;
  }
  return out;
}

/**
 * First column where baseline ink ramps up (wordmark), without needing the arrowhead
 * (upper image) to fire the detector.
 */
function findWordmarkStartX(densBottom: number[], densMid: number[], w: number, gutterX: number): number {
  const maxB = Math.max(...densBottom, 1);
  const maxM = Math.max(...densMid, 1);
  const sm = smooth1d(densBottom, 2);
  const xScan0 = Math.max(gutterX + 4, Math.floor(w * 0.3));
  const xScan1 = Math.floor(w * 0.5);

  // Sharp rise in smoothed baseline density (S / Structure leading edge)
  for (let x = xScan0 + 1; x < xScan1; x++) {
    const prev = sm[x - 1]!;
    const cur = sm[x]!;
    if (prev < maxB * 0.1 && cur > maxB * 0.14) return x;
    if (prev > 0.5 && cur > prev * 1.65 && cur > maxB * 0.12) return x - 1;
  }

  // Sustained baseline columns
  const threshB = maxB * 0.2;
  const threshM = maxM * 0.12;
  let consec = 0;
  for (let x = xScan0; x < xScan1; x++) {
    const strongBase = densBottom[x]! > threshB;
    const someMid = densMid[x]! > threshM;
    if (strongBase && someMid) {
      consec++;
      if (consec >= 3) return x - consec + 1;
    } else {
      consec = 0;
    }
  }

  return Math.min(Math.floor(w * 0.385), w - 4);
}

/**
 * Include ink left of the wordmark, but allow the arrowhead to extend a few px *past*
 * `textStartX` in the **upper** image (y < letterBandY) where letters have little ink.
 * Below `letterBandY`, drop ink at/after `textStartX` so "S" / baseline never enters the mask.
 */
function buildInkMask(data: Uint8ClampedArray, w: number, h: number, textStartX: number, slackPx: number): Uint8Array {
  const m = new Uint8Array(w * h);
  const letterBandY = Math.floor(h * 0.48);
  const hardCut = Math.min(w - 1, textStartX + slackPx);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > hardCut) break;
      const [r, g, b, a] = getPixel(data, w, x, y);
      if (!isInk(r, g, b, a)) continue;
      /* Letters live at/after textStartX in the lower half; arrowhead can extend past textStartX above */
      if (x >= textStartX && y >= letterBandY) continue;
      m[y * w + x] = 1;
    }
  }
  return m;
}

const NEIGH8: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Union every 8-connected component that touches the left anchor strip (pillars).
 * Unlike "largest only", this keeps a thin arrowhead blob that disconnects in anti-alias.
 */
function unionComponentsTouchingLeft(mask: Uint8Array, w: number, h: number, anchorMaxX: number): Uint8Array | null {
  const seen = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  let total = 0;

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const sid = sy * w + sx;
      if (!mask[sid] || seen[sid]) continue;
      const qx: number[] = [];
      const qy: number[] = [];
      const compPixels: number[] = [];
      let touchesAnchor = false;
      let qi = 0;
      qx.push(sx);
      qy.push(sy);
      seen[sid] = 1;
      compPixels.push(sid);
      if (sx < anchorMaxX) touchesAnchor = true;

      while (qi < qx.length) {
        const x = qx[qi]!;
        const y = qy[qi]!;
        qi++;
        for (const [dx, dy] of NEIGH8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nid = ny * w + nx;
          if (!mask[nid] || seen[nid]) continue;
          seen[nid] = 1;
          compPixels.push(nid);
          if (nx < anchorMaxX) touchesAnchor = true;
          qx.push(nx);
          qy.push(ny);
        }
      }

      if (touchesAnchor) {
        for (const id of compPixels) {
          out[id] = 1;
          total++;
        }
      }
    }
  }

  if (total < 80) return null;
  return out;
}

function dilateMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = y * w + x;
      if (mask[id]) {
        out[id] = 1;
        continue;
      }
      for (const [dx, dy] of NEIGH8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (mask[ny * w + nx]) {
          out[id] = 1;
          break;
        }
      }
    }
  }
  return out;
}

function bboxFromMask(mask: Uint8Array, w: number, h: number, pad: number, padBottomExtra: number) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (count < 40) return null;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  /* Pillar bases + shadow sit low; extra bottom padding avoids looking “cut off” in UI */
  maxY = Math.min(h - 1, maxY + pad + padBottomExtra);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    console.error("Missing input:", inputPath);
    process.exit(1);
  }

  const ratioArg = process.argv.find((a) => a.startsWith("--ratio="));
  /** If detection fails: fraction of width = approximate left edge of wordmark (not strip width) */
  const fallbackTextX = ratioArg ? parseFloat(ratioArg.split("=")[1]!) : 0.378;
  if (!Number.isFinite(fallbackTextX) || fallbackTextX < 0.28 || fallbackTextX > 0.58) {
    console.error("Invalid --ratio= (fallback wordmark start as fraction of width), e.g. 0.378");
    process.exit(1);
  }

  const img = await loadImage(inputPath);
  const W = img.width;
  const H = img.height;
  const full = createCanvas(W, H);
  const fctx = full.getContext("2d");
  fctx.drawImage(img, 0, 0);
  const fullData = fctx.getImageData(0, 0, W, H).data;

  const densMid = columnDensitiesMid(fullData, W, H);
  const densBottom = columnDensitiesBottom(fullData, W, H);
  const gutterX = findGutterCenterX(densMid, W);
  let textStartX = findWordmarkStartX(densBottom, densMid, W, gutterX);
  if (textStartX <= gutterX + 8 || textStartX > W * 0.52) {
    textStartX = Math.floor(W * fallbackTextX);
    console.log("Wordmark start fallback x =", textStartX);
  } else {
    console.log("Wordmark start x =", textStartX, "(gutter ~", gutterX, ")");
  }

  /* Arrowhead can extend past textStartX in the upper image; generous slack for tip pixels */
  const slackPx = Math.max(16, Math.floor(W * 0.042));

  let mask = buildInkMask(fullData, W, H, textStartX, slackPx);
  const anchorMaxX = Math.max(12, Math.floor(W * 0.22));
  const merged = unionComponentsTouchingLeft(mask, W, H, anchorMaxX);
  if (merged) mask = merged;
  mask = dilateMask(mask, W, H);
  mask = dilateMask(mask, W, H);

  const padBottomExtra = Math.max(10, Math.floor(H * 0.028));
  let box = bboxFromMask(mask, W, H, 14, padBottomExtra);
  if (!box) {
    console.error("Could not derive mark bbox.");
    process.exit(1);
  }

  const tmp = createCanvas(W, H);
  const tctx = tmp.getContext("2d");
  tctx.drawImage(img, 0, 0);
  const idata = tctx.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) {
        const i = (y * W + x) * 4;
        idata.data[i + 3] = 0;
      }
    }
  }
  tctx.putImageData(idata, 0, 0);

  const out = createCanvas(box.w, box.h);
  out.getContext("2d").drawImage(tmp as unknown as CanvasImageSource, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

  fs.writeFileSync(outputPath, out.toBuffer("image/png"));
  console.log(
    "Wrote",
    outputPath,
    `(${box.w}x${box.h}) from ${W}x${H} (textStart≈${textStartX}, hardCut+slack=${slackPx}, ${box.count} px before pad)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
