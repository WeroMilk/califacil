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
  /** Oscuridad mínima para considerar que hubo marca real */
  minMarkDarkness: 0.26,
  /** Ventaja mínima de la mejor burbuja contra la segunda */
  minBestVsSecondGap: 0.08,
} as const;

type ScanThresholds = {
  minMarkDarkness: number;
  minBestVsSecondGap: number;
};

type ScanDetailedResult = {
  picks: (number | null)[];
  resolvedCount: number;
  confidenceSum: number;
};

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

function drawSourceToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxSide = 1100
): HTMLCanvasElement | null {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (srcW < 40 || srcH < 40) return null;

  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

function rotateCanvas(canvas: HTMLCanvasElement, angleDeg: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (angleDeg === 0) return canvas;
  const out = document.createElement('canvas');
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (angleDeg === 180) {
    out.width = srcW;
    out.height = srcH;
  } else {
    out.width = srcH;
    out.height = srcW;
  }
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  if (angleDeg === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (angleDeg === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function rotateCanvasByDegrees(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.max(1, Math.round(canvas.width * cos + canvas.height * sin));
  const outH = Math.max(1, Math.round(canvas.width * sin + canvas.height * cos));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;

  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function scanCalifacilOmrCanvasDetailed(
  canvas: HTMLCanvasElement,
  columns: number,
  thresholds: ScanThresholds
): ScanDetailedResult {
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const out: (number | null)[] = Array(10).fill(null);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { picks: out, resolvedCount: 0, confidenceSum: 0 };
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

  let resolvedCount = 0;
  let confidenceSum = 0;
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
    const gap = best - second;
    if (best < thresholds.minMarkDarkness) {
      out[row] = null;
      continue;
    }
    if (cols >= 2 && gap < thresholds.minBestVsSecondGap) {
      out[row] = null;
      continue;
    }
    let bestIdx = 0;
    for (let c = 1; c < cols; c++) {
      if (scores[c] > scores[bestIdx]) bestIdx = c;
    }
    out[row] = bestIdx;
    resolvedCount++;
    confidenceSum += best + gap;
  }
  return { picks: out, resolvedCount, confidenceSum };
}

/**
 * @param columns — Número de columnas de burbujas impresas (2–5)
 * @returns Siempre 10 entradas: índice de columna elegida (0 = A) o null si no hay lectura clara
 */
export function scanCalifacilOmrSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number
): (number | null)[] {
  if (typeof document === 'undefined') return Array(10).fill(null);
  const canvas = drawSourceToCanvas(source);
  if (!canvas) return Array(10).fill(null);
  return scanCalifacilOmrCanvasDetailed(canvas, columns, {
    minMarkDarkness: CALIFACIL_OMR_SCAN.minMarkDarkness,
    minBestVsSecondGap: CALIFACIL_OMR_SCAN.minBestVsSecondGap,
  }).picks;
}

/**
 * Auto-orienta la foto para que la banda CaliFacil quede en la posición esperada.
 * Prueba 0/90/180/270 y se queda con la orientación con mayor evidencia de marcas válidas.
 */
export function autoOrientCalifacilSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const base = drawSourceToCanvas(source, 1400);
  if (!base) return null;

  const candidates: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let bestCanvas: HTMLCanvasElement = base;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCardinal: 0 | 90 | 180 | 270 = 0;

  for (const angle of candidates) {
    const rotated = rotateCanvas(base, angle);
    const detail = scanCalifacilOmrCanvasDetailed(rotated, columns, {
      minMarkDarkness: 0.2,
      minBestVsSecondGap: 0.045,
    });
    const score = detail.resolvedCount * 100 + detail.confidenceSum * 10;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = rotated;
      bestCardinal = angle;
    }
  }

  // Ajuste fino para fotos ligeramente inclinadas.
  // Se aplica sobre el ángulo cardinal elegido para mejorar "derechita".
  for (let delta = -12; delta <= 12; delta += 2) {
    if (delta === 0) continue;
    const tilted = rotateCanvasByDegrees(bestCanvas, delta);
    const detail = scanCalifacilOmrCanvasDetailed(tilted, columns, {
      minMarkDarkness: 0.2,
      minBestVsSecondGap: 0.045,
    });
    const score = detail.resolvedCount * 100 + detail.confidenceSum * 10;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = tilted;
    }
  }

  // Evita variable no usada cuando el compilador endurece reglas.
  void bestCardinal;
  return bestCanvas;
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
