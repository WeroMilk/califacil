'use client';

import type { WarpAlignmentReport } from '@/lib/omrScan';
import { CALIFACIL_FIDUCIAL_CENTERS_NORM } from '@/lib/printExam';
import type { CalifacilAnswerSheetOmrTemplate } from '@/lib/printExam';

type Props = {
  imageWidth: number;
  imageHeight: number;
  template: CalifacilAnswerSheetOmrTemplate;
  alignment: WarpAlignmentReport | null | undefined;
};

/**
 * Modo depuración: superpone plantilla PDF (ratios) y error fiducial en px.
 */
export function CalifacilOmrDebugOverlay({
  imageWidth,
  imageHeight,
  template,
  alignment,
}: Props) {
  const W = Math.max(1, imageWidth);
  const H = Math.max(1, imageHeight);

  const tableRect = {
    x: template.tableLeftRatio * W,
    y: template.tableTopRatio * H,
    w: template.tableWidthRatio * W,
    h: template.tableHeightRatio * H,
  };

  const fiducialIds = ['tl', 'tr', 'br', 'bl'] as const;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <rect
        x={tableRect.x}
        y={tableRect.y}
        width={tableRect.w}
        height={tableRect.h}
        fill="none"
        stroke="rgba(249,115,22,0.85)"
        strokeWidth={Math.max(2, W * 0.004)}
        strokeDasharray="8 6"
      />
      {fiducialIds.map((id) => {
        const norm = CALIFACIL_FIDUCIAL_CENTERS_NORM[id];
        const ex = norm.x * W;
        const ey = norm.y * H;
        const corner = alignment?.corners.find((c) => c.id === id);
        const det = corner?.detected;
        const r = Math.max(4, W * 0.012);
        return (
          <g key={id}>
            <circle
              cx={ex}
              cy={ey}
              r={r}
              fill="none"
              stroke="rgba(239,68,68,0.95)"
              strokeWidth={Math.max(2, W * 0.003)}
            />
            {det ? (
              <>
                <circle cx={det.x} cy={det.y} r={r * 0.75} fill="rgba(34,197,94,0.55)" />
                <line
                  x1={ex}
                  y1={ey}
                  x2={det.x}
                  y2={det.y}
                  stroke="rgba(250,204,21,0.9)"
                  strokeWidth={Math.max(1.5, W * 0.002)}
                />
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function formatWarpAlignmentSummary(alignment: WarpAlignmentReport | null | undefined): string {
  if (!alignment) return 'Sin métricas de alineación';
  if (alignment.ok) {
    return `Alineación OK · error máx ${alignment.maxErrorPx.toFixed(1)} px (≤ ${alignment.maxAllowedPx} px)`;
  }
  return `Alineación rechazada · error máx ${Number.isFinite(alignment.maxErrorPx) ? alignment.maxErrorPx.toFixed(1) : '∞'} px (límite ${alignment.maxAllowedPx} px)`;
}
