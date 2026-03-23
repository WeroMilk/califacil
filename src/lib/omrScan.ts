/**
 * Lectura aproximada de la banda CaliFacil del pie de hoja impresa.
 * Debe coincidir con el layout de `printExam.ts` (tabla 10 filas × N columnas de burbujas).
 */

export const CALIFACIL_OMR_SCAN = {
  /** Fracción inferior de la imagen donde cae el recuadro CaliFacil impreso */
  bottomBandRatio: 0.46,
  /** Parte superior de esa banda reservada al título (se ignora al muestrear) */
  titleStripRatioOfBand: 0.16,
  /** Ancho relativo reservado a la columna del número de pregunta */
  qnumWidthRatio: 0.09,
} as const;

function sampleDiskDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): number {
  let sum = 0;
  let n = 0;
  const r2 = radiusPx * radiusPx;
  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * @param columns — Número de columnas de burbujas impresas (2–5)
 * @returns Siempre 10 entradas: índice de columna elegida (0 = A) o null si no hay lectura clara
 */
export function scanCalifacilOmrSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number
): (number | null)[] {
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const out: (number | null)[] = Array(10).fill(null);

  if (typeof document === 'undefined') return out;

  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (srcW < 40 || srcH < 40) return out;

  const maxSide = 1100;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return out;

  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const { data, width, height } = id;

  const bandH = height * CALIFACIL_OMR_SCAN.bottomBandRatio;
  const bandTop = height - bandH;
  const dataTop = bandTop + bandH * CALIFACIL_OMR_SCAN.titleStripRatioOfBand;
  const dataHeight = bandH * (1 - CALIFACIL_OMR_SCAN.titleStripRatioOfBand);
  const rowH = dataHeight / 10;

  const qNumW = width * CALIFACIL_OMR_SCAN.qnumWidthRatio;
  const bubbleAreaLeft = qNumW;
  const bubbleAreaW = width - bubbleAreaLeft;
  const cellW = bubbleAreaW / cols;
  const radiusPx = Math.max(2, Math.min(cellW, rowH) * 0.22);

  for (let row = 0; row < 10; row++) {
    const cy = dataTop + (row + 0.5) * rowH;
    const scores: number[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = bubbleAreaLeft + (c + 0.5) * cellW;
      scores.push(sampleDiskDarkness(data, width, height, cx, cy, radiusPx));
    }
    const sorted = [...scores].sort((a, b) => b - a);
    const best = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    if (best < 0.2) {
      out[row] = null;
      continue;
    }
    if (cols >= 2 && best - second < 0.038) {
      out[row] = null;
      continue;
    }
    let bestIdx = 0;
    for (let c = 1; c < cols; c++) {
      if (scores[c] > scores[bestIdx]) bestIdx = c;
    }
    out[row] = bestIdx;
  }

  return out;
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}
