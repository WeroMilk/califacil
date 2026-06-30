'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Crop,
  Palette,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CALIFACIL_WARP_LETTER_HEIGHT,
  CALIFACIL_WARP_LETTER_WIDTH,
  refineWarpedCalifacilSheet,
  warpCalifacilSheetFromQuad,
  type WarpAlignmentReport,
} from '@/lib/omrScan';

export type ScanReviewQuad = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
];

export type ScanReviewFilter = 'color' | 'grayscale' | 'bw';

type Props = {
  sourceCanvas: HTMLCanvasElement;
  frameQuad: ScanReviewQuad;
  initialWarped: HTMLCanvasElement;
  initialAlignment: WarpAlignmentReport | null;
  initialFilter?: ScanReviewFilter;
  busy?: boolean;
  onRetake: () => void;
  onConfirm: (warped: HTMLCanvasElement, alignment: WarpAlignmentReport | null) => void;
};

function cloneQuad(quad: ScanReviewQuad): ScanReviewQuad {
  return quad.map((p) => ({ ...p })) as ScanReviewQuad;
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.92);
}

function warpFromQuad(source: HTMLCanvasElement, quad: ScanReviewQuad): HTMLCanvasElement | null {
  return warpCalifacilSheetFromQuad(source, quad);
}

function applyFilterAndRotation(
  source: HTMLCanvasElement,
  filter: ScanReviewFilter,
  rotation: 0 | 90 | 180 | 270
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const srcW = source.width;
  const srcH = source.height;
  const rotated = rotation === 90 || rotation === 270;
  out.width = rotated ? srcH : srcW;
  out.height = rotated ? srcW : srcH;
  const ctx = out.getContext('2d');
  if (!ctx) return source;
  ctx.save();
  if (rotation === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else if (rotation === 270) {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  if (filter === 'color') return out;

  const id = ctx.getImageData(0, 0, out.width, out.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (filter === 'grayscale') {
      d[i] = d[i + 1] = d[i + 2] = lum;
    } else {
      const v = lum < 168 ? 0 : 255;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  ctx.putImageData(id, 0, 0);
  return out;
}

function displayQuadToSource(
  quad: ScanReviewQuad,
  displayW: number,
  displayH: number,
  sourceW: number,
  sourceH: number
): ScanReviewQuad {
  const sx = sourceW / Math.max(1, displayW);
  const sy = sourceH / Math.max(1, displayH);
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as ScanReviewQuad;
}

function sourceQuadToDisplay(
  quad: ScanReviewQuad,
  displayW: number,
  displayH: number,
  sourceW: number,
  sourceH: number
): ScanReviewQuad {
  const sx = displayW / Math.max(1, sourceW);
  const sy = displayH / Math.max(1, sourceH);
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as ScanReviewQuad;
}

export function MobileSheetScanReview({
  sourceCanvas,
  frameQuad,
  initialWarped,
  initialAlignment,
  initialFilter = 'color',
  busy = false,
  onRetake,
  onConfirm,
}: Props) {
  const [adjustMode, setAdjustMode] = useState(false);
  const [filter, setFilter] = useState<ScanReviewFilter>(initialFilter);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [sourceQuad, setSourceQuad] = useState<ScanReviewQuad>(() => cloneQuad(frameQuad));
  const [warped, setWarped] = useState<HTMLCanvasElement>(initialWarped);
  const [alignment, setAlignment] = useState<WarpAlignmentReport | null>(initialAlignment);
  const adjustSurfaceRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ corner: number; pointerId: number } | null>(null);
  const [displayQuad, setDisplayQuad] = useState<ScanReviewQuad>([] as unknown as ScanReviewQuad);

  const previewUrl = useMemo(
    () => canvasToObjectUrl(applyFilterAndRotation(warped, filter, rotation)),
    [warped, filter, rotation]
  );
  const sourceUrl = useMemo(() => canvasToObjectUrl(sourceCanvas), [sourceCanvas]);

  const recomputeWarp = useCallback(
    (quad: ScanReviewQuad) => {
      const next = warpFromQuad(sourceCanvas, quad);
      if (!next) return;
      const refined = refineWarpedCalifacilSheet(next, { maxAllowedPx: 22, fast: true });
      setWarped(refined.canvas);
      setAlignment(refined.alignment);
    },
    [sourceCanvas]
  );

  useEffect(() => {
    const el = adjustSurfaceRef.current;
    if (!el || !adjustMode) return;
    const rect = el.getBoundingClientRect();
    setDisplayQuad(
      sourceQuadToDisplay(sourceQuad, rect.width, rect.height, sourceCanvas.width, sourceCanvas.height)
    );
  }, [adjustMode, sourceCanvas.height, sourceCanvas.width, sourceQuad]);

  const handlePointerDown = (corner: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { corner, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = adjustSurfaceRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setDisplayQuad((prev) => {
      const next = cloneQuad(prev.length === 4 ? prev : displayQuad);
      next[drag.corner] = { x, y };
      return next;
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const el = adjustSurfaceRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    dragRef.current = null;
    const rect = el.getBoundingClientRect();
    const nextDisplay = cloneQuad(displayQuad);
    nextDisplay[drag.corner] = {
      x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    };
    const nextSource = displayQuadToSource(
      nextDisplay,
      rect.width,
      rect.height,
      sourceCanvas.width,
      sourceCanvas.height
    );
    setDisplayQuad(nextDisplay);
    setSourceQuad(nextSource);
    recomputeWarp(nextSource);
  };

  const handleConfirm = () => {
    const filtered = applyFilterAndRotation(warped, filter, rotation);
    onConfirm(filtered, alignment);
  };

  const quadPoints = displayQuad.length === 4 ? displayQuad : [];
  const polyline =
    quadPoints.length === 4
      ? `${quadPoints[0].x},${quadPoints[0].y} ${quadPoints[1].x},${quadPoints[1].y} ${quadPoints[2].x},${quadPoints[2].y} ${quadPoints[3].x},${quadPoints[3].y}`
      : '';

  return (
    <div
      className="fixed inset-0 z-[260] flex flex-col bg-[#f2f2f7] text-gray-900"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5"
          aria-label="Volver a cámara"
          disabled={busy}
          onClick={onRetake}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="rounded-full bg-black/5 px-4 py-2 text-sm font-semibold"
          disabled={busy}
          onClick={onRetake}
        >
          Repetir
        </button>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-white shadow"
          aria-label="Usar escaneo y calificar"
          disabled={busy}
          onClick={handleConfirm}
        >
          <Check className="h-5 w-5" strokeWidth={3} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden px-4 pb-2">
        {adjustMode ? (
          <div
            ref={adjustSurfaceRef}
            className="relative mx-auto h-full max-h-full w-full max-w-lg touch-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceUrl}
              alt="Ajustar esquinas del documento"
              className="h-full w-full object-contain"
              draggable={false}
            />
            {quadPoints.length === 4 ? (
              <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                <polygon
                  points={polyline}
                  fill="rgba(255, 204, 0, 0.22)"
                  stroke="rgb(255, 193, 7)"
                  strokeWidth={2}
                />
              </svg>
            ) : null}
            {quadPoints.map((p, i) => (
              <button
                key={i}
                type="button"
                className="absolute z-10 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-amber-400 shadow-lg"
                style={{ left: p.x, top: p.y }}
                aria-label={`Esquina ${i + 1}`}
                onPointerDown={handlePointerDown(i)}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="Vista previa del escaneo"
              className="max-h-full max-w-full rounded-md shadow-lg"
              draggable={false}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-black/10 bg-[#f2f2f7]/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md items-stretch justify-around gap-1">
          <button
            type="button"
            className={cn(
              'flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium',
              adjustMode ? 'bg-amber-100 text-amber-900' : 'text-gray-700'
            )}
            disabled={busy}
            onClick={() => {
              setAdjustMode((v) => !v);
              setFilterMenuOpen(false);
            }}
          >
            <Crop className="h-6 w-6" />
            Ajustar
          </button>
          <div className="relative">
            <button
              type="button"
              className={cn(
                'flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium',
                filter !== 'color' ? 'bg-amber-100 text-amber-900' : 'text-gray-700'
              )}
              disabled={busy}
              onClick={() => setFilterMenuOpen((v) => !v)}
            >
              <Palette className="h-6 w-6" />
              Filtros
            </button>
            {filterMenuOpen ? (
              <div className="absolute bottom-full left-1/2 z-20 mb-2 w-36 -translate-x-1/2 rounded-xl border bg-white p-1 shadow-lg">
                {(
                  [
                    ['color', 'Color'],
                    ['grayscale', 'Escala grises'],
                    ['bw', 'Blanco y negro'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      'block w-full rounded-lg px-3 py-2 text-left text-sm',
                      filter === id ? 'bg-amber-100 font-semibold' : 'hover:bg-gray-50'
                    )}
                    onClick={() => {
                      setFilter(id);
                      setFilterMenuOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-gray-700"
            disabled={busy}
            onClick={() => setRotation((r) => ((r + 90) % 360) as 0 | 90 | 180 | 270)}
          >
            <RotateCcw className="h-6 w-6" />
            Girar
          </button>
          <button
            type="button"
            className="flex min-w-[4.5rem] flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-red-600"
            disabled={busy}
            onClick={onRetake}
          >
            <Trash2 className="h-6 w-6" />
            Eliminar
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-gray-500">
          Documento {CALIFACIL_WARP_LETTER_WIDTH}×{CALIFACIL_WARP_LETTER_HEIGHT}px · Pulsa ✓ para calificar
        </p>
      </div>
    </div>
  );
}
