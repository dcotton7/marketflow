/**
 * Remove solid white (or near-white) background from a PNG with minimal halo / gradient damage.
 *
 * Uses Euclidean distance to white + smooth alpha, then unblends RGB from white for edge pixels.
 *
 * Run:
 *   npx tsx script/make-structuremap-logo-transparent.ts [inputPath] [outputPath]
 *
 * Defaults overwrite client/public/structuremap-logo.png
 */
import { createCanvas, loadImage } from "canvas";
import fs from "fs";
import path from "path";

const defaultIn = path.resolve("client/public/structuremap-logo.png");
const defaultOut = path.resolve("client/public/structuremap-logo.png");

const inputPath = process.argv[2] ?? defaultIn;
const outputPath = process.argv[3] ?? defaultOut;

/** Distance in RGB from pure white. */
function distFromWhite(r: number, g: number, b: number): number {
  return Math.hypot(255 - r, 255 - g, 255 - b);
}

/**
 * Alpha from "how much this pixel looks like the white backdrop" (0 = bg, 255 = opaque ink).
 * Wide feather preserves anti-alias without eating saturated logo pixels.
 */
function alphaFromWhiteBackdrop(r: number, g: number, b: number): number {
  const d = distFromWhite(r, g, b);
  const dHard = 10; // fully transparent inside this (pure white + tight AA)
  const dSoft = 88; // fully opaque beyond this
  if (d <= dHard) return 0;
  if (d >= dSoft) return 255;
  const t = (d - dHard) / (dSoft - dHard);
  return Math.round(Math.max(0, Math.min(255, t * 255)));
}

function clamp255(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x)));
}

/**
 * Unblend observed color from assumed white backdrop given straight-alpha a (0-255).
 * Reduces white halos when the logo is composited on dark UI.
 */
function decontaminateFromWhite(r: number, g: number, b: number, a: number): [number, number, number] {
  if (a <= 4) return [0, 0, 0];
  if (a >= 252) return [r, g, b];
  const t = a / 255;
  const minT = 0.06;
  const tt = Math.max(t, minT);
  const nr = (r - (1 - tt) * 255) / tt;
  const ng = (g - (1 - tt) * 255) / tt;
  const nb = (b - (1 - tt) * 255) / tt;
  return [clamp255(nr), clamp255(ng), clamp255(nb)];
}

async function main() {
  if (!fs.existsSync(inputPath)) {
    console.error("Missing input:", inputPath);
    process.exit(1);
  }
  const img = await loadImage(inputPath);
  const w = img.width;
  const h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]!;
    let g = data[i + 1]!;
    let b = data[i + 2]!;
    const srcA = data[i + 3]!;

    // Respect existing transparency
    let a = alphaFromWhiteBackdrop(r, g, b);
    if (srcA < 255) {
      a = Math.round((a * srcA) / 255);
    }

    if (a > 0 && a < 255) {
      const [nr, ng, nb] = decontaminateFromWhite(r, g, b, a);
      r = nr;
      g = ng;
      b = nb;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }

  ctx.putImageData(imageData, 0, 0);
  const buf = canvas.toBuffer("image/png");
  fs.writeFileSync(outputPath, buf);
  console.log("Wrote", outputPath, `(${w}x${h})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
