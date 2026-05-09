'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Info, LayoutDashboard, Loader2, AlertCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useExam, useExams } from '@/hooks/useExams';
import { supabase } from '@/lib/supabase';
import {
  buildCalifacilVirtualKey,
  CALIFACIL_VIEWFINDER_GUIDE,
  chunkQuestions,
  califacilOmrColumnCount,
  examSupportsCalifacilOmr,
} from '@/lib/printExam';
import {
  autoOrientCalifacilSheet,
  califacilGeometryTableBounds,
  califacilImageToJpegDataUrl,
  califacilViewfinderNormRect,
  fileToImage,
  isCalifacilExamSheetLikely,
  prepareCalifacilScanInput,
  scanCalifacilOmrSheet,
  scanCalifacilOmrSheetWithMeta,
  type CalifacilOmrScanGeometry,
} from '@/lib/omrScan';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';
import {
  calculatePercentage,
  cn,
  getGradeColor,
  getGradeLabel,
  resolveOptionIndexFromValue,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StudentCombobox } from '@/components/student-combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Exam, Question, Student } from '@/types';
import { toSpanishAuthMessage } from '@/lib/authErrors';
import { useIsMobile } from '@/hooks/use-mobile';
import { CALIFACIL_VISION_POLICY } from '@/lib/califacilVisionPolicy';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import {
  playAutoCaptureClickSound,
  playScanCompleteChime,
  resumeScanAudioContext,
  startScanningHum,
  stopScanningHum,
} from '@/lib/scanSounds';

type Phase = 'elegir' | 'capturar' | 'revisar_hoja' | 'guardando' | 'ver_resultados';

type MobileSheetSnapshot = {
  sheetIndex: number;
  previewUrl: string;
  geometry: CalifacilOmrScanGeometry;
  questionIds: string[];
  selectionsByQuestionId: Record<string, string>;
};

async function cloneObjectUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** Umbral mínimo de reactivos leídos para fijar borrador y habilitar guardado en cámara en vivo. */
const MIN_AUTO_READ_RATIO = 0.9;
/** Fotogramas consecutivos con lectura estable antes de fijar borrador (consenso en vivo). */
const STABLE_PARTIAL_TICKS = 3;
/** Fotogramas consecutivos con hoja completa para disparar captura automática. */
const STABLE_FULL_TICKS = 2;
/** Si más filas ambiguas que esto, aviso explícito en revisión. */
const AMBIGUOUS_ROW_WARN_RATIO = 0.35;
/** Resolución máxima usada para escaneo en vivo móvil (mejora fluidez). */
const MOBILE_SCAN_MAX_WIDTH = 960;
/** Tras varios ticks sin detección, intentamos flash en móvil si está disponible. */
const LOW_VISIBILITY_AUTOTORCH_TICKS = 5;
/** Etiquetas de cámaras virtuales comunes que no queremos priorizar en escritorio. */
const VIRTUAL_CAMERA_RE = /(droidcam|airdroid|iriun|epoccam|obs|virtual|ndi)/i;

/** Valores centinela para que Radix Select sea siempre controlado (evita uncontrolled→controlled). */
const SELECT_NO_EXAM = '__califacil_no_exam__';
const SELECT_NO_OPTION = '__califacil_no_option__';

function isVirtualCameraLabel(label: string | undefined): boolean {
  return Boolean(label && VIRTUAL_CAMERA_RE.test(label));
}

async function pickPreferredDesktopCameraDeviceId(excludeDeviceId?: string): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videos = devices.filter((d) => d.kind === 'videoinput');
  if (videos.length === 0) return null;
  const filtered = videos.filter((d) => d.deviceId && d.deviceId !== excludeDeviceId);
  const preferred =
    filtered.find((d) => !isVirtualCameraLabel(d.label)) ??
    videos.find((d) => !isVirtualCameraLabel(d.label)) ??
    filtered[0] ??
    videos[0];
  return preferred?.deviceId ?? null;
}

async function fetchVisionOmr(payload: {
  examId: string;
  imageBase64: string;
  rows: { questionId: string; globalNumber: number; options: string[] }[];
  omrColumnCount: number;
  focusNumbers: number[];
}) {
  const headers = await dashboardAuthJsonHeaders();
  const controller = new AbortController();
  const timeoutMs = 9000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch('/api/calificar/vision-omr', {
      method: 'POST',
      headers: { ...headers },
      credentials: 'include',
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Permite que React y el navegador pinten el spinner antes de trabajo pesado en el hilo principal;
 * si no, la animación CSS parece “congelada”.
 */
function yieldForSpinnerPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Convierte borrador de texto a índice de columna OMR por fila (0 = A). */
function draftSelectionsToColumnPicks(
  chunk: Question[],
  draft: Record<string, string>
): (number | null)[] {
  const out: (number | null)[] = Array(10).fill(null);
  for (let i = 0; i < chunk.length; i++) {
    const q = chunk[i];
    const text = draft[q.id]?.trim() ?? '';
    const opts = q.options ?? [];
    const idx = resolveOptionIndexFromValue(opts, text);
    out[i] = idx !== null ? idx : null;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Marco naranja de referencia: coincide con la tabla detectada si hay geometría; si no, la guía del visor. */
function califacilReviewOrangeFrameRect(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): { x: number; y: number; w: number; h: number } | null {
  return (
    califacilGeometryTableBounds(geometry, rowCount) ??
    califacilViewfinderNormRect(geometry.imageWidth, geometry.imageHeight)
  );
}

export default function CalificarPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  // En desktop la calificación debe hacerse solo por carga de imágenes escaneadas.
  const useLiveCameraUi = isMobile;
  const { user } = useAuth();
  const { exams, loading: examsLoading } = useExams(user?.id);

  const [examId, setExamId] = useState<string>('');
  const { exam, loading: examLoading } = useExam(examId || undefined);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [allowedGroupIds, setAllowedGroupIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('elegir');
  const [sheetIndex, setSheetIndex] = useState(0);
  /** Respuestas confirmadas por id de pregunta (todas las hojas) */
  const [confirmedByQuestionId, setConfirmedByQuestionId] = useState<Record<string, string>>({});
  /** Lectura OMR de la hoja actual (antes de confirmar) */
  const [draftSelections, setDraftSelections] = useState<Record<string, string>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** Geometría de celdas del último escaneo (misma relación de aspecto que la vista previa). */
  const [reviewOmrGeometry, setReviewOmrGeometry] = useState<CalifacilOmrScanGeometry | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Sube una imagen escaneada para leer respuestas.');
  const [liveResolvedCount, setLiveResolvedCount] = useState(0);
  const [liveDraftSelections, setLiveDraftSelections] = useState<Record<string, string>>({});
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mobileCameraShellRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveTickRef = useRef<number | null>(null);
  const liveBusyRef = useRef(false);
  const stablePartialTicksRef = useRef(0);
  const stableFullTicksRef = useRef(0);
  const lowVisibilityTicksRef = useRef(0);
  const autotorchTriedRef = useRef(false);
  const glareHintShownRef = useRef(false);
  const autoFinalizeInProgressRef = useRef(false);
  /** Respuestas ya capturadas en vivo por id de pregunta; no se sobrescriben hasta «Escanear otra vez». */
  const liveLockedAnswersRef = useRef<Record<string, string>>({});
  /** Evita repetir el sonido de «hoja completa» en cada fotograma. */
  const liveCompleteSoundPlayedRef = useRef(false);
  const scanBusyRef = useRef(false);
  const startingCameraRef = useRef(false);
  /** Permite abrir la cámara en el mismo clic que pone `phase` en `capturar` (evita doble toque). */
  const startLiveCameraRef = useRef<
    ((opts?: { skipPhaseGuard?: boolean }) => Promise<void>) | undefined
  >(undefined);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const confirmedAnswersRef = useRef<Record<string, string>>({});
  const sheetIndexRef = useRef(0);
  const prevPhaseRef = useRef<Phase>('elegir');

  const [reviewQualityHint, setReviewQualityHint] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(55);
  const [autoSnapshotUrl, setAutoSnapshotUrl] = useState<string | null>(null);
  const [showAutoSnapshot, setShowAutoSnapshot] = useState(false);

  const [autoGradeDialogOpen, setAutoGradeDialogOpen] = useState(false);
  const [virtualKeyTableDialogOpen, setVirtualKeyTableDialogOpen] = useState(false);
  const [autoGradeStats, setAutoGradeStats] = useState<{
    pct: number;
    correct: number;
    wrong: number;
    total: number;
  } | null>(null);

  const [mobileSheetSnapshots, setMobileSheetSnapshots] = useState<MobileSheetSnapshot[]>([]);
  const [mobileResultsDraft, setMobileResultsDraft] = useState<Record<string, string>>({});
  const [resultsSheetIdx, setResultsSheetIdx] = useState(0);
  const mobileCaptureBusyRef = useRef(false);
  const phaseRef = useRef<Phase>('elegir');
  const finalizeCapturedSheetRef = useRef<
    (
      source: HTMLImageElement | HTMLCanvasElement,
      fallbackFile?: File,
      opts?: { skipReviewUi?: boolean }
    ) => Promise<{ success: boolean; chunkDraft?: Record<string, string> }>
  >(async () => ({ success: false }));

  const publishedExams = useMemo(
    () => (exams as Exam[]).filter((e) => e.status === 'published'),
    [exams]
  );

  const questions = useMemo(() => exam?.questions ?? [], [exam]);
  const omrCols = califacilOmrColumnCount(questions);
  const supportsCalifacil = exam ? examSupportsCalifacilOmr(questions) : false;
  const virtualKey = useMemo(() => buildCalifacilVirtualKey(questions), [questions]);
  const examVirtualKeyByQuestionId = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const row of virtualKey.rows) {
      out[row.questionId] = row.correctOption;
    }
    return out;
  }, [virtualKey.rows]);
  const virtualKeyCorrectIndexByQuestionId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of virtualKey.rows) {
      out[row.questionId] = row.correctIndex;
    }
    return out;
  }, [virtualKey.rows]);
  const sheets = useMemo(() => chunkQuestions(questions, 10), [questions]);
  const totalSheets = sheets.length;
  const currentChunk = useMemo(() => sheets[sheetIndex] ?? [], [sheets, sheetIndex]);
  const maxQuestions = 30;
  const expectedChunkPicks = useMemo(
    () => draftSelectionsToColumnPicks(currentChunk, examVirtualKeyByQuestionId),
    [currentChunk, examVirtualKeyByQuestionId]
  );
  const reviewOrangeFrameRect = useMemo(
    () =>
      reviewOmrGeometry
        ? califacilReviewOrangeFrameRect(reviewOmrGeometry, currentChunk.length)
        : null,
    [reviewOmrGeometry, currentChunk.length]
  );

  /** Comparación borrador vs clave automática solo en la hoja actual (p. ej. 4/10 · 40%). */
  const chunkKeyComparison = useMemo(() => {
    let correct = 0;
    const total = currentChunk.length;
    for (let i = 0; i < currentChunk.length; i++) {
      const q = currentChunk[i];
      const draftText = draftSelections[q.id]?.trim() ?? '';
      const expectedText = examVirtualKeyByQuestionId[q.id]?.trim() ?? '';
      if (!expectedText) continue;
      const pi = resolveOptionIndexFromValue(q.options ?? [], draftText);
      const ei = resolveOptionIndexFromValue(q.options ?? [], expectedText);
      if (pi !== null && ei !== null && pi === ei) correct++;
    }
    const pct = total > 0 ? calculatePercentage(correct, total) : 0;
    return { correct, total, pct };
  }, [currentChunk, draftSelections, examVirtualKeyByQuestionId]);

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [students]
  );

  useEffect(() => {
    confirmedAnswersRef.current = confirmedByQuestionId;
  }, [confirmedByQuestionId]);

  useEffect(() => {
    sheetIndexRef.current = sheetIndex;
  }, [sheetIndex]);

  const selectedStudentName =
    sortedStudents.find((s) => s.id === selectedStudentId)?.name ?? '';
  const virtualKeyMcTotal = questions.filter((q) => q.type === 'multiple_choice').length;
  const virtualKeyReadyCount = Object.keys(examVirtualKeyByQuestionId).length;
  const virtualKeyComplete =
    supportsCalifacil &&
    virtualKey.issues.length === 0 &&
    virtualKeyMcTotal > 0 &&
    virtualKeyReadyCount === virtualKeyMcTotal;
  const canGradeStudents = virtualKeyComplete;

  const setTorchEnabled = useCallback(async (enabled: boolean) => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return false;
    const capabilities =
      typeof track.getCapabilities === 'function'
        ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
        : null;
    if (!capabilities?.torch) return false;
    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled } as MediaTrackConstraintSet],
      });
      setFlashOn(enabled);
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearAutoSnapshot = useCallback(() => {
    setShowAutoSnapshot(false);
    setAutoSnapshotUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const showAutoCaptureSnapshot = useCallback(
    async (source: HTMLCanvasElement | HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      const w =
        source instanceof HTMLCanvasElement
          ? source.width
          : Math.max(1, Math.round(source.naturalWidth || source.width));
      const h =
        source instanceof HTMLCanvasElement
          ? source.height
          : Math.max(1, Math.round(source.naturalHeight || source.height));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
      );
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setAutoSnapshotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setShowAutoSnapshot(true);
      playAutoCaptureClickSound();
      setLiveStatus('Captura automática realizada');
      await sleep(500);
      setShowAutoSnapshot(false);
    },
    []
  );

  const resetLiveReadings = useCallback(() => {
    stablePartialTicksRef.current = 0;
    stableFullTicksRef.current = 0;
    lowVisibilityTicksRef.current = 0;
    autotorchTriedRef.current = false;
    glareHintShownRef.current = false;
    autoFinalizeInProgressRef.current = false;
    liveLockedAnswersRef.current = {};
    liveCompleteSoundPlayedRef.current = false;
    stopScanningHum();
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus(
      isMobile
        ? 'Encuadra la hoja carta completa: alinea las esquinas grises con los cuadros negros de las esquinas del papel, o pulsa «Tomar foto».'
        : 'Elige una imagen: puede ser la hoja completa o solo el recuadro CaliFacil; se leerá la tabla y se comparará con la clave del examen.'
    );
    clearAutoSnapshot();
  }, [clearAutoSnapshot, isMobile]);

  const stopLiveCamera = useCallback(() => {
    stopScanningHum();
    if (liveTickRef.current !== null) {
      window.clearInterval(liveTickRef.current);
      liveTickRef.current = null;
    }
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
    void setTorchEnabled(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    stablePartialTicksRef.current = 0;
    stableFullTicksRef.current = 0;
    lowVisibilityTicksRef.current = 0;
    autotorchTriedRef.current = false;
    glareHintShownRef.current = false;
    autoFinalizeInProgressRef.current = false;
    setFlashSupported(false);
    setFlashOn(false);
    setCameraOpen(false);
    clearAutoSnapshot();
  }, [clearAutoSnapshot, setTorchEnabled]);

  const attachStreamToVideo = useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    await video.play().catch(() => undefined);
  }, []);

  const mapRawToDraft = useCallback(
    (raw: (number | null)[], chunk: Question[]) => {
      const nextDraft: Record<string, string> = {};
      let unresolvedCount = 0;
      for (let i = 0; i < chunk.length; i++) {
        const q = chunk[i];
        const opts = q.options ?? [];
        const col = raw[i];
        const value = col !== null && col < opts.length ? opts[col] : '';
        nextDraft[q.id] = value;
        if (!value) unresolvedCount++;
      }
      return {
        draft: nextDraft,
        unresolvedCount,
        resolvedCount: chunk.length - unresolvedCount,
      };
    },
    []
  );

  const setPreviewFromSource = useCallback(
    async (source: HTMLImageElement | HTMLCanvasElement, fallbackFile?: File) => {
      let nextUrl: string | null = null;
      if (source instanceof HTMLCanvasElement) {
        const blob = await new Promise<Blob | null>((resolve) => {
          source.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
        });
        if (blob) nextUrl = URL.createObjectURL(blob);
      } else if (fallbackFile) {
        nextUrl = URL.createObjectURL(fallbackFile);
      }
      if (!nextUrl && fallbackFile) nextUrl = URL.createObjectURL(fallbackFile);
      if (nextUrl) {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return nextUrl;
        });
      }
    },
    []
  );

  const finalizeCapturedSheet = useCallback(
    async (
      source: HTMLImageElement | HTMLCanvasElement,
      fallbackFile?: File,
      opts?: { skipReviewUi?: boolean }
    ): Promise<{ success: boolean; chunkDraft?: Record<string, string> }> => {
      if (!examId || !exam || !supportsCalifacil) {
        toast.error('Selecciona un examen válido antes de escanear.');
        return { success: false };
      }
      const skipReviewUi = opts?.skipReviewUi;
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) {
        toast.error('No hay preguntas para escanear en esta hoja.');
        return { success: false };
      }
      /** En móvil o archivo subido, respetamos la imagen tal cual: sin auto-rotar/deformar. */
      const preserveCapturedFrame = isMobile || Boolean(fallbackFile);
      const oriented =
        preserveCapturedFrame
          ? source
          : (autoOrientCalifacilSheet(source, omrCols, {
              useGuideCrop: false,
              allowTiltSweep: true,
            }) ?? source);
      const examCanvas =
        oriented instanceof HTMLCanvasElement
          ? oriented
          : prepareCalifacilScanInput(oriented, { useGuideCrop: false });
      if (!examCanvas || !isCalifacilExamSheetLikely(examCanvas, omrCols)) {
        setLiveStatus(
          isMobile
            ? 'No se detecta la tabla CaliFacil. Haz la foto de la hoja carta completa, recta y bien iluminada.'
            : 'No se detecta la tabla CaliFacil. Prueba una foto más nítida de la hoja completa o del pie con la tabla N.º / A–D.'
        );
        toast.error(
          isMobile
            ? 'No se reconoce el examen CaliFacil. Incluye la hoja impresa completa y que se vea el pie con las casillas A–D.'
            : 'No se reconoce el examen CaliFacil. Incluye bien la tabla del pie (página completa o solo el recuadro), buena luz y sin cortes.'
        );
        return { success: false };
      }
      let activeScanSource: HTMLImageElement | HTMLCanvasElement = oriented;
      let meta = scanCalifacilOmrSheetWithMeta(activeScanSource, omrCols, {
        skipGuideCrop: true,
        geometryMode: fallbackFile ? 'fullSheet' : isMobile ? 'fullSheet' : 'auto',
        preserveInputCanvas: preserveCapturedFrame,
        fixedTemplateAnchor: Boolean(fallbackFile),
      });
      let raw = [...meta.picks];
      let mapped = mapRawToDraft(raw, chunk);
      const minResolved = Math.max(1, Math.ceil(chunk.length * MIN_AUTO_READ_RATIO));

      if (isMobile && mapped.resolvedCount < minResolved) {
        const recoverySource =
          autoOrientCalifacilSheet(source, omrCols, {
            useGuideCrop: false,
            allowTiltSweep: true,
          }) ?? (oriented as HTMLCanvasElement | HTMLImageElement);

        const recoveryMeta = scanCalifacilOmrSheetWithMeta(recoverySource, omrCols, {
          skipGuideCrop: true,
          geometryMode: fallbackFile ? 'fullSheet' : isMobile ? 'fullSheet' : 'auto',
          preserveInputCanvas: false,
          fixedTemplateAnchor: Boolean(fallbackFile),
        });
        const recoveryRaw = [...recoveryMeta.picks];
        const recoveryMapped = mapRawToDraft(recoveryRaw, chunk);

        if (recoveryMapped.resolvedCount > mapped.resolvedCount) {
          meta = recoveryMeta;
          raw = recoveryRaw;
          mapped = recoveryMapped;
          activeScanSource = recoverySource;
        }
      }

      const ambiguousIdx = meta.rows
        .map((r, i) => (i < chunk.length && r.ambiguous ? i : -1))
        .filter((i) => i >= 0);

      const si = sheetIndexRef.current;
      const picksInChunk = raw.slice(0, chunk.length);
      const allSameCol =
        chunk.length > 1 &&
        picksInChunk.every((p, i) => i === 0 || p === picksInChunk[0]) &&
        picksInChunk[0] !== null &&
        picksInChunk.every((p) => p !== null);

      if (CALIFACIL_VISION_POLICY.onAmbiguousRows && ambiguousIdx.length > 0 && examId && !fallbackFile) {
        const rowsPayload = ambiguousIdx.map((i) => ({
          questionId: chunk[i].id,
          globalNumber: si * 10 + i + 1,
          options: chunk[i].options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetchVisionOmr({
            examId,
            imageBase64,
            rows: rowsPayload,
            omrColumnCount: omrCols,
            focusNumbers,
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (const i of ambiguousIdx) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (ambiguousIdx.length > 0 && !skipReviewUi) {
              toast.message('Filas dudosas revisadas con visión asistida.');
            }
          } else if (res.status === 503 && payload.code === 'NO_KEY') {
            // Sin API key: se mantienen solo lecturas locales.
          }
        } catch {
          // Fallo de red: mantener lectura local
        }
      }

      if (
        CALIFACIL_VISION_POLICY.onManySameColumnAlign &&
        examId &&
        chunk.length >= 8 &&
        meta.maxSameColumnCount >= 8 &&
        !allSameCol &&
        !fallbackFile
      ) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: si * 10 + i + 1,
          options: q.options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetchVisionOmr({
            examId,
            imageBase64,
            rows: rowsPayload,
            omrColumnCount: omrCols,
            focusNumbers,
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (let i = 0; i < chunk.length; i++) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (!skipReviewUi) {
              toast.message(
                'Lectura revisada con visión (muchas filas en la misma columna; posible desalineación).'
              );
            }
          }
        } catch {
          /* mantener lectura local */
        }
      }

      if (
        CALIFACIL_VISION_POLICY.onAllSameColumn &&
        allSameCol &&
        examId &&
        !ambiguousIdx.length &&
        !fallbackFile
      ) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: si * 10 + i + 1,
          options: q.options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetchVisionOmr({
            examId,
            imageBase64,
            rows: rowsPayload,
            omrColumnCount: omrCols,
            focusNumbers,
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (let i = 0; i < chunk.length; i++) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (!skipReviewUi) {
              toast.message('Lectura revisada con visión (todas las filas coincidían en la misma columna).');
            }
          }
        } catch {
          /* mantener lectura local */
        }
      }

      if (CALIFACIL_VISION_POLICY.onFinalizeEveryRow && examId && chunk.length > 0 && !fallbackFile) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: si * 10 + i + 1,
          options: q.options ?? [],
        }));
        const focusNumbers = rowsPayload.map((r) => r.globalNumber);
        try {
          const imageBase64 = califacilImageToJpegDataUrl(oriented);
          const res = await fetchVisionOmr({
            examId,
            imageBase64,
            rows: rowsPayload,
            omrColumnCount: omrCols,
            focusNumbers,
          });
          const payload = (await res.json().catch(() => ({}))) as {
            selections?: Record<string, string>;
            code?: string;
            error?: string;
          };
          if (res.ok && payload.selections) {
            for (let i = 0; i < chunk.length; i++) {
              const q = chunk[i];
              const text = (payload.selections![q.id] ?? '').trim();
              const opts = q.options ?? [];
              if (text && opts.includes(text)) {
                raw[i] = opts.indexOf(text);
              }
            }
            if (!skipReviewUi) {
              toast.message('Visión aplicada a toda la hoja (modo alta precisión).');
            }
          }
        } catch {
          /* mantener OMR local */
        }
      }

      const locks = liveLockedAnswersRef.current;
      const mergedDraft: Record<string, string> = {};
      let mergedResolved = 0;
      for (const q of chunk) {
        const locked = locks[q.id]?.trim();
        if (locked) {
          mergedDraft[q.id] = locked;
          mergedResolved++;
        } else {
          const v = mapped.draft[q.id]?.trim() ?? '';
          mergedDraft[q.id] = v;
          if (v) {
            locks[q.id] = v;
            mergedResolved++;
          }
        }
      }
      if (mergedResolved < minResolved) {
        const allowManualReview = !skipReviewUi;
        setDraftSelections({});
        setLiveDraftSelections(mergedDraft);
        setLiveResolvedCount(mergedResolved);
        setLiveStatus(
          isMobile
            ? 'Lectura insuficiente: aléjate si la hoja no entra en foco, mejora la luz y evita sombras.'
            : 'Lectura insuficiente: prueba una foto más nítida de la página completa o del pie CaliFacil, bien iluminada.'
        );
        if (!allowManualReview) {
          toast.error(
            isMobile
              ? 'La captura no tiene calidad suficiente. Vuelve a fotografiar la hoja completa con buena luz.'
              : 'La imagen no permite leer bien la tabla. Incluye la hoja completa o el recuadro del pie, con buena luz.'
          );
          return { success: false };
        }
        toast.message(
          isMobile
            ? `Lectura parcial (${mergedResolved}/${chunk.length}). Revisa y corrige manualmente antes de guardar.`
            : `Lectura parcial (${mergedResolved}/${chunk.length}). Se abrió revisión para corregir manualmente.`
        );
      }

      liveLockedAnswersRef.current = {};
      for (const q of chunk) {
        const v = mapped.draft[q.id]?.trim() ?? '';
        if (v) liveLockedAnswersRef.current[q.id] = v;
      }
      setDraftSelections(mapped.draft);
      setLiveDraftSelections(mapped.draft);
      setLiveResolvedCount(mapped.resolvedCount);

      if (!skipReviewUi) {
        const ambiguousRowCount = meta.rows.filter((r, i) => i < chunk.length && r.ambiguous).length;
        if (
          ambiguousRowCount / Math.max(1, chunk.length) >= AMBIGUOUS_ROW_WARN_RATIO ||
          meta.needsVisionAssist
        ) {
          setReviewQualityHint(
            `Lectura automática dudosa en ${ambiguousRowCount} fila(s). Corrige las opciones antes de guardar.`
          );
        } else if (mapped.unresolvedCount > 0) {
          setReviewQualityHint(
            `${mapped.unresolvedCount} pregunta(s) sin lectura clara: elige la opción manualmente.`
          );
        } else {
          setReviewQualityHint(null);
        }

        await setPreviewFromSource(meta.reviewSourceCanvas ?? activeScanSource, fallbackFile);
        setReviewOmrGeometry(meta.geometry);
        setPhase('revisar_hoja');
        setLiveStatus(
          mapped.unresolvedCount > 0
            ? `Lectura parcial: ${mapped.unresolvedCount} sin lectura clara.`
            : 'Lectura completa lista para confirmar.'
        );
        const scanNote =
          mapped.unresolvedCount > 0
            ? `Lectura realizada (${mapped.unresolvedCount} sin lectura clara). Revisa y confirma.`
            : 'Lectura realizada. Revisa y confirma.';
        toast.message(scanNote);
      } else {
        setLiveStatus('Hoja guardada automáticamente.');
      }

      return { success: true, chunkDraft: mapped.draft };
    },
    [exam, examId, isMobile, mapRawToDraft, omrCols, setPreviewFromSource, sheets, supportsCalifacil]
  );

  finalizeCapturedSheetRef.current = finalizeCapturedSheet;

  useEffect(() => {
    if (!exam?.id) {
      setAllowedGroupIds([]);
      setStudents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: assignmentData } = await supabase
        .from('exam_group_assignments')
        .select('group_id')
        .eq('exam_id', exam.id);

      const assignedGroupIds = (assignmentData || [])
        .map((row) => row.group_id as string)
        .filter(Boolean);
      const fallbackGroupId = exam.group_id ? [exam.group_id] : [];
      const examGroupIds = assignedGroupIds.length > 0 ? assignedGroupIds : fallbackGroupId;

      if (!cancelled) {
        setAllowedGroupIds(examGroupIds);
      }

      if (examGroupIds.length === 0) {
        if (!cancelled) setStudents([]);
        return;
      }

      const { data, error } = await supabase
        .from('students')
        .select('*')
        .in('group_id', examGroupIds);
      if (!cancelled && !error) setStudents(data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, [exam?.id, exam?.group_id]);

  useEffect(() => {
    prevPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const clearMobileSnapshots = useCallback(() => {
    setMobileSheetSnapshots((prev) => {
      for (const s of prev) URL.revokeObjectURL(s.previewUrl);
      return [];
    });
  }, []);

  useEffect(() => {
    if (phase !== 'capturar' && cameraOpen) {
      stopLiveCamera();
    }
  }, [cameraOpen, phase, stopLiveCamera]);

  useEffect(() => {
    if (!cameraOpen) return;
    void attachStreamToVideo();
    const video = videoRef.current;
    if (!video) return;
    const onLoadedMetadata = () => {
      void attachStreamToVideo();
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [attachStreamToVideo, cameraOpen]);

  useEffect(() => {
    if (!isMobile || phase !== 'capturar') return;
    let cancelled = false;
    const tryEnter = () => {
      if (cancelled) return;
      const el = mobileCameraShellRef.current;
      if (!el) return;
      const anyEl = el as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const req = el.requestFullscreen?.bind(el) ?? anyEl.webkitRequestFullscreen?.bind(el);
      if (req) void Promise.resolve(req()).catch(() => undefined);
    };
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(tryEnter);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  }, [isMobile, phase]);

  useEffect(() => {
    scanBusyRef.current = scanBusy;
  }, [scanBusy]);

  useEffect(() => {
    return () => {
      stopLiveCamera();
    };
  }, [stopLiveCamera]);

  const resetFlow = useCallback(() => {
    stopLiveCamera();
    clearMobileSnapshots();
    setMobileResultsDraft({});
    setResultsSheetIdx(0);
    setReviewQualityHint(null);
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveStatus(
      isMobile
        ? 'Elige examen y alumno; luego pulsa «Tomar foto» para cada hoja.'
        : 'Sube una imagen escaneada para leer respuestas.'
    );
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setReviewOmrGeometry(null);
    setSelectedStudentId('');
  }, [stopLiveCamera, isMobile, clearMobileSnapshots]);

  const handleStudentChange = (studentId: string) => {
    if (!canGradeStudents) {
      toast.error('No se puede calificar: este examen no tiene clave automática válida en todos sus reactivos.');
      return;
    }
    setSelectedStudentId(studentId);
    if (!studentId) {
      if (isMobile) {
        clearMobileSnapshots();
        setMobileResultsDraft({});
        setResultsSheetIdx(0);
        setPhase('elegir');
      }
      return;
    }
    const canSessionStart =
      Boolean(examId) &&
      Boolean(exam) &&
      !examLoading &&
      supportsCalifacil &&
      questions.length > 0 &&
      questions.length <= maxQuestions &&
      virtualKey.issues.length === 0 &&
      sortedStudents.some((s) => s.id === studentId);
    if (!canSessionStart) return;
    resumeScanAudioContext();
    stopLiveCamera();
    if (isMobile) {
      clearMobileSnapshots();
      setPhase('elegir');
      setSheetIndex(0);
      setConfirmedByQuestionId({});
      setDraftSelections({});
      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      setLiveStatus('Elige examen y alumno; luego pulsa «Tomar foto» para cada hoja.');
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setReviewOmrGeometry(null);
      return;
    }
    flushSync(() => {
      setPhase('capturar');
      setSheetIndex(0);
      setConfirmedByQuestionId({});
      setDraftSelections({});
      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      setLiveStatus(
        'Sube una imagen escaneada para leer respuestas.'
      );
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setReviewOmrGeometry(null);
    });
  };

  const handleGalleryFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!examId || !exam || !supportsCalifacil || phase !== 'capturar') {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Elige un archivo de imagen (JPG, PNG, etc.).');
      return;
    }
    setScanBusy(true);
    await yieldForSpinnerPaint();
    try {
      const img = await fileToImage(file);
      await finalizeCapturedSheet(img, file);
    } catch {
      toast.error('No se pudo leer la imagen.');
    } finally {
      setScanBusy(false);
    }
  };

  const startLiveCamera = useCallback(async (opts?: { skipPhaseGuard?: boolean }) => {
    if (!examId || !exam || !supportsCalifacil) {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return;
    }
    if (!opts?.skipPhaseGuard && phaseRef.current !== 'capturar') {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return;
    }
    if (cameraOpen || startingCameraRef.current) return;
    startingCameraRef.current = true;
    try {
      resumeScanAudioContext();
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        toast.error('Tu navegador no permite cámara en vivo en esta pantalla.');
        startingCameraRef.current = false;
        return;
      }
      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: { facingMode: 'user' }, audio: false },
        { video: true, audio: false },
      ];
      let stream: MediaStream | null = null;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch {
          // Intentamos el siguiente perfil de cámara.
        }
      }
      if (!stream) {
        throw new Error('camera_unavailable');
      }

      if (!isMobile) {
        const initialTrack = stream.getVideoTracks()[0];
        const initialLabel = initialTrack?.label ?? '';
        if (isVirtualCameraLabel(initialLabel)) {
          const currentId =
            typeof initialTrack?.getSettings === 'function'
              ? (initialTrack.getSettings().deviceId ?? undefined)
              : undefined;
          const preferredDeviceId = await pickPreferredDesktopCameraDeviceId(currentId);
          if (preferredDeviceId) {
            try {
              const switched = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: preferredDeviceId } },
                audio: false,
              });
              stream.getTracks().forEach((t) => t.stop());
              stream = switched;
            } catch {
              // Si falla el cambio, mantenemos el stream ya abierto.
            }
          }
        }
      }
      streamRef.current = stream;
      setCameraOpen(true);
      resetLiveReadings();
      await attachStreamToVideo();
      const track = stream.getVideoTracks()[0];
      const capabilities =
        typeof track?.getCapabilities === 'function'
          ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
          : null;
      const supportsTorch = Boolean(capabilities?.torch);
      setFlashSupported(supportsTorch);
      // Inicia siempre con flash apagado para abrir la cámara más rápido.
      setFlashOn(false);
      const liveScanIntervalMs = isMobile ? 900 : 750;
      const scanCanvas = document.createElement('canvas');
      const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
      let hotLoopStatus = '';

      liveTickRef.current = window.setInterval(async () => {
        if (liveBusyRef.current) return;
        if (isMobile && mobileCaptureBusyRef.current) return;
        if (!examId || !exam || phaseRef.current !== 'capturar') {
          stopScanningHum();
          return;
        }
        const video = videoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth < 40 || video.videoHeight < 40) return;
        if (!scanCtx) return;
        liveBusyRef.current = true;
        try {
          let targetW = video.videoWidth;
          let targetH = video.videoHeight;
          if (isMobile && targetW > MOBILE_SCAN_MAX_WIDTH) {
            const s = MOBILE_SCAN_MAX_WIDTH / Math.max(1, targetW);
            targetW = MOBILE_SCAN_MAX_WIDTH;
            targetH = Math.max(1, Math.round(targetH * s));
          }
          if (scanCanvas.width !== targetW || scanCanvas.height !== targetH) {
            scanCanvas.width = targetW;
            scanCanvas.height = targetH;
          }
          scanCtx.drawImage(video, 0, 0, targetW, targetH);

          const chunk = sheets[sheetIndexRef.current] ?? [];
          if (chunk.length === 0) return;
          const oriented = scanCanvas;
          if (!isCalifacilExamSheetLikely(oriented, omrCols)) {
            stopScanningHum();
            stablePartialTicksRef.current = 0;
            stableFullTicksRef.current = 0;
            lowVisibilityTicksRef.current += 1;
            const locksNoExam = liveLockedAnswersRef.current;
            const mergedNoExam: Record<string, string> = {};
            let resolvedNoExam = 0;
            for (const q of chunk) {
              const locked = locksNoExam[q.id]?.trim();
              mergedNoExam[q.id] = locked || '';
              if (locked) resolvedNoExam++;
            }
            setLiveDraftSelections(mergedNoExam);
            setLiveResolvedCount(resolvedNoExam);
            const nextStatus =
              'No se detecta la tabla. Encuadra la hoja carta completa (esquinas negras alineadas con la guía).';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }

            if (
              isMobile &&
              flashSupported &&
              !flashOn &&
              !autotorchTriedRef.current &&
              lowVisibilityTicksRef.current >= LOW_VISIBILITY_AUTOTORCH_TICKS
            ) {
              autotorchTriedRef.current = true;
              void setTorchEnabled(true);
              setLiveStatus(
                'Activé el flash automáticamente para mejorar detección. Mantén la hoja completa dentro del marco.'
              );
              if (!glareHintShownRef.current) {
                glareHintShownRef.current = true;
                toast.message('Si hay reflejo, inclina ligeramente el celular y evita brillo directo.');
              }
            }
            return;
          }
          lowVisibilityTicksRef.current = 0;
          const raw = scanCalifacilOmrSheet(oriented, omrCols, {
            skipGuideCrop: true,
            qnumSweep: 'live',
            columnShiftSweep: 'live',
            geometryMode: 'fullSheet',
            preserveInputCanvas: true,
          });
          const mapped = mapRawToDraft(raw, chunk);
          const locks = liveLockedAnswersRef.current;
          const mergedLive: Record<string, string> = {};
          let mergedResolved = 0;
          for (const q of chunk) {
            const locked = locks[q.id]?.trim();
            if (locked) {
              mergedLive[q.id] = locked;
              mergedResolved++;
            } else {
              const v = mapped.draft[q.id]?.trim() ?? '';
              mergedLive[q.id] = v;
              if (v) {
                locks[q.id] = v;
                mergedResolved++;
              }
            }
          }
          setLiveDraftSelections(mergedLive);
          setLiveResolvedCount(mergedResolved);

          if (chunk.length > 0) {
            if (isMobile) {
              stopScanningHum();
            } else if (mergedResolved >= chunk.length) {
              stopScanningHum();
              if (!liveCompleteSoundPlayedRef.current) {
                liveCompleteSoundPlayedRef.current = true;
                playScanCompleteChime();
              }
            } else if (mergedResolved > 0) {
              startScanningHum();
            } else {
              stopScanningHum();
            }
          } else {
            stopScanningHum();
          }

          const minResolved = Math.max(1, Math.ceil(chunk.length * MIN_AUTO_READ_RATIO));
          if (mergedResolved < Math.ceil(chunk.length * 0.35)) {
            lowVisibilityTicksRef.current += 1;
          } else {
            lowVisibilityTicksRef.current = 0;
          }

          if (
            isMobile &&
            flashSupported &&
            !flashOn &&
            !autotorchTriedRef.current &&
            lowVisibilityTicksRef.current >= LOW_VISIBILITY_AUTOTORCH_TICKS
          ) {
            autotorchTriedRef.current = true;
            void setTorchEnabled(true);
            setLiveStatus('Poca luz detectada: activé flash automáticamente.');
          }
          if (mergedResolved >= chunk.length && chunk.length > 0) {
            const nextStatus = isMobile
              ? 'Lectura estable: capturando en automático o pulsa «Tomar foto».'
              : 'Detección completa. Toca «Revisar y confirmar».';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (mergedResolved >= minResolved) {
            const nextStatus = isMobile
              ? 'Casi listo: mantén fijo el encuadre o usa «Tomar foto».'
              : 'Lecturas capturadas. Completa faltantes o pulsa «Revisar y confirmar».';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (mergedResolved >= Math.ceil(chunk.length * 0.3)) {
            const nextStatus = 'Casi listo: alinea mejor la hoja con el marco y aumenta la luz.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else {
            const nextStatus = 'Ajusta la cámara: toda la hoja dentro del marco; evita cortes y sombras.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          }

          if (mergedResolved >= minResolved && chunk.length > 0) {
            stablePartialTicksRef.current += 1;
          } else {
            stablePartialTicksRef.current = 0;
          }
          if (mergedResolved >= chunk.length && chunk.length > 0) {
            stableFullTicksRef.current += 1;
          } else {
            stableFullTicksRef.current = 0;
          }

          if (stablePartialTicksRef.current >= STABLE_PARTIAL_TICKS && chunk.length > 0) {
            stablePartialTicksRef.current = 0;
            setDraftSelections((prev) => {
              const next = { ...prev };
              for (const q of chunk) {
                const v = mergedLive[q.id]?.trim();
                if (v) next[q.id] = v;
              }
              return next;
            });
          }

          if (stableFullTicksRef.current >= STABLE_FULL_TICKS && chunk.length > 0) {
            stableFullTicksRef.current = 0;
            if (isMobile) {
              if (mobileCaptureBusyRef.current) {
                return;
              }
              mobileCaptureBusyRef.current = true;
              try {
                const videoCap = videoRef.current;
                if (!videoCap || videoCap.readyState < 2) return;
                const fw = videoCap.videoWidth;
                const fh = videoCap.videoHeight;
                const fullCanvas = document.createElement('canvas');
                fullCanvas.width = fw;
                fullCanvas.height = fh;
                const fctx = fullCanvas.getContext('2d', { willReadFrequently: true });
                if (!fctx) return;
                fctx.drawImage(videoCap, 0, 0, fw, fh);
                const result = await finalizeCapturedSheetRef.current(fullCanvas);
                if (result.success) {
                  playScanCompleteChime();
                }
              } finally {
                mobileCaptureBusyRef.current = false;
              }
            } else {
              await showAutoCaptureSnapshot(oriented);
              const nextStatus =
                'Hoja completa detectada. Toca «Revisar y confirmar» para validar respuestas antes de guardar.';
              if (nextStatus !== hotLoopStatus) {
                hotLoopStatus = nextStatus;
                setLiveStatus(nextStatus);
              }
            }
          }
        } finally {
          liveBusyRef.current = false;
        }
      }, liveScanIntervalMs);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'No se pudo abrir la cámara. Revisa permisos o usa "Subir foto".';
      toast.error('No se pudo abrir la cámara', {
        description: toSpanishAuthMessage(message),
      });
      setCameraOpen(false);
    } finally {
      startingCameraRef.current = false;
    }
  }, [
    attachStreamToVideo,
    cameraOpen,
    exam,
    examId,
    flashOn,
    flashSupported,
    isMobile,
    mapRawToDraft,
    omrCols,
    resetLiveReadings,
    setTorchEnabled,
    showAutoCaptureSnapshot,
    sheets,
    supportsCalifacil,
  ]);

  startLiveCameraRef.current = startLiveCamera;

  const confirmCurrentSheet = async (providedDraft?: Record<string, string>) => {
    if (!examId || !exam) {
      toast.error('Selecciona un examen antes de confirmar.');
      return;
    }
    const chunk = sheets[sheetIndex] ?? [];
    if (chunk.length === 0) {
      toast.error('No hay preguntas para esta hoja.');
      return;
    }
    const effectiveDraft = providedDraft ?? draftSelections;
    for (const q of chunk) {
      const v = effectiveDraft[q.id]?.trim() ?? '';
      if (!v) {
        toast.error(`Falta la respuesta de la pregunta ${questions.findIndex((x) => x.id === q.id) + 1}`);
        return;
      }
    }

    const mergedNow: Record<string, string> = { ...confirmedByQuestionId };
    for (const q of chunk) {
      mergedNow[q.id] = effectiveDraft[q.id]!;
    }
    setConfirmedByQuestionId(mergedNow);

    const isLast = sheetIndex >= totalSheets - 1;

    const pushMobileSheetSnapshot = async () => {
      if (!isMobile || !previewUrl || !reviewOmrGeometry) return;
      const cloned = await cloneObjectUrl(previewUrl);
      if (!cloned) return;
      const selections: Record<string, string> = {};
      for (const q of chunk) selections[q.id] = effectiveDraft[q.id]!.trim();
      let geom: CalifacilOmrScanGeometry;
      try {
        geom = structuredClone(reviewOmrGeometry);
      } catch {
        geom = JSON.parse(JSON.stringify(reviewOmrGeometry)) as CalifacilOmrScanGeometry;
      }
      setMobileSheetSnapshots((prev) => [
        ...prev,
        {
          sheetIndex,
          previewUrl: cloned,
          geometry: geom,
          questionIds: chunk.map((q) => q.id),
          selectionsByQuestionId: selections,
        },
      ]);
    };

    await pushMobileSheetSnapshot();

    if (!isLast) {
      setSheetIndex((s) => s + 1);
      setReviewOmrGeometry(null);
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setDraftSelections({});
      resetLiveReadings();
      setPhase(isMobile ? 'elegir' : 'capturar');
      toast.success(
        isMobile
          ? `Hoja ${sheetIndex + 1} guardada. Pulsa «Tomar foto» para la siguiente hoja.`
          : `Hoja ${sheetIndex + 1} guardada. Importa la foto de la siguiente hoja.`
      );
      return;
    }

    await submitAll(mergedNow);
  };

  const persistStudentAnswers = async (merged: Record<string, string>) => {
    const studentId = selectedStudentId;
    if (!studentId || !exam || !examId) {
      throw new Error('missing_context');
    }
    const effectiveKey = examVirtualKeyByQuestionId;
    const mcQuestions = questions.filter((q) => q.type === 'multiple_choice');
    const mcTotal = mcQuestions.length;
    if (Object.keys(effectiveKey).length !== mcTotal) {
      throw new Error('incomplete_key');
    }

    let correctCount = 0;
    const rows = questions.map((question: Question) => {
      const answerText = (merged[question.id] ?? '').trim();
      const expected = (effectiveKey[question.id] ?? '').trim();
      const gotIdx = resolveOptionIndexFromValue(question.options, answerText);
      const wantIdx = resolveOptionIndexFromValue(question.options, expected);
      const isCorrect =
        question.type === 'multiple_choice'
          ? gotIdx !== null && wantIdx !== null && gotIdx === wantIdx
          : null;
      if (isCorrect) correctCount++;

      return {
        exam_id: examId,
        student_id: studentId,
        question_id: question.id,
        answer_text: answerText,
        is_correct: isCorrect,
        score: isCorrect ? 1 : 0,
      };
    });

    const { error: answersError } = await supabase.from('answers').upsert(rows, {
      onConflict: 'exam_id,student_id,question_id',
    });
    if (answersError) throw answersError;

    const pct = calculatePercentage(correctCount, mcTotal);
    const wrong = Math.max(0, mcTotal - correctCount);
    return { pct, correct: correctCount, wrong, total: mcTotal };
  };

  const submitAll = async (merged: Record<string, string>) => {
    if (!exam || !examId) return;

    for (const q of questions) {
      if (!merged[q.id]?.trim()) {
        toast.error('Faltan respuestas por confirmar.');
        return;
      }
    }

    if (!selectedStudentId || !sortedStudents.some((s) => s.id === selectedStudentId)) {
      toast.error('Alumno no válido. Vuelve a seleccionar en la primera pantalla.');
      return;
    }
    if (!canGradeStudents) {
      toast.error('Calificación bloqueada: la clave automática del examen no está completa.');
      return;
    }

    setPhase('guardando');

    try {
      const stats = await persistStudentAnswers(merged);
      setAutoGradeStats(stats);
      if (isMobile) {
        setMobileResultsDraft({ ...merged });
      }
      setAutoGradeDialogOpen(true);
      toast.success('Calificación guardada.');

      stopLiveCamera();
      setPhase('elegir');
      setSheetIndex(0);
      setConfirmedByQuestionId({});
      confirmedAnswersRef.current = {};
      setDraftSelections({});
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      liveLockedAnswersRef.current = {};
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'incomplete_key') {
        toast.error('Clave automática incompleta. Revisa que cada reactivo tenga respuesta correcta válida.');
        setPhase('elegir');
        return;
      }
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : '';
      toast.error('No se pudo guardar', {
        description: msg ? toSpanishAuthMessage(msg) : 'Revisa tu conexión y permisos.',
      });
      setPhase('revisar_hoja');
    }
  };

  const saveMobileResultsEdits = async () => {
    if (!isMobile || phase !== 'ver_resultados') return;
    if (!exam || !examId) return;
    for (const q of questions) {
      if (!mobileResultsDraft[q.id]?.trim()) {
        toast.error(`Falta la respuesta de la pregunta ${questions.findIndex((x) => x.id === q.id) + 1}`);
        return;
      }
    }
    if (!selectedStudentId || !sortedStudents.some((s) => s.id === selectedStudentId)) {
      toast.error('Alumno no válido.');
      return;
    }
    if (!canGradeStudents) {
      toast.error('Calificación bloqueada.');
      return;
    }
    setScanBusy(true);
    await yieldForSpinnerPaint();
    try {
      await persistStudentAnswers(mobileResultsDraft);
      toast.success('Cambios guardados en la nube.');
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'incomplete_key') {
        toast.error('Clave automática incompleta.');
      } else {
        toast.error('No se pudo guardar', {
          description: 'Revisa tu conexión y permisos.',
        });
      }
    } finally {
      setScanBusy(false);
    }
  };

  const captureMobilePhotoManually = async () => {
    if (!isMobile || scanBusy || mobileCaptureBusyRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth < 40) {
      toast.error('La cámara no está lista.');
      return;
    }
    mobileCaptureBusyRef.current = true;
    setScanBusy(true);
    await yieldForSpinnerPaint();
    try {
      const fw = video.videoWidth;
      const fh = video.videoHeight;
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = fw;
      fullCanvas.height = fh;
      const fctx = fullCanvas.getContext('2d', { willReadFrequently: true });
      if (!fctx) return;
      fctx.drawImage(video, 0, 0, fw, fh);
      await finalizeCapturedSheet(fullCanvas);
    } finally {
      mobileCaptureBusyRef.current = false;
      setScanBusy(false);
    }
  };

  const switchToAnotherStudentScan = useCallback(() => {
    stopLiveCamera();
    clearMobileSnapshots();
    setMobileResultsDraft({});
    setResultsSheetIdx(0);
    setReviewQualityHint(null);
    setSelectedStudentId('');
    setPhase('elegir');
    setSheetIndex(0);
    setConfirmedByQuestionId({});
    confirmedAnswersRef.current = {};
    setDraftSelections({});
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    stablePartialTicksRef.current = 0;
    liveLockedAnswersRef.current = {};
    setReviewOmrGeometry(null);
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setLiveStatus(
      isMobile
        ? 'Elige examen y alumno; luego pulsa «Tomar foto» para cada hoja.'
        : 'Sube una imagen escaneada para leer respuestas.'
    );
    toast.message('Elige otro alumno para escanear su examen.');
  }, [isMobile, stopLiveCamera, clearMobileSnapshots]);

  const exitMobileResultsView = useCallback(() => {
    clearMobileSnapshots();
    setMobileResultsDraft({});
    setResultsSheetIdx(0);
    setPhase('elegir');
  }, [clearMobileSnapshots]);

  const scanAgainInLive = () => {
    const chunk = sheets[sheetIndex] ?? [];
    setDraftSelections((prev) => {
      const next = { ...prev };
      for (const q of chunk) delete next[q.id];
      return next;
    });
    resetLiveReadings();
  };

  if (!user) return null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-3 pb-6 sm:gap-4 sm:pb-8">
      <Dialog open={autoGradeDialogOpen} onOpenChange={setAutoGradeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Calificación guardada</DialogTitle>
            <DialogDescription>
              Resultados para {selectedStudentName.trim() || 'el alumno seleccionado'}.
            </DialogDescription>
          </DialogHeader>
          {autoGradeStats && (
            <div className="space-y-3 py-2">
              <div className={`text-center text-4xl font-bold ${getGradeColor(autoGradeStats.pct)}`}>
                {autoGradeStats.pct}%
              </div>
              <p className="text-center text-sm text-gray-600">{getGradeLabel(autoGradeStats.pct)}</p>
              <p className="text-center text-sm font-semibold text-gray-800">
                {autoGradeStats.correct}/{autoGradeStats.total} aciertos · {autoGradeStats.pct}%
              </p>
              <div className="grid grid-cols-2 gap-3 text-center text-sm">
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <div className="text-xs text-green-800">Correctas</div>
                  <div className="text-xl font-semibold text-green-900">{autoGradeStats.correct}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <div className="text-xs text-red-800">Incorrectas</div>
                  <div className="text-xl font-semibold text-red-900">{autoGradeStats.wrong}</div>
                </div>
              </div>
              <p className="text-center text-xs text-gray-500">Total de preguntas: {autoGradeStats.total}</p>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {isMobile ? (
              <>
                <Button
                  type="button"
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    setResultsSheetIdx(0);
                    setPhase('ver_resultados');
                  }}
                >
                  Ver resultados
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    switchToAnotherStudentScan();
                  }}
                >
                  Calificar otro alumno
                </Button>
                {examId ? (
                  <Button type="button" variant="outline" className="w-full" asChild>
                    <Link href={`/exams/results/${examId}`}>
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      Ver en panel de resultados
                    </Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-gray-600"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    router.push('/dashboard');
                  }}
                >
                  Ir al inicio del dashboard
                </Button>
              </>
            ) : (
              <>
                {examId ? (
                  <Button type="button" variant="outline" className="w-full" asChild>
                    <Link href={`/exams/results/${examId}`}>
                      <LayoutDashboard className="mr-2 h-4 w-4" />
                      Ver en panel de resultados
                    </Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  onClick={() => {
                    setSelectedStudentId('');
                    setAutoGradeDialogOpen(false);
                  }}
                >
                  Elegir otro alumno
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setAutoGradeDialogOpen(false)}
                >
                  Cerrar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-gray-600"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    router.push('/dashboard');
                  }}
                >
                  Ir al inicio del dashboard
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Calificar</h1>
        <p className="mt-0.5 text-xs text-gray-600 sm:mt-1 sm:text-sm">
          {isMobile
            ? 'Cámara a pantalla completa: alinea los cuadros negros de las esquinas del papel con el marco; la foto puede tomarse sola cuando la lectura es estable, o pulsa «Tomar foto».'
            : 'En ordenador sube exámenes escaneados (JPG/PNG) para leer la tabla CaliFacil y calificar automáticamente.'}
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-1 pb-2 sm:pb-3">
          <CardTitle className="text-base sm:text-lg">Examen y clave automática</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4">
          <div className="space-y-2">
            <Label>Examen</Label>
            <Select
              value={examId ? examId : SELECT_NO_EXAM}
              onValueChange={(v) => {
                if (v === SELECT_NO_EXAM) return;
                setExamId(v);
                resetFlow();
              }}
              disabled={examsLoading || phase === 'guardando' || (isMobile && phase === 'ver_resultados')}
            >
              <SelectTrigger>
                <SelectValue placeholder={examsLoading ? 'Cargando…' : 'Elige un examen'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SELECT_NO_EXAM}>Elige un examen publicado</SelectItem>
                {publishedExams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {examId && examLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando preguntas…
            </div>
          )}

          {exam && !examLoading && !supportsCalifacil && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="h-5 w-5 shrink-0" />
              Este examen no puede usarse aquí: todas las preguntas deben ser opción múltiple con 2 a
              5 opciones.
            </div>
          )}

          {exam && supportsCalifacil && questions.length > maxQuestions && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertCircle className="h-5 w-5 shrink-0" />
              Este examen tiene más de {maxQuestions} preguntas. Reduce el examen para usar Calificar.
            </div>
          )}

          {exam && supportsCalifacil && virtualKey.issues.length > 0 && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertCircle className="h-5 w-5 shrink-0" />
              {virtualKey.issues[0]}
            </div>
          )}

          {!examId && (
            <p className="text-xs text-gray-500">
              Selecciona un examen para habilitar las opciones de captura y calificación.
            </p>
          )}

          {examId && (
            <>
              {exam && supportsCalifacil && (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    canGradeStudents
                      ? 'border-green-200 bg-green-50 text-green-900'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  {canGradeStudents ? (
                    <>Clave automática activa: {virtualKeyReadyCount}/{virtualKeyMcTotal} reactivos listos.</>
                  ) : (
                    <>
                      La clave automática del examen está incompleta. Revisa las preguntas para que cada reactivo
                      tenga una respuesta correcta válida dentro de sus opciones.
                    </>
                  )}
                </div>
              )}

              {exam && supportsCalifacil && canGradeStudents && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-orange-300 text-orange-900 hover:bg-orange-50"
                    onClick={() => setVirtualKeyTableDialogOpen(true)}
                  >
                    Ver tabla clave
                  </Button>
                </div>
              )}

              <Dialog open={virtualKeyTableDialogOpen} onOpenChange={setVirtualKeyTableDialogOpen}>
                <DialogContent className="max-h-[min(90vh,720px)] max-w-lg gap-0 overflow-y-auto p-4 sm:p-6">
                  <DialogHeader>
                    <DialogTitle>Tabla clave automática</DialogTitle>
                    <DialogDescription className="sr-only">
                      Respuestas correctas del examen por hoja, tal como se comparan al calificar.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 space-y-3">
                    {sheets.map((chunk, chunkIdx) => (
                      <div key={`key-sheet-dlg-${chunkIdx}`} className="rounded-md border border-orange-200 bg-orange-50/30 p-2">
                        <p className="mb-2 text-xs font-medium text-gray-700">
                          Hoja {chunkIdx + 1} ({chunk.length} reactivos)
                        </p>
                        <div className="w-full">
                          <table className="w-full table-fixed border-collapse text-[10px] sm:text-xs">
                            <thead>
                              <tr>
                                <th className="w-8 border border-gray-300 bg-gray-100 px-1 py-1 text-right sm:w-12 sm:px-2">
                                  N.º
                                </th>
                                {Array.from({ length: omrCols }, (_, c) => (
                                  <th
                                    key={`dlg-head-${chunkIdx}-${c}`}
                                    className="border border-gray-300 bg-gray-100 px-1 py-1 text-center sm:px-2"
                                  >
                                    {String.fromCharCode(65 + c)}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {chunk.map((q, rowIdx) => {
                                const expectedIndex = virtualKeyCorrectIndexByQuestionId[q.id] ?? -1;
                                const qNum = chunkIdx * 10 + rowIdx + 1;
                                return (
                                  <tr key={`dlg-${q.id}`}>
                                    <td className="border border-gray-300 bg-gray-50 px-1 py-1 text-right font-semibold sm:px-2">
                                      {qNum}
                                    </td>
                                    {Array.from({ length: omrCols }, (_, c) => (
                                      <td
                                        key={`dlg-${q.id}-${c}`}
                                        className="border border-gray-300 px-1 py-1 text-center sm:px-2"
                                      >
                                        <span
                                          className={`inline-block h-3 w-3 rounded-[2px] border sm:h-4 sm:w-4 ${
                                            c === expectedIndex
                                              ? 'border-orange-600 bg-orange-500'
                                              : 'border-gray-500 bg-white'
                                          }`}
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>

              <div className="space-y-2">
                <Label htmlFor="calif-alumno">Alumno</Label>
                <StudentCombobox
                  id="calif-alumno"
                  students={sortedStudents}
                  value={selectedStudentId}
                  onValueChange={handleStudentChange}
                  disabled={
                    phase === 'guardando' || (isMobile && phase === 'ver_resultados') || !canGradeStudents
                  }
                  placeholder="Busca y elige al alumno"
                  searchPlaceholder="Escribe para buscar…"
                  emptyText="Ningún alumno coincide."
                  noStudentsText={
                    exam && allowedGroupIds.length === 0
                      ? 'Este examen no tiene grupo asignado. Asigna un grupo al examen y registra alumnos en Grupos.'
                      : undefined
                  }
                />
                <p className="text-xs text-gray-500">
                  {canGradeStudents
                    ? 'La comparación se hace automáticamente contra la tabla clave generada por el sistema.'
                    : 'Bloqueado: el examen necesita respuestas correctas válidas para generar la clave automática.'}
                </p>
              </div>

              {isMobile && canGradeStudents && selectedStudentId && phase === 'elegir' && (
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/90 p-3">
                  <p className="text-sm font-medium text-orange-950">
                    Listo para hoja {sheetIndex + 1} de {totalSheets}
                  </p>
                  <p className="text-xs text-orange-900/90">
                    Se abrirá la cámara a pantalla completa. Fotografía la hoja impresa completa (carta): encuadra con
                    el marco las esquinas negras de referencia impresas.
                  </p>
                  <Button
                    type="button"
                    className="w-full bg-orange-600 hover:bg-orange-700"
                    disabled={scanBusy}
                    onClick={() => {
                      setPhase('capturar');
                      void startLiveCamera();
                    }}
                  >
                    Tomar foto
                  </Button>
                </div>
              )}
            </>
          )}

        </CardContent>
      </Card>

      {useLiveCameraUi && phase === 'capturar' && exam && (
        <div
          ref={mobileCameraShellRef}
          className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-white/15 px-3 py-2">
            <div className="min-w-0 pr-2">
              <p className="truncate text-sm font-semibold">
                Hoja {sheetIndex + 1} de {totalSheets}
              </p>
              <p className="text-[11px] text-white/70">
                Preguntas {sheetIndex * 10 + 1}–{sheetIndex * 10 + currentChunk.length} · Encuadra la hoja carta
                completa
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-white hover:bg-white/10 hover:text-white"
              disabled={scanBusy}
              onClick={() => {
                stopLiveCamera();
                setPhase('elegir');
              }}
            >
              Volver
            </Button>
          </div>

          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleGalleryFile}
          />

          <div className="relative min-h-0 flex-1 bg-black">
            {!cameraOpen ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
                <div className="flex items-center gap-2 text-sm text-orange-100">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Abriendo cámara en vivo…
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full max-w-xs"
                  onClick={() => void startLiveCamera()}
                >
                  Reintentar cámara
                </Button>
              </div>
            ) : (
              <>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 h-full w-full bg-black object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-black/25" />
                <div
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${CALIFACIL_VIEWFINDER_GUIDE.centerXFrac * 100}%`,
                    top: `${CALIFACIL_VIEWFINDER_GUIDE.centerYFrac * 100}%`,
                    width: `${CALIFACIL_VIEWFINDER_GUIDE.widthFrac * 100}%`,
                    aspectRatio: `${CALIFACIL_VIEWFINDER_GUIDE.aspectRatio} / 1`,
                  }}
                >
                  <div className="absolute inset-0 rounded-md border-2 border-white/35 shadow-[0_0_0_200vmax_rgba(0,0,0,0.35)]" />
                  <span className="absolute -left-1 -top-1 block h-4 w-4 rounded-tl-md bg-white/35 blur-[3px]" />
                  <span className="absolute -right-1 -top-1 block h-4 w-4 rounded-tr-md bg-white/35 blur-[3px]" />
                  <span className="absolute -bottom-1 -left-1 block h-4 w-4 rounded-bl-md bg-white/35 blur-[3px]" />
                  <span className="absolute -bottom-1 -right-1 block h-4 w-4 rounded-br-md bg-white/35 blur-[3px]" />
                </div>
              </>
            )}
          </div>

          <div className="shrink-0 space-y-2 border-t border-white/15 bg-black/90 px-3 py-3">
            <div className="rounded-md border border-orange-400/35 bg-orange-950/50 px-2.5 py-2 text-xs leading-snug text-orange-50">
              {liveStatus}
            </div>
            {flashSupported && (
              <Button
                type="button"
                variant="secondary"
                className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={() => void setTorchEnabled(!flashOn)}
              >
                <Zap className="mr-2 h-4 w-4" />
                {flashOn ? 'Apagar flash' : 'Encender flash'}
              </Button>
            )}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                className={cn(
                  'w-full bg-orange-600 hover:bg-orange-700',
                  scanBusy && 'disabled:opacity-100'
                )}
                disabled={scanBusy}
                onClick={() => void captureMobilePhotoManually()}
              >
                {scanBusy ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none [animation-duration:750ms]"
                    aria-hidden
                  />
                ) : (
                  'Tomar foto'
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={() => galleryInputRef.current?.click()}
                disabled={scanBusy}
              >
                Subir foto…
              </Button>
              <Button
                variant="secondary"
                className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={scanAgainInLive}
              >
                Reiniciar lectura en vivo
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20"
                disabled={scanBusy}
                onClick={() => {
                  stopLiveCamera();
                  setPhase('elegir');
                }}
              >
                Cerrar cámara
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full border-white/30 text-white hover:bg-white/10"
                onClick={switchToAnotherStudentScan}
                disabled={scanBusy}
              >
                Escanear examen de otro alumno
              </Button>
            </div>
          </div>
        </div>
      )}

      {((phase === 'revisar_hoja') || (phase === 'capturar' && !useLiveCameraUi)) && exam && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Hoja de alumno {sheetIndex + 1} de {totalSheets}
            </CardTitle>
            <CardDescription>
              Preguntas {sheetIndex * 10 + 1}–{sheetIndex * 10 + currentChunk.length} ·{' '}
              {isMobile
                ? 'Fotografía la hoja carta completa (encuadrada con las esquinas negras de referencia en el papel).'
                : 'Puedes pasar foto de la hoja completa o solo del pie: debe verse entera la tabla (N.º, A–D) y las marcas.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {phase === 'capturar' && (
              <div className="space-y-3">
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleGalleryFile}
                />
                <div className="space-y-3">
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/90 p-6 text-center">
                    <p className="text-sm text-gray-700">
                      En ordenador sube una foto de la <strong>hoja impresa completa</strong> (como la que genera
                      CaliFácil con preguntas y tabla al pie) o recorta solo el recuadro CaliFacil. Se leen las
                      casillas A–D y al guardar se califica comparando con la clave del examen.
                    </p>
                    <Button
                      type="button"
                      className={cn(
                        'mt-4 bg-orange-600 hover:bg-orange-700',
                        scanBusy && 'disabled:opacity-100'
                      )}
                      disabled={scanBusy}
                      onClick={() => galleryInputRef.current?.click()}
                    >
                      {scanBusy ? (
                        <>
                          <Loader2
                            className="mr-2 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none [animation-duration:750ms]"
                            aria-hidden
                          />
                          Leyendo imagen…
                        </>
                      ) : (
                        'Elegir imagen…'
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {previewUrl && phase === 'revisar_hoja' && (
              <div className="space-y-2">
                <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
                  <div className="relative inline-block max-h-96 max-w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Vista previa del recuadro CaliFacil"
                      className="relative z-0 block max-h-96 w-auto max-w-full"
                    />
                    {reviewOrangeFrameRect ? (
                      <div
                        className="pointer-events-none absolute rounded-lg border-[2.5px] border-orange-400/95"
                        style={{
                          left: `${reviewOrangeFrameRect.x * 100}%`,
                          top: `${reviewOrangeFrameRect.y * 100}%`,
                          width: `${reviewOrangeFrameRect.w * 100}%`,
                          height: `${reviewOrangeFrameRect.h * 100}%`,
                        }}
                        aria-hidden
                      />
                    ) : null}
                    {reviewOmrGeometry ? (
                      <CalifacilOmrReviewOverlay
                        geometry={reviewOmrGeometry}
                        picks={draftSelectionsToColumnPicks(currentChunk, draftSelections)}
                        expectedPicks={expectedChunkPicks}
                        expectedOpacity={overlayOpacity / 100}
                        rowCount={currentChunk.length}
                        clipRect={null}
                      />
                    ) : null}
                  </div>
                </div>
                {canGradeStudents && currentChunk.length > 0 ? (
                  <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/95 px-3 py-2 text-center">
                    <div className="text-sm font-semibold text-emerald-950">
                      <span className="tabular-nums">{chunkKeyComparison.correct}</span>
                      <span className="text-emerald-800"> / </span>
                      <span className="tabular-nums">{chunkKeyComparison.total}</span>
                      <span className="mx-1.5 text-emerald-700">·</span>
                      <span className={`tabular-nums ${getGradeColor(chunkKeyComparison.pct)}`}>
                        {chunkKeyComparison.pct}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-emerald-900/85">
                      Coincidencias con la clave del examen en esta hoja. En la foto:{' '}
                      <span className="font-medium text-green-700">verde</span> = acierto,{' '}
                      <span className="font-medium text-red-600">rojo</span> = opción leída incorrecta,{' '}
                      <span className="font-medium text-orange-700">naranja</span> = respuesta correcta esperada,
                      azul = casillas vacías detectadas.
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {phase === 'revisar_hoja' && (
              <div className="space-y-3">
                {reviewQualityHint ? (
                  <Alert variant="default" className="border-amber-300 bg-amber-50 text-amber-950">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle className="text-sm">Calidad de lectura</AlertTitle>
                    <AlertDescription className="text-sm">{reviewQualityHint}</AlertDescription>
                  </Alert>
                ) : null}
                {currentChunk.map((q, idx) => {
                  const globalNum = sheetIndex * 10 + idx + 1;
                  const opts = q.options ?? [];
                  const val = draftSelections[q.id]?.trim() ?? '';
                  return (
                    <div key={q.id} className="flex flex-col gap-1">
                      <Label className="text-xs text-gray-600">Pregunta {globalNum}</Label>
                      <Select
                        value={val ? val : SELECT_NO_OPTION}
                        onValueChange={(v) => {
                          setDraftSelections((prev) => ({
                            ...prev,
                            [q.id]: v === SELECT_NO_OPTION ? '' : v,
                          }));
                        }}
                      >
                        <SelectTrigger className="w-full max-w-md">
                          <SelectValue placeholder="Elegir opción leída" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SELECT_NO_OPTION}>Elegir opción leída</SelectItem>
                          {opts.map((opt, oi) => (
                            <SelectItem key={opt} value={opt}>
                              {String.fromCharCode(65 + oi)}. {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}

                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      if (isMobile) {
                        stopLiveCamera();
                        setPhase('elegir');
                      } else {
                        setPhase('capturar');
                      }
                      setReviewOmrGeometry(null);
                      setPreviewUrl((u) => {
                        if (u) URL.revokeObjectURL(u);
                        return null;
                      });
                      setDraftSelections({});
                      resetLiveReadings();
                    }}
                  >
                    {useLiveCameraUi ? 'Escanear otra vez' : 'Importar otra imagen'}
                  </Button>
                  <Button
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                    disabled={scanBusy}
                    onClick={() => void confirmCurrentSheet()}
                  >
                    Guardar calificación
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isMobile && phase === 'ver_resultados' && exam && mobileSheetSnapshots.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Resultados guardados</CardTitle>
            <CardDescription>
              {selectedStudentName.trim() || 'Alumno'} · Revisa cada hoja; puedes corregir y volver a guardar en la
              nube.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs
              value={String(resultsSheetIdx)}
              onValueChange={(v) => {
                const n = Number(v);
                setResultsSheetIdx(Number.isFinite(n) ? n : 0);
              }}
            >
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
                {mobileSheetSnapshots.map((snap, i) => (
                  <TabsTrigger key={`rs-tab-${snap.sheetIndex}-${i}`} value={String(i)} className="text-xs">
                    Hoja {snap.sheetIndex + 1}
                  </TabsTrigger>
                ))}
              </TabsList>
              {mobileSheetSnapshots.map((snap, tabIdx) => {
                const chunk = sheets[snap.sheetIndex] ?? [];
                const orangeFrameRect = califacilReviewOrangeFrameRect(snap.geometry, chunk.length);
                let rCorrect = 0;
                for (const q of chunk) {
                  const draftText = mobileResultsDraft[q.id]?.trim() ?? '';
                  const expectedText = examVirtualKeyByQuestionId[q.id]?.trim() ?? '';
                  if (!expectedText) continue;
                  const pi = resolveOptionIndexFromValue(q.options ?? [], draftText);
                  const ei = resolveOptionIndexFromValue(q.options ?? [], expectedText);
                  if (pi !== null && ei !== null && pi === ei) rCorrect++;
                }
                const rTotal = chunk.length;
                const rPct = rTotal > 0 ? calculatePercentage(rCorrect, rTotal) : 0;
                const tabExpectedPicks = draftSelectionsToColumnPicks(chunk, examVirtualKeyByQuestionId);
                const tabPicks = draftSelectionsToColumnPicks(chunk, mobileResultsDraft);
                return (
                  <TabsContent key={`rs-content-${tabIdx}`} value={String(tabIdx)} className="mt-4 space-y-4">
                    <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
                      <div className="relative inline-block max-h-96 max-w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={snap.previewUrl}
                          alt={`Hoja ${snap.sheetIndex + 1}`}
                          className="relative z-0 block max-h-96 w-auto max-w-full"
                        />
                        {orangeFrameRect ? (
                          <div
                            className="pointer-events-none absolute rounded-lg border-[2.5px] border-orange-400/95"
                            style={{
                              left: `${orangeFrameRect.x * 100}%`,
                              top: `${orangeFrameRect.y * 100}%`,
                              width: `${orangeFrameRect.w * 100}%`,
                              height: `${orangeFrameRect.h * 100}%`,
                            }}
                            aria-hidden
                          />
                        ) : null}
                        <CalifacilOmrReviewOverlay
                          geometry={snap.geometry}
                          picks={tabPicks}
                          expectedPicks={tabExpectedPicks}
                          expectedOpacity={overlayOpacity / 100}
                          rowCount={chunk.length}
                          clipRect={null}
                        />
                      </div>
                    </div>
                    {canGradeStudents && chunk.length > 0 ? (
                      <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/95 px-3 py-2 text-center">
                        <div className="text-sm font-semibold text-emerald-950">
                          <span className="tabular-nums">{rCorrect}</span>
                          <span className="text-emerald-800"> / </span>
                          <span className="tabular-nums">{rTotal}</span>
                          <span className="mx-1.5 text-emerald-700">·</span>
                          <span className={`tabular-nums ${getGradeColor(rPct)}`}>{rPct}%</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-emerald-900/85">
                          Verde = acierto, rojo = opción leída incorrecta, naranja = respuesta correcta esperada.
                        </p>
                      </div>
                    ) : null}
                    {chunk.map((q, idx) => {
                      const globalNum = snap.sheetIndex * 10 + idx + 1;
                      const opts = q.options ?? [];
                      const val = mobileResultsDraft[q.id]?.trim() ?? '';
                      return (
                        <div key={`${tabIdx}-${q.id}`} className="flex flex-col gap-1">
                          <Label className="text-xs text-gray-600">Pregunta {globalNum}</Label>
                          <Select
                            value={val ? val : SELECT_NO_OPTION}
                            onValueChange={(v) => {
                              setMobileResultsDraft((prev) => ({
                                ...prev,
                                [q.id]: v === SELECT_NO_OPTION ? '' : v,
                              }));
                            }}
                          >
                            <SelectTrigger className="w-full max-w-md">
                              <SelectValue placeholder="Elegir opción leída" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SELECT_NO_OPTION}>Elegir opción leída</SelectItem>
                              {opts.map((opt, oi) => (
                                <SelectItem key={opt} value={opt}>
                                  {String.fromCharCode(65 + oi)}. {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </TabsContent>
                );
              })}
            </Tabs>
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button
                type="button"
                className="flex-1 bg-orange-600 hover:bg-orange-700"
                disabled={scanBusy}
                onClick={() => void saveMobileResultsEdits()}
              >
                Guardar cambios
              </Button>
              <Button type="button" variant="outline" className="flex-1" onClick={exitMobileResultsView}>
                Listo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {phase === 'guardando' && (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <Loader2 className="h-10 w-10 animate-spin text-orange-600" />
          <p className="text-sm text-gray-600">Guardando en resultados…</p>
        </div>
      )}
    </div>
  );
}
