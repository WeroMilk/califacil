'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';
import { Button } from '@/components/ui/button';
import type { Student } from '@/types';

export type ZipGradeSheetData = {
  previewUrl: string;
  nameCropUrl?: string | null;
  geometry: CalifacilOmrScanGeometry;
  picks: (number | null)[];
  expectedPicks: (number | null)[];
  rowCount: number;
  correct: number;
  total: number;
  pct: number;
};

type ScanCompleteModalProps = {
  open: boolean;
  examTitle?: string;
  previewUrl?: string | null;
  sheet?: ZipGradeSheetData | null;
  score: { correct: number; total: number; pct: number };
  nameCropUrl?: string | null;
  studentName?: string;
  controlNumber?: string | null;
  onRetake: () => void;
  onReview: () => void;
  onAnotherStudent: () => void;
  onBackToCalificar: () => void;
};

export function MobileZipGradeScanCompleteModal({
  open,
  examTitle,
  previewUrl,
  sheet,
  score,
  nameCropUrl,
  studentName,
  controlNumber,
  onRetake,
  onReview,
  onAnotherStudent,
  onBackToCalificar,
}: ScanCompleteModalProps) {
  const showOverlayPreview = Boolean(sheet?.geometry && (sheet.previewUrl || previewUrl));
  const previewSrc = sheet?.previewUrl || previewUrl;
  const overlayW = sheet ? Math.max(1, sheet.geometry.imageWidth) : 1;
  const overlayH = sheet ? Math.max(1, sheet.geometry.imageHeight) : 1;

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-black"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {previewSrc && !showOverlayPreview ? (
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden bg-orange-50/90">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt=""
            className="max-h-full max-w-full object-contain shadow-sm"
          />
        </div>
      ) : null}

      <header className="relative z-10 flex shrink-0 items-center justify-between bg-orange-600 px-2 py-2.5 text-white">
        <button
          type="button"
          className="flex min-w-[5.5rem] items-center gap-0.5 px-2 py-1 text-[17px] font-normal active:opacity-70"
          onClick={onBackToCalificar}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Calificar
        </button>
        <span className="truncate px-2 text-center text-[13px] font-semibold uppercase tracking-[0.2em] opacity-95">
          {examTitle ? examTitle.slice(0, 18) : 'CaliFácil'}
        </span>
        <span className="w-16" aria-hidden />
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-4">
        <div
          className="my-auto w-full max-w-sm animate-fade-in rounded-xl bg-white px-5 pb-4 pt-5 shadow-2xl ring-1 ring-black/5"
          role="dialog"
          aria-labelledby="zipgrade-scan-title"
        >
          <p id="zipgrade-scan-title" className="text-[13px] font-medium text-gray-500">
            Nombre
          </p>
          <div className="mt-1 min-h-[2.75rem] rounded-lg border border-gray-200 bg-gray-50/80 px-2 py-1.5">
            {nameCropUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={nameCropUrl}
                alt="Nombre del alumno"
                className="h-10 max-w-full object-contain object-left"
              />
            ) : studentName ? (
              <p className="text-lg font-semibold text-gray-900">{studentName}</p>
            ) : (
              <p className="text-sm italic text-gray-400">Sin nombre detectado</p>
            )}
          </div>

          <p className="mt-4 text-[13px] font-medium text-gray-500">Calificación</p>
          <p className="mt-0.5 text-[2rem] font-bold leading-tight tracking-tight text-gray-950">
            {score.correct}/{score.total} = {score.pct}%
          </p>

          <p className="mt-2 text-sm text-gray-500">
            ID:{' '}
            <span className="font-semibold text-gray-800 tabular-nums">
              {controlNumber ?? '—'}
            </span>
          </p>

          {showOverlayPreview && sheet ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-orange-100 bg-orange-50/40 p-1">
              <div
                className="relative mx-auto w-full overflow-hidden rounded-md bg-white"
                style={{
                  aspectRatio: `${overlayW} / ${overlayH}`,
                  maxHeight: 'min(38vh, 14rem)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewSrc!}
                  alt="Hoja escaneada con clave"
                  className="absolute inset-0 z-0 h-full w-full object-contain object-center"
                />
                <CalifacilOmrReviewOverlay
                  geometry={sheet.geometry}
                  picks={sheet.picks}
                  expectedPicks={sheet.expectedPicks}
                  rowCount={sheet.rowCount}
                />
              </div>
              <p className="mt-2 px-1 text-center text-[11px] leading-snug text-gray-600">
                <span className="font-medium text-orange-600">Naranja</span> = clave ·{' '}
                <span className="font-medium text-green-700">Verde</span> = acierto ·{' '}
                <span className="font-medium text-red-600">Rojo</span> = error
              </p>
            </div>
          ) : null}

          <div className="mt-5 space-y-2 border-t border-gray-100 pt-4">
            <Button
              type="button"
              className="w-full bg-orange-600 hover:bg-orange-700"
              onClick={onAnotherStudent}
            >
              Calificar otro alumno
            </Button>
            <Button type="button" variant="outline" className="w-full" onClick={onBackToCalificar}>
              Volver a Calificar
            </Button>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="ghost" className="flex-1 text-orange-700" onClick={onRetake}>
                Repetir captura
              </Button>
              <Button type="button" variant="ghost" className="flex-1 text-orange-700" onClick={onReview}>
                Revisión detallada
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

type ReviewScreenProps = {
  open: boolean;
  examTitle: string;
  sheet: ZipGradeSheetData | null;
  studentName?: string;
  controlNumber?: string | null;
  sheetIndex: number;
  sheetCount: number;
  onBack: () => void;
  onPrevSheet: () => void;
  onNextSheet: () => void;
  onRetake: () => void;
  onSave: () => void;
  onExport?: () => void;
  onPickStudent?: () => void;
  questionsContent?: ReactNode;
};

type ReviewTab = 'imagen' | 'preguntas';

export function MobileZipGradeReviewScreen({
  open,
  examTitle,
  sheet,
  studentName,
  controlNumber,
  sheetIndex,
  sheetCount,
  onBack,
  onPrevSheet,
  onNextSheet,
  onRetake,
  onSave,
  onExport,
  onPickStudent,
  questionsContent,
}: ReviewScreenProps) {
  const [tab, setTab] = useState<ReviewTab>('imagen');
  const [menuOpen, setMenuOpen] = useState(false);

  const scoreLine = useMemo(() => {
    if (!sheet) return '';
    return `${sheet.correct} / ${sheet.total} = ${sheet.pct}%`;
  }, [sheet]);

  const wrongCount = sheet ? Math.max(0, sheet.total - sheet.correct) : 0;

  if (!open || !sheet || typeof document === 'undefined') return null;

  const W = Math.max(1, sheet.geometry.imageWidth);
  const H = Math.max(1, sheet.geometry.imageHeight);

  return createPortal(
    <div
      className="fixed inset-0 z-[290] flex flex-col bg-orange-50/40"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header className="flex shrink-0 items-center justify-between bg-orange-600 px-2 py-2.5 text-white shadow-sm">
        <button
          type="button"
          className="flex min-w-[4.5rem] items-center gap-0.5 px-2 py-1 text-[17px] font-normal active:opacity-70"
          onClick={onBack}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Resultado
        </button>
        <h1 className="text-[15px] font-semibold tracking-[0.12em]">REVISIÓN</h1>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg active:bg-white/10"
          aria-label="Menú"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {menuOpen ? (
        <div className="relative z-[291] shrink-0 border-b border-gray-200 bg-white px-3 py-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {onPickStudent ? (
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-800 active:bg-gray-100"
                onClick={() => {
                  setMenuOpen(false);
                  onPickStudent();
                }}
              >
                Cambiar alumno
              </button>
            ) : null}
            {onExport ? (
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-800 active:bg-gray-100"
                onClick={() => {
                  setMenuOpen(false);
                  onExport();
                }}
              >
                Exportar CSV
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="shrink-0 bg-white px-4 pb-3 pt-4 shadow-sm">
        <p className="text-center text-[clamp(1.75rem,8vw,2.1rem)] font-bold leading-none tracking-tight text-gray-950">
          {scoreLine}
        </p>
        <p className="mt-2 text-center text-[13px] text-gray-600">
          <span className="font-semibold text-green-700">{sheet.correct} aciertos</span>
          {' · '}
          <span className="font-semibold text-red-600">{wrongCount} errores</span>
          {sheetCount > 1 ? (
            <>
              {' · '}
              <span className="text-gray-500">
                Hoja {sheetIndex + 1}/{sheetCount}
              </span>
            </>
          ) : null}
        </p>
        <div className="mx-auto mt-3 flex max-w-md flex-col items-center gap-2">
          {sheet.nameCropUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={sheet.nameCropUrl}
              alt="Nombre"
              className="max-h-12 max-w-[min(100%,18rem)] object-contain"
            />
          ) : studentName ? (
            <p className="text-lg font-semibold text-gray-900">{studentName}</p>
          ) : null}
          <p className="text-xs text-gray-500">
            {examTitle}
            {controlNumber ? (
              <>
                {' '}
                · Control <span className="font-medium tabular-nums">{controlNumber}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-orange-50/50">
        {tab === 'imagen' ? (
          <div className="flex justify-center p-3">
            <div className="flex w-full max-w-lg justify-center overflow-hidden rounded-lg border bg-white p-1 shadow-sm">
              <div
                className="relative w-full overflow-hidden bg-white"
                style={{
                  aspectRatio: `${W} / ${H}`,
                  maxHeight: 'min(70vh, 28rem)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sheet.previewUrl}
                  alt="Hoja escaneada"
                  className="absolute inset-0 z-0 h-full w-full object-contain object-center"
                />
                <CalifacilOmrReviewOverlay
                  geometry={sheet.geometry}
                  picks={sheet.picks}
                  expectedPicks={sheet.expectedPicks}
                  rowCount={sheet.rowCount}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4">{questionsContent}</div>
        )}
      </div>

      <footer className="shrink-0 border-t border-orange-100 bg-white/95 backdrop-blur-xl">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full text-orange-600 active:bg-orange-50 disabled:opacity-30"
            disabled={sheetIndex <= 0}
            onClick={onPrevSheet}
            aria-label="Hoja anterior"
          >
            <ChevronLeft className="h-8 w-8" strokeWidth={2.5} />
          </button>

          <div className="flex rounded-full bg-gray-200/90 p-0.5">
            {(
              [
                ['imagen', 'Imagen'],
                ['preguntas', 'Preguntas'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  'rounded-full px-5 py-2 text-[13px] font-medium transition-all',
                  tab === id
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 active:bg-white/50'
                )}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full text-orange-600 active:bg-orange-50 disabled:opacity-30"
            disabled={sheetIndex >= sheetCount - 1}
            onClick={onNextSheet}
            aria-label="Hoja siguiente"
          >
            <ChevronRight className="h-8 w-8" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex gap-2 border-t border-gray-200 px-4 py-3">
          <Button type="button" variant="outline" className="flex-1" onClick={onRetake}>
            Otra foto
          </Button>
          <Button
            type="button"
            className="flex-1 bg-orange-600 hover:bg-orange-700"
            onClick={onSave}
          >
            Guardar
          </Button>
        </div>
      </footer>
    </div>,
    document.body
  );
}

type StudentPickerProps = {
  open: boolean;
  students: Student[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  autoOptionId?: string;
  autoOptionLabel?: string;
};

export function MobileZipGradeStudentPicker({
  open,
  students,
  selectedId,
  onSelect,
  onClose,
  autoOptionId,
  autoOptionLabel,
}: StudentPickerProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[310] flex flex-col justify-end bg-black/40">
      <button type="button" className="flex-1" aria-label="Cerrar" onClick={onClose} />
      <div className="max-h-[70vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 bg-orange-50/60 px-4 py-3">
          <p className="text-center text-[15px] font-semibold text-gray-900">Alumno</p>
        </div>
        <ul className="max-h-[55vh] overflow-y-auto">
          {autoOptionId !== undefined && autoOptionLabel !== undefined ? (
            <li>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between border-b border-gray-50 px-4 py-3.5 text-left text-[17px] active:bg-gray-50',
                  selectedId === autoOptionId && 'bg-orange-50 font-semibold text-orange-900'
                )}
                onClick={() => {
                  onSelect(autoOptionId);
                  onClose();
                }}
              >
                <span>{autoOptionLabel}</span>
              </button>
            </li>
          ) : null}
          {students.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between border-b border-gray-50 px-4 py-3.5 text-left text-[17px] active:bg-gray-50',
                  selectedId === s.id && 'bg-orange-50 font-semibold text-orange-900'
                )}
                onClick={() => {
                  onSelect(s.id);
                  onClose();
                }}
              >
                <span>{s.name}</span>
                {s.control_number ? (
                  <span className="text-sm tabular-nums text-gray-500">{s.control_number}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}
