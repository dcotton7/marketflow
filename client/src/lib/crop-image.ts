export type CropRect = { x: number; y: number; w: number; h: number };

const MAX_EDGE = 1800;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function toJpeg(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", 0.82);
}

function drawScaled(source: HTMLCanvasElement | HTMLImageElement, sw: number, sh: number): HTMLCanvasElement {
  let w = sw;
  let h = sh;
  if (w > MAX_EDGE || h > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const out = document.createElement("canvas");
  out.width = Math.max(1, w);
  out.height = Math.max(1, h);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Could not crop image");
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, out.width, out.height);
  return out;
}

/** Crop in display pixels, mapped onto the natural image. */
export async function cropImageToJpeg(
  src: string,
  crop: CropRect | null,
  displayWidth: number,
  displayHeight: number,
): Promise<string> {
  const img = await loadImage(src);
  const dw = displayWidth || img.naturalWidth;
  const dh = displayHeight || img.naturalHeight;
  const scaleX = img.naturalWidth / dw;
  const scaleY = img.naturalHeight / dh;
  const rect =
    crop && crop.w >= 8 && crop.h >= 8
      ? crop
      : { x: 0, y: 0, w: dw, h: dh };
  const sx = Math.max(0, rect.x * scaleX);
  const sy = Math.max(0, rect.y * scaleY);
  const sw = Math.min(img.naturalWidth - sx, rect.w * scaleX);
  const sh = Math.min(img.naturalHeight - sy, rect.h * scaleY);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop image");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return toJpeg(drawScaled(canvas, canvas.width, canvas.height));
}
