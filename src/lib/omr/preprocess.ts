/** Preprocesamiento para detección de hoja (grises, CLAHE, gamma, normalización). */

const DETECTION_PRE = {
  claheClipLimit: 5,
  tileW: 16,
  tileH: 16,
  gammaLow: 0.7,
} as const;

function normalizeMinMaxInPlaceGray(gray: Uint8Array): void {
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) return;
  const scale = 255 / (max - min);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round((gray[i]! - min) * scale);
  }
}

function gammaCorrectGrayInPlace(gray: Uint8Array, gamma: number): void {
  const invGamma = 1 / gamma;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]! / 255;
    gray[i] = Math.round(Math.pow(v, invGamma) * 255);
  }
}

function claheGrayToNewBuffer(
  src: Uint8Array,
  w: number,
  h: number,
  tileW: number,
  tileH: number,
  clipLimit: number
): Uint8Array {
  const dst = new Uint8Array(w * h);
  const tilesX = Math.ceil(w / tileW);
  const tilesY = Math.ceil(h / tileH);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(w, x0 + tileW);
      const y1 = Math.min(h, y0 + tileH);
      let tilePixels = 0;
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[src[y * w + x]!]++;
          tilePixels++;
        }
      }
      const limit = Math.max(1, Math.floor((clipLimit * tilePixels) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i]! > limit) {
          excess += hist[i]! - limit;
          hist[i] = limit;
        }
      }
      const add = Math.floor(excess / 256);
      for (let i = 0; i < 256; i++) hist[i] += add;
      let rem = excess - add * 256;
      for (let i = 0; i < 256 && rem > 0; i++) {
        const space = limit - hist[i]!;
        if (space > 0) {
          const take = Math.min(space, rem);
          hist[i] += take;
          rem -= take;
        }
      }
      const cdf = new Uint32Array(256);
      cdf[0] = hist[0]!;
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1]! + hist[i]!;
      let cdfMin = 0;
      for (let i = 0; i < 256; i++) {
        if (cdf[i]! > 0) {
          cdfMin = cdf[i]!;
          break;
        }
      }
      const denom = Math.max(1, tilePixels - cdfMin);
      const lut = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        lut[i] = Math.min(255, Math.round(((cdf[i]! - cdfMin) * 255) / denom));
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          dst[y * w + x] = lut[src[y * w + x]!]!;
        }
      }
    }
  }
  return dst;
}

function grayBufferToRgbCanvas(gray: Uint8Array, w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const g = gray[i]!;
    d[j] = g;
    d[j + 1] = g;
    d[j + 2] = g;
    d[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

function getGrayBufferFromCanvas(canvas: HTMLCanvasElement): { gray: Uint8Array; w: number; h: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 32 || h < 32) return null;
  const id = ctx.getImageData(0, 0, w, h);
  const src = id.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!);
  }
  return { gray, w, h };
}

/**
 * Normaliza iluminación y contraste antes de detectar esquinas / contornos.
 * Misma cadena que OMRChecker: min-max → CLAHE → gamma → min-max.
 */
export function preprocessForSheetDetection(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const got = getGrayBufferFromCanvas(canvas);
  if (!got) return null;
  let { gray, w, h } = got;
  normalizeMinMaxInPlaceGray(gray);
  gray = claheGrayToNewBuffer(
    gray,
    w,
    h,
    DETECTION_PRE.tileW,
    DETECTION_PRE.tileH,
    DETECTION_PRE.claheClipLimit
  );
  gammaCorrectGrayInPlace(gray, DETECTION_PRE.gammaLow);
  normalizeMinMaxInPlaceGray(gray);
  return grayBufferToRgbCanvas(gray, w, h);
}
