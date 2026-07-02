'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Menu, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';
import { CalifacilZipGradeReviewOverlay } from '@/components/califacil-zipgrade-review-overlay';
import type { Student } from '@/types';

const ZIPGRADE_GREEN = '#4A7C59';

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
  score: { correct: number; total: number; pct: number };
  nameCropUrl?: string | null;
  studentName?: string;
  controlNumber?: string | null;
  onDelete: () => void;
  onStudent: () => void;
  onReview: () => void;
};

export function MobileZipGradeScanCompleteModal({
  open,
  examTitle,
  score,
  nameCropUrl,
  studentName,
  controlNumber,
  onDelete,
  onStudent,
  onReview,
}: ScanCompleteModalProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-black/55"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header
        className="flex shrink-0 items-center justify-between px-2 py-2.5 text-white"
        style={{ backgroundColor: ZIPGRADE_GREEN }}
      >
        <button
          type="button"
          className="flex min-w-[5.5rem] items-center gap-0.5 px-2 py-1 text-[17px] font-normal active:opacity-70"
          onClick={onDelete}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Escaneo terminado
        </button>
        <span className="truncate px-2 text-center text-[13px] font-semibold uppercase tracking-[0.2em] opacity-95">
          {examTitle ? examTitle.slice(0, 18) : 'CaliFácil'}
        </span>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg active:bg-white/10"
          aria-label="Ajustes"
        >
          <Settings className="h-5 w-5" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center px-5 py-6">
        <div
          className="w-full max-w-sm animate-fade-in rounded-xl bg-white px-5 pb-4 pt-5 shadow-2xl ring-1 ring-black/5"
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
            {score.correct}/{score.total}={score.pct}%
          </p>

          <p className="mt-2 text-sm text-gray-500">
            ID:{' '}
            <span className="font-semibold text-gray-800 tabular-nums">
              {controlNumber ?? '—'}
            </span>
          </p>

          <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-3">
            <button
              type="button"
              className="px-2 py-2 text-[17px] font-medium"
              style={{ color: ZIPGRADE_GREEN }}
              onClick={onDelete}
            >
              Borrar
            </button>
            <button
              type="button"
              className="px-2 py-2 text-[17px] font-medium"
              style={{ color: ZIPGRADE_GREEN }}
              onClick={onStudent}
            >
              Estudiante
            </button>
            <button
              type="button"
              className="px-2 py-2 text-[17px] font-semibold"
              style={{ color: ZIPGRADE_GREEN }}
              onClick={onReview}
            >
              Revisión
            </button>
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
  questionsContent,
}: ReviewScreenProps) {
  const [tab, setTab] = useState<ReviewTab>('imagen');

  const scoreLine = useMemo(() => {
    if (!sheet) return '';
    return `${sheet.correct} / ${sheet.total} = ${sheet.pct}%`;
  }, [sheet]);

  if (!open || !sheet || typeof document === 'undefined') return null;

  const W = Math.max(1, sheet.geometry.imageWidth);
  const H = Math.max(1, sheet.geometry.imageHeight);

  return createPortal(
    <div
      className="fixed inset-0 z-[290] flex flex-col bg-[#f2f2f7]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <header
        className="flex shrink-0 items-center justify-between px-2 py-2.5 text-white shadow-sm"
        style={{ backgroundColor: ZIPGRADE_GREEN }}
      >
        <button
          type="button"
          className="flex min-w-[4.5rem] items-center gap-0.5 px-2 py-1 text-[17px] font-normal active:opacity-70"
          onClick={onBack}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
          Atrás
        </button>
        <h1 className="text-[15px] font-semibold tracking-[0.12em]">REVISIÓN</h1>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg active:bg-white/10"
          aria-label="Menú"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      <div className="shrink-0 bg-white px-4 pb-3 pt-4 shadow-sm">
        <p className="text-center text-[2.1rem] font-bold leading-none tracking-tight text-gray-950">
          {scoreLine}
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

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#e8e8ed]">
        {tab === 'imagen' ? (
          <div className="flex justify-center p-3">
            <div
              className="relative w-full max-w-lg overflow-hidden rounded-sm bg-white shadow-md"
              style={{ aspectRatio: `${W} / ${H}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sheet.previewUrl}
                alt="Hoja escaneada"
                className="absolute inset-0 h-full w-full object-contain"
              />
              <CalifacilZipGradeReviewOverlay
                geometry={sheet.geometry}
                picks={sheet.picks}
                expectedPicks={sheet.expectedPicks}
                rowCount={sheet.rowCount}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4">{questionsContent}</div>
        )}
      </div>

      <footer className="shrink-0 border-t border-gray-300/80 bg-white/95 backdrop-blur-xl">
        <div className="flex items-center justify-between px-3 py-2">
          <button
            type="button"
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
            style={{ color: ZIPGRADE_GREEN }}
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
            className="flex h-11 w-11 items-center justify-center rounded-full active:bg-gray-100 disabled:opacity-30"
            style={{ color: ZIPGRADE_GREEN }}
            disabled={sheetIndex >= sheetCount - 1}
            onClick={onNextSheet}
            aria-label="Hoja siguiente"
          >
            <ChevronRight className="h-8 w-8" strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex gap-2 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-800 active:bg-gray-50"
            onClick={onRetake}
          >
            Otra foto
          </button>
          <button
            type="button"
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white active:opacity-90"
            style={{ backgroundColor: ZIPGRADE_GREEN }}
            onClick={onSave}
          >
            Guardar
          </button>
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
};

export function MobileZipGradeStudentPicker({
  open,
  students,
  selectedId,
  onSelect,
  onClose,
}: StudentPickerProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[310] flex flex-col justify-end bg-black/40">
      <button type="button" className="flex-1" aria-label="Cerrar" onClick={onClose} />
      <div className="max-h-[70vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-4 py-3">
          <p className="text-center text-[15px] font-semibold text-gray-900">Elegir alumno</p>
        </div>
        <ul className="max-h-[55vh] overflow-y-auto">
          {students.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between border-b border-gray-50 px-4 py-3.5 text-left text-[17px] active:bg-gray-50',
                  selectedId === s.id && 'bg-emerald-50/80 font-semibold text-emerald-900'
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
