/** Punto 2D en píxeles de imagen. */
export type HomographyPoint = { x: number; y: number };

export type Homography8 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function solveLinearSystem8(matrix: number[][], rhs: number[]): number[] | null {
  const n = 8;
  const a = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r]![col]!);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-10) return null;
    if (pivot !== col) {
      const tmp = a[col]!;
      a[col] = a[pivot]!;
      a[pivot] = tmp;
    }
    const div = a[col]![col]!;
    for (let c = col; c <= n; c++) a[col]![c]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r]![col]!;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[r]![c]! -= factor * a[col]![c]!;
    }
  }
  return a.map((row) => row[n]!);
}

/**
 * Homografía que mapea coordenadas de origen → destino (x',y') = H(x,y).
 * Cuadriláteros en orden [TL, TR, BR, BL].
 */
export function computeHomographySrcToDst(
  srcQuad: [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint],
  dstQuad: [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint]
): Homography8 | null {
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const x = srcQuad[i]!.x;
    const y = srcQuad[i]!.y;
    const u = dstQuad[i]!.x;
    const v = dstQuad[i]!.y;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    rhs.push(v);
  }
  const sol = solveLinearSystem8(matrix, rhs);
  if (!sol) return null;
  return sol as Homography8;
}

/** Homografía que mapea rectángulo destino (u,v) → cuadrilátero origen (x,y) para muestreo inverso. */
export function computeHomographyFromRectToQuad(
  dstWidth: number,
  dstHeight: number,
  quad: [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint]
): Homography8 | null {
  const srcPts: [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint] = [
    { x: 0, y: 0 },
    { x: dstWidth - 1, y: 0 },
    { x: dstWidth - 1, y: dstHeight - 1 },
    { x: 0, y: dstHeight - 1 },
  ];
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const u = srcPts[i]!.x;
    const v = srcPts[i]!.y;
    const x = quad[i]!.x;
    const y = quad[i]!.y;
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    rhs.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    rhs.push(v);
  }
  const sol = solveLinearSystem8(matrix, rhs);
  if (!sol) return null;
  return sol as Homography8;
}

/** Invierte H de 8 parámetros (último elemento de la matriz 3×3 = 1). */
export function invertHomography8(h: Homography8): Homography8 | null {
  const [a, b, c, d, e, f, g, hh] = h;
  const det =
    a * (e * 1 - f * hh) - b * (d * 1 - f * g) + c * (d * hh - e * g);
  if (Math.abs(det) < 1e-12) return null;

  const inv00 = (e * 1 - f * hh) / det;
  const inv01 = (c * hh - b * 1) / det;
  const inv02 = (b * f - c * e) / det;
  const inv10 = (f * g - d * 1) / det;
  const inv11 = (a * 1 - c * g) / det;
  const inv12 = (c * d - a * f) / det;
  const inv20 = (d * hh - e * g) / det;
  const inv21 = (b * g - a * hh) / det;
  const inv22 = (a * e - b * d) / det;

  const i20 = inv20 / inv22;
  const i21 = inv21 / inv22;
  const i00 = inv00 - inv02 * i20;
  const i01 = inv01 - inv02 * i21;
  const i10 = inv10 - inv12 * i20;
  const i11 = inv11 - inv12 * i21;
  const i02 = inv02 / inv22;
  const i12 = inv12 / inv22;

  return [i00, i01, i02, i10, i11, i12, i20, i21];
}

function sampleBilinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const idx = (yy: number, xx: number) => (yy * width + xx) * 4;
  const i00 = idx(y0, x0);
  const i10 = idx(y0, x1);
  const i01 = idx(y1, x0);
  const i11 = idx(y1, x1);
  const out: [number, number, number, number] = [0, 0, 0, 255];
  for (let ch = 0; ch < 4; ch++) {
    const v00 = data[i00 + ch]!;
    const v10 = data[i10 + ch]!;
    const v01 = data[i01 + ch]!;
    const v11 = data[i11 + ch]!;
    const top = v00 * (1 - tx) + v10 * tx;
    const bot = v01 * (1 - tx) + v11 * tx;
    out[ch] = Math.round(top * (1 - ty) + bot * ty);
  }
  return out;
}

/**
 * Aplica homografía inversa: para cada píxel de salida (u,v), muestrea origen en H⁻¹(u,v).
 * `hSrcToDst` mapea coordenadas de entrada → salida.
 */
export function warpCanvasWithHomography(
  canvas: HTMLCanvasElement,
  hSrcToDst: Homography8,
  outW: number,
  outH: number
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const hInv = invertHomography8(hSrcToDst);
  if (!hInv) return null;
  const [a, b, c, d, e, f, g, hh] = hInv;

  const srcCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return null;
  const src = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const srcData = src.data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return null;
  const outId = outCtx.createImageData(outW, outH);
  const outData = outId.data;

  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const den = g * u + hh * v + 1;
      if (Math.abs(den) < 1e-9) continue;
      const x = (a * u + b * v + c) / den;
      const y = (d * u + e * v + f) / den;
      const outIdx = (v * outW + u) * 4;
      if (x < 0 || y < 0 || x >= canvas.width - 1 || y >= canvas.height - 1) {
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
        outData[outIdx + 3] = 255;
        continue;
      }
      const [r, gg, bb, aa] = sampleBilinear(srcData, canvas.width, canvas.height, x, y);
      outData[outIdx] = r;
      outData[outIdx + 1] = gg;
      outData[outIdx + 2] = bb;
      outData[outIdx + 3] = aa;
    }
  }
  outCtx.putImageData(outId, 0, 0);
  return out;
}
