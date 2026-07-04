'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Camera, CheckCircle2, ChevronRight, Loader2, ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Exam, Student } from '@/types';
import { MobileZipGradeStudentPicker } from '@/components/mobile-zipgrade-results';

const ZIPGRADE_GREEN = '#4A7C59';

type Props = {
  exams: Exam[];
  examsLoading: boolean;
  examId: string;
  exam: Exam | null | undefined;
  examLoading: boolean;
  students: Student[];
  selectedStudentId: string;
  selectedStudentName: string;
  detectedControlNumber: string | null;
  autoIdentifyByControl: boolean;
  canGradeStudents: boolean;
  supportsCalifacil: boolean;
  virtualKeyReady: number;
  virtualKeyTotal: number;
  sheetIndex: number;
  totalSheets: number;
  scanBusy: boolean;
  onSelectExam: (id: string) => void;
  onSelectStudent: (id: string) => void;
  onScan: () => void;
  onImportPhoto?: () => void;
  onShowKeyTable?: () => void;
};

function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]', className)}>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  hint,
  onPress,
  disabled,
  last,
}: {
  label: string;
  value: string;
  hint?: string;
  onPress?: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const Tag = onPress ? 'button' : 'div';
  return (
    <Tag
      type={onPress ? 'button' : undefined}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
        !last && 'border-b border-gray-100',
        onPress && !disabled && 'active:bg-gray-50',
        disabled && 'opacity-55'
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-gray-500">{label}</p>
        <p className="truncate text-[17px] font-medium text-gray-950">{value}</p>
        {hint ? <p className="mt-0.5 text-[12px] leading-snug text-gray-500">{hint}</p> : null}
      </div>
      {onPress ? <ChevronRight className="h-5 w-5 shrink-0 text-gray-300" /> : null}
    </Tag>
  );
}

export function CalificarMobileHome({
  exams,
  examsLoading,
  examId,
  exam,
  examLoading,
  students,
  selectedStudentId,
  selectedStudentName,
  detectedControlNumber,
  autoIdentifyByControl,
  canGradeStudents,
  supportsCalifacil,
  virtualKeyReady,
  virtualKeyTotal,
  sheetIndex,
  totalSheets,
  scanBusy,
  onSelectExam,
  onSelectStudent,
  onScan,
  onImportPhoto,
}: Props) {
  const [examPickerOpen, setExamPickerOpen] = useState(false);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);

  const examTitle = useMemo(() => {
    if (examsLoading) return 'Cargando exámenes…';
    if (!examId) return 'Elegir examen';
    return exam?.title ?? exams.find((e) => e.id === examId)?.title ?? 'Examen seleccionado';
  }, [exam, examId, exams, examsLoading]);

  const studentLabel = useMemo(() => {
    if (detectedControlNumber && selectedStudentName) {
      return `${selectedStudentName} · ${detectedControlNumber}`;
    }
    if (selectedStudentName) return selectedStudentName;
    if (autoIdentifyByControl) return 'Auto (n.º de control)';
    return 'Elegir alumno';
  }, [autoIdentifyByControl, detectedControlNumber, selectedStudentName]);

  const readyToScan =
    Boolean(examId) &&
    supportsCalifacil &&
    canGradeStudents &&
    !examLoading &&
    (Boolean(selectedStudentId) || autoIdentifyByControl);

  return (
    <div className="calificar-mobile-enter flex min-h-[calc(100dvh-4.25rem-env(safe-area-inset-bottom,0px))] flex-col bg-[#f2f2f7] lg:hidden">
      <div className="shrink-0 px-4 pb-2 pt-1">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight text-gray-950">Calificar</h1>
        <p className="mt-1 text-[15px] text-gray-500">
          Escanea la hoja de respuestas. Calificación al instante.
        </p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-28 pt-2">
        <div>
          <p className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-gray-500">
            Configuración
          </p>
          <Group>
            <Row
              label="Examen"
              value={examTitle}
              hint={
                examLoading
                  ? 'Cargando preguntas…'
                  : examId
                    ? `${virtualKeyReady}/${virtualKeyTotal} reactivos con clave`
                    : 'Toca para elegir un examen publicado'
              }
              onPress={() => !examsLoading && setExamPickerOpen(true)}
              disabled={examsLoading}
            />
            <Row
              label="Alumno"
              value={studentLabel}
              hint={
                autoIdentifyByControl
                  ? 'Opcional si la hoja tiene número de control marcado'
                  : 'Requerido antes de escanear'
              }
              onPress={() => canGradeStudents && setStudentPickerOpen(true)}
              disabled={!canGradeStudents || !examId}
              last
            />
          </Group>
        </div>

        {examId && examLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-white py-8 text-sm text-gray-500 shadow-sm ring-1 ring-black/[0.04]">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            Preparando clave automática…
          </div>
        ) : null}

        {exam && supportsCalifacil && canGradeStudents ? (
          <div
            className="flex items-start gap-3 rounded-2xl px-4 py-3.5 shadow-sm ring-1 ring-emerald-200/80"
            style={{ backgroundColor: 'rgba(74, 124, 89, 0.08)' }}
          >
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: ZIPGRADE_GREEN }} />
            <div>
              <p className="text-[15px] font-semibold text-gray-900">Listo para escanear</p>
              <p className="mt-0.5 text-[13px] leading-snug text-gray-600">
                Hoja {sheetIndex + 1} de {totalSheets}. El escáner detecta el documento como en iPhone.
              </p>
            </div>
          </div>
        ) : null}

        {exam && !supportsCalifacil ? (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
            Este examen necesita solo preguntas de opción múltiple (2–5 opciones).
          </p>
        ) : null}
      </div>

      <div
        className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-20 space-y-2 px-4"
        style={{ pointerEvents: 'none' }}
      >
        <button
          type="button"
          disabled={!readyToScan || scanBusy}
          onClick={onScan}
          className={cn(
            'pointer-events-auto flex w-full items-center justify-center gap-2.5 rounded-2xl py-4 text-[17px] font-semibold text-white shadow-lg transition-all active:scale-[0.98] disabled:opacity-45',
            readyToScan ? 'shadow-emerald-900/20' : 'shadow-black/10'
          )}
          style={{ backgroundColor: readyToScan ? ZIPGRADE_GREEN : '#9ca3af' }}
        >
          {scanBusy ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Camera className="h-6 w-6" strokeWidth={2.25} />
          )}
          Escanear hoja
        </button>
        {onImportPhoto ? (
          <button
            type="button"
            disabled={!readyToScan || scanBusy}
            onClick={onImportPhoto}
            className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white py-3 text-[15px] font-medium text-gray-800 shadow-sm active:bg-gray-50 disabled:opacity-45"
          >
            Importar foto de galería
          </button>
        ) : null}
      </div>

      {examPickerOpen ? (
        <div className="fixed inset-0 z-[240] flex flex-col justify-end bg-black/40">
          <button
            type="button"
            className="flex-1"
            aria-label="Cerrar"
            onClick={() => setExamPickerOpen(false)}
          />
          <div className="max-h-[70vh] overflow-hidden rounded-t-2xl bg-[#f2f2f7] shadow-2xl">
            <div className="border-b border-gray-200/80 bg-white px-4 py-3.5">
              <p className="text-center text-[15px] font-semibold text-gray-900">Elegir examen</p>
            </div>
            <ul className="max-h-[55vh] overflow-y-auto bg-white">
              {exams.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-gray-500">No hay exámenes publicados.</li>
              ) : (
                exams.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3.5 text-left active:bg-gray-50',
                        examId === e.id && 'bg-emerald-50/90'
                      )}
                      onClick={() => {
                        onSelectExam(e.id);
                        setExamPickerOpen(false);
                      }}
                    >
                      <ScanLine className="h-5 w-5 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate text-[17px] text-gray-900">{e.title}</span>
                      {examId === e.id ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: ZIPGRADE_GREEN }} />
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}

      <MobileZipGradeStudentPicker
        open={studentPickerOpen}
        students={students}
        selectedId={selectedStudentId}
        onSelect={onSelectStudent}
        onClose={() => setStudentPickerOpen(false)}
      />
    </div>
  );
}
