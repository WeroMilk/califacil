'use client';

import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

type RowState = 'locked' | 'tentative' | 'ambiguous' | 'empty';

export type LiveVideoLetterbox = {
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
  frameW: number;
  frameH: number;
};

type Props = {
  geometry: CalifacilOmrScanGeometry | null;
  /** Índice de columna leída por fila (0 = A), null si vacío. */
  picks: (number | null)[];
  /** Filas con lectura bloqueada por consenso. */
  lockedRows: boolean[];
  /** Filas ambiguas en el último escaneo. */
  ambiguousRows: boolean[];
  rowCount: number;
  /** Caja letterbox alineada con object-contain del video. */
  letterbox: LiveVideoLetterbox | null;
  /** Solo mostrar burbujas tras validación estricta estable. */
  visible: boolean;
};

function cellStroke(state: RowState, isPicked: boolean): { stroke: string; strokeW: number } {
  if (!isPicked) {
    return { stroke: 'rgba(59,130,246,0.3)', strokeW: 1 };
  }
  switch (state) {
    case 'locked':
      return { stroke: 'rgba(22,163,74,0.95)', strokeW: 2.5 };
    case 'tentative':
      return { stroke: 'rgba(234,179,8,0.9)', strokeW: 2 };
    case 'ambiguous':
      return { stroke: 'rgba(220,38,38,0.95)', strokeW: 2.5 };
    default:
      return { stroke: 'rgba(59,130,246,0.3)', strokeW: 1 };
  }
}

/**
 * Overlay en vivo sobre el visor de cámara: burbujas verde/amarillo/rojo según confianza.
 */
export function CalifacilLiveScanOverlay({
  geometry,
  picks,
  lockedRows,
  ambiguousRows,
  rowCount,
  letterbox,
  visible,
}: Props) {
  if (!visible || !geometry || !letterbox) return null;

  const rows = Math.min(10, rowCount);
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);

  const toPxCell = (row: number, col: number) => {
    const cell = geometry.cells[row]?.[col];
    if (!cell) return null;
    return {
      x: cell.x * W,
      y: cell.y * H,
      w: cell.w * W,
      h: cell.h * H,
    };
  };

  return (
    <div
      className="pointer-events-none absolute z-10 overflow-hidden"
      style={{
        left: letterbox.offsetX,
        top: letterbox.offsetY,
        width: letterbox.displayW,
        height: letterbox.displayH,
      }}
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="geometricPrecision"
        aria-hidden
      >
        {Array.from({ length: rows }, (_, row) => {
          const rowCells = geometry.cells[row];
          if (!rowCells) return null;
          const pick = picks[row];
          const locked = lockedRows[row] ?? false;
          const ambiguous = ambiguousRows[row] ?? false;
          let rowState: RowState = 'empty';
          if (pick !== null && pick >= 0) {
            if (ambiguous) rowState = 'ambiguous';
            else if (locked) rowState = 'locked';
            else rowState = 'tentative';
          }

          return (
            <g key={row}>
              {rowCells.map((cell, col) => {
                const pxCell = toPxCell(row, col);
                if (!pxCell) return null;
                const isPicked = pick !== null && pick === col;
                const { stroke, strokeW } = cellStroke(rowState, isPicked);
                return (
                  <rect
                    key={col}
                    x={pxCell.x}
                    y={pxCell.y}
                    width={pxCell.w}
                    height={pxCell.h}
                    fill={isPicked && rowState === 'locked' ? 'rgba(22,163,74,0.18)' : 'none'}
                    stroke={stroke}
                    strokeWidth={strokeW}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
