'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Info, LayoutDashboard, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useExam, useExams } from '@/hooks/useExams';
import { supabase } from '@/lib/supabase';
import {
  buildCalifacilVirtualKey,
  buildCalifacilAnswerSheetOmrTemplate,
  califacilOmrColumnCount,
  examSupportsCalifacilOmr,
} from '@/lib/printExam';
import {
  autoOrientCalifacilSheet,
  califacilGeometryTableBounds,
  califacilImageToJpegDataUrl,
  califacilViewfinderGuideInViewportPx,
  califacilViewfinderNormRect,
  captureVideoFullFrame,
  detectAnswerSheetFiducialsInRoi,
  estimateCanvasShadowAsymmetry,
  captureVideoGuideRoiFrame,
  detectLargestQuadInRoiCanvas,
  estimateCanvasMeanLuminance,
  fileToImage,
  getObjectContainVideoLayout,
  isCalifacilExamSheetLikely,
  isCalifacilExamSheetStrict,
  isValidMobileRoiQuad,
  mapRoiQuadToFrame,
  mapRoiQuadCornersToViewportPx,
  measureRoiSheetFillRatio,
  measureWarpedFiducialAlignment,
  MAX_WARP_ALIGNMENT_ERROR_PX,
  MOBILE_MIN_FIDUCIAL_CORNERS,
  MOBILE_MIN_ROI_FILL_RATIO,
  mobileRoiQuadsAreStable,
  MOBILE_ROI_DETECT_MAX_SIDE,
  type MobileGuideRoiCapture,
  prepareAnswerSheetDisplayCanvas,
  prepareCalifacilScanInput,
  probeCalifacilSheetQuality,
  scaleQuadToCanvas,
  scanCalifacilOmrSheetWithMeta,
  warpAndValidateCalifacilSheet,
  warpCalifacilSheetFromCornerMarkers,
  type WarpAlignmentReport,
  type CalifacilOmrScanGeometry,
  type CalifacilSheetQualityProbe,
} from '@/lib/omrScan';
import {
  CalifacilLiveScanOverlay,
  type LiveVideoLetterbox,
} from '@/components/califacil-live-scan-overlay';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';
import {
  CalifacilOmrDebugOverlay,
  formatWarpAlignmentSummary,
} from '@/components/califacil-omr-debug-overlay';
import { MobileScanViewfinderOverlay } from '@/components/mobile-scan-viewfinder-overlay';
import type { MobileSheetCornerGuidePx } from '@/components/mobile-scan-viewfinder-overlay';
import {
  type ExamFullscreenMode,
  EXAM_PSEUDO_FULLSCREEN_CLASS,
  enterExamFullscreen,
  exitExamFullscreenSafe,
} from '@/lib/examFullscreen';
import {
  calculatePercentage,
  questionPoints,
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
  /** Hoja de respuestas enderezada por fiduciales (plantilla calibrada). */
  answerSheetLayout?: boolean;
  /** Métricas de alineación homografía (depuración / validación). */
  warpAlignment?: WarpAlignmentReport | null;
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
const STABLE_FULL_TICKS = 3;
/** Lecturas idénticas consecutivas para fijar una respuesta en el loop en vivo. */
const CONSENSUS_LOCK_TICKS = 4;
/** Mínimo de filas leídas (ratio) para auto-captura móvil. */
const MOBILE_AUTO_CAPTURE_MIN_RATIO = 0.9;
/** Si más filas ambiguas que esto, aviso explícito en revisión. */
const AMBIGUOUS_ROW_WARN_RATIO = 0.35;
/** Resolución máxima usada para escaneo en vivo móvil (menos píxeles = UI más fluida). */
const MOBILE_SCAN_MAX_WIDTH = 1080;
/** Resolución máxima al capturar foto final en móvil. */
const MOBILE_CAPTURE_MAX_SIDE = 2400;
/** Tras varios ticks sin detección, intentamos flash en móvil si está disponible. */
const LOW_VISIBILITY_AUTOTORCH_TICKS = 3;
/** Asimetría de luminancia izq/der que sugiere sombra fuerte en la hoja. */
const SHADOW_ASYMMETRY_TORCH = 0.14;
/** Ticks con sombra antes de activar flash automático. */
const SHADOW_AUTOTORCH_TICKS = 2;
/** Ticks consecutivos en validación estricta antes de mostrar burbujas en vivo. */
const LIVE_STRICT_OVERLAY_TICKS = 2;
/** Fotogramas consecutivos con cuadrilátero estable en ROI antes de captura automática móvil. */
const CORNER_ALIGN_STABLE_TICKS = 2;
/** Intervalo del loop de detección de esquinas en móvil (ms). */
const MOBILE_CORNER_LOOP_MS = 75;
/** Tolerancia extra al capturar manualmente o con fallback de esquinas. */
const MOBILE_WARP_FALLBACK_MAX_ERROR_PX = 14;
/** Luminancia mínima del fotograma; por debajo se considera cámara negra. */
const MIN_FRAME_LUMINANCE = 0.07;
/** Superpone plantilla PDF y error fiducial en px (`.env`: `NEXT_PUBLIC_CALIFACIL_OMR_DEBUG=true`). */
const OMR_DEBUG_ENABLED = process.env.NEXT_PUBLIC_CALIFACIL_OMR_DEBUG === 'true';
/** Etiquetas de cámaras virtuales comunes que no queremos priorizar en escritorio. */
const VIRTUAL_CAMERA_RE = /(droidcam|airdroid|iriun|epoccam|obs|virtual|ndi)/i;

/** Valores centinela para que Radix Select sea siempre controlado (evita uncontrolled→controlled). */
const SELECT_NO_EXAM = '__califacil_no_exam__';
const SELECT_NO_OPTION = '__califacil_no_option__';

type McGradeStats = { pct: number; correct: number; wrong: number; total: number };

type RoiQuad = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
];

/** Detección en ROI baja resolución → warp/OMR en fotograma completo alta resolución. */
function warpHighResFromRoiDetection(
  fullCanvas: HTMLCanvasElement,
  roiQuad: RoiQuad,
  roiCapture: MobileGuideRoiCapture
) {
  const roiW = roiCapture.roiCanvas.width;
  const roiH = roiCapture.roiCanvas.height;
  const frameQuad = mapRoiQuadToFrame(roiQuad, roiCapture.roiRect, roiW, roiH);
  const scaledQuad = scaleQuadToCanvas(
    frameQuad,
    roiCapture.frameW,
    roiCapture.frameH,
    fullCanvas.width,
    fullCanvas.height
  );
  return warpAndValidateCalifacilSheet(fullCanvas, scaledQuad, MAX_WARP_ALIGNMENT_ERROR_PX);
}

function warpMobileCaptureWithFallback(
  fullCanvas: HTMLCanvasElement,
  roiQuad: RoiQuad,
  roiCapture: MobileGuideRoiCapture
): { warped: HTMLCanvasElement | null; alignment: WarpAlignmentReport | null } {
  const primary = warpHighResFromRoiDetection(fullCanvas, roiQuad, roiCapture);
  if (primary.warped && primary.alignment?.ok) return primary;

  const warped = warpCalifacilSheetFromCornerMarkers(fullCanvas);
  if (!warped) return primary;

  const alignment = measureWarpedFiducialAlignment(warped, MOBILE_WARP_FALLBACK_MAX_ERROR_PX);
  if (alignment.ok) return { warped, alignment };
  return { warped: primary.warped ?? warped, alignment: primary.alignment ?? alignment };
}

/** Califica un borrador OMR: casilla vacía o sin lectura = respuesta incorrecta. */
function gradeMcDraftAgainstKey(
  draft: Record<string, string>,
  questions: Question[],
  virtualKey: Record<string, string>
): McGradeStats {
  const mcQuestions = questions.filter((q) => q.type === 'multiple_choice');
  let correctCount = 0;
  let earnedPoints = 0;
  let maxMcPoints = 0;
  let gradedTotal = 0;

  for (const q of mcQuestions) {
    const expected = (virtualKey[q.id] ?? '').trim();
    if (!expected) continue;
    gradedTotal++;
    const pts = questionPoints(q);
    maxMcPoints += pts;
    const answerText = (draft[q.id] ?? '').trim();
    const gotIdx = resolveOptionIndexFromValue(q.options, answerText);
    const wantIdx = resolveOptionIndexFromValue(q.options, expected);
    const isCorrect = gotIdx !== null && wantIdx !== null && gotIdx === wantIdx;
    if (isCorrect) {
      correctCount++;
      earnedPoints += pts;
    }
  }

  const total = gradedTotal;
  const wrong = Math.max(0, total - correctCount);
  const pct = maxMcPoints > 0 ? calculatePercentage(earnedPoints, maxMcPoints) : 0;
  return { pct, correct: correctCount, wrong, total };
}

function buildMcDraftFromChunk(
  chunk: Question[],
  source: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of chunk) {
    if (q.type !== 'multiple_choice') continue;
    out[q.id] = source[q.id]?.trim() ?? '';
  }
  return out;
}

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
  const out: (number | null)[] = Array(chunk.length).fill(null);
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
function isLetterPageGeometry(geometry: CalifacilOmrScanGeometry): boolean {
  const aspect = geometry.imageWidth / Math.max(1, geometry.imageHeight);
  return aspect > 0.72 && aspect < 0.84;
}

function califacilReviewOrangeFrameRect(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number,
  answerSheetLayout = false
): { x: number; y: number; w: number; h: number } | null {
  const useTemplate = answerSheetLayout || isLetterPageGeometry(geometry);
  const cellBounds = califacilGeometryTableBounds(geometry, rowCount);
  if (useTemplate) {
    const t = buildCalifacilAnswerSheetOmrTemplate(rowCount);
    return {
      x: t.tableLeftRatio,
      y: t.tableTopRatio,
      w: t.tableWidthRatio,
      h: t.tableHeightRatio,
    };
  }
  return cellBounds ?? califacilViewfinderNormRect(geometry.imageWidth, geometry.imageHeight);
}

/** Imagen + overlay: mismo aspecto que `geometry` para que el SVG no se estire respecto al JPEG. */
function CalifacilReviewImageStack({
  previewUrl,
  alt,
  geometry,
  orangeFrameRect,
  overlay,
}: {
  previewUrl: string;
  alt: string;
  geometry: CalifacilOmrScanGeometry;
  orangeFrameRect: { x: number; y: number; w: number; h: number } | null;
  overlay: ReactNode;
}) {
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  return (
    <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
      <div
        className="relative overflow-hidden rounded-md bg-neutral-200/50"
        style={{
          width: `min(100%, calc(24rem * ${W} / ${H}))`,
          aspectRatio: `${W} / ${H}`,
          maxHeight: '24rem',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt={alt}
          className="absolute inset-0 z-0 h-full w-full object-contain object-center"
        />
        {orangeFrameRect ? (
          <div
            className="pointer-events-none absolute z-[1] rounded-lg border-[2.5px] border-orange-400/95"
            style={{
              left: `${orangeFrameRect.x * 100}%`,
              top: `${orangeFrameRect.y * 100}%`,
              width: `${orangeFrameRect.w * 100}%`,
              height: `${orangeFrameRect.h * 100}%`,
            }}
            aria-hidden
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 z-[2]">{overlay}</div>
      </div>
    </div>
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
  const [cameraFullscreenMode, setCameraFullscreenMode] = useState<ExamFullscreenMode>('none');
  const [liveScanGeometry, setLiveScanGeometry] = useState<CalifacilOmrScanGeometry | null>(null);
  const [liveScanPicks, setLiveScanPicks] = useState<(number | null)[]>([]);
  const [liveScanLockedRows, setLiveScanLockedRows] = useState<boolean[]>([]);
  const [liveScanAmbiguousRows, setLiveScanAmbiguousRows] = useState<boolean[]>([]);
  const [liveVideoLayout, setLiveVideoLayout] = useState<LiveVideoLetterbox | null>(null);
  const mobileGuideRectPx = useMemo(() => {
    if (!liveVideoLayout) return null;
    return califacilViewfinderGuideInViewportPx(liveVideoLayout);
  }, [liveVideoLayout]);
  const [liveShowBubbleOverlay, setLiveShowBubbleOverlay] = useState(false);
  const [cornersAlignedView, setCornersAlignedView] = useState(false);
  const [mobileSheetFillRatio, setMobileSheetFillRatio] = useState(0);
  const [mobileFiducialCount, setMobileFiducialCount] = useState(0);
  const [mobileFiducialCorners, setMobileFiducialCorners] = useState<
    [boolean, boolean, boolean, boolean]
  >([false, false, false, false]);
  const [mobileSheetCornerGuides, setMobileSheetCornerGuides] = useState<
    MobileSheetCornerGuidePx[] | null
  >(null);
  const [mobileShadowWarning, setMobileShadowWarning] = useState(false);
  const [mobileStableTicks, setMobileStableTicks] = useState(0);
  const [cameraPortalReady, setCameraPortalReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mobileVideoViewportRef = useRef<HTMLDivElement>(null);
  const mobileCameraShellRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveTickRef = useRef<number | null>(null);
  const liveBusyRef = useRef(false);
  const liveDraftDisplaySigRef = useRef('');
  const liveResolvedDisplayedRef = useRef(-1);
  const stablePartialTicksRef = useRef(0);
  const stableFullTicksRef = useRef(0);
  const lowVisibilityTicksRef = useRef(0);
  const autotorchTriedRef = useRef(false);
  const shadowTorchTicksRef = useRef(0);
  const glareHintShownRef = useRef(false);
  const autoFinalizeInProgressRef = useRef(false);
  /** Respuestas ya capturadas en vivo por id de pregunta; no se sobrescriben hasta «Escanear otra vez». */
  const liveLockedAnswersRef = useRef<Record<string, string>>({});
  /** Racha de lecturas idénticas por pregunta antes de bloquear respuesta. */
  const liveReadingStreakRef = useRef<Record<string, { value: string; streak: number }>>({});
  /** Ticks consecutivos con hoja detectada en vivo. */
  const strictValidationTicksRef = useRef(0);
  const cornerStableTicksRef = useRef(0);
  /** Último cuadrilátero detectado en el ROI (coordenadas del canvas ROI). */
  const lastRoiQuadRef = useRef<RoiQuad | null>(null);
  /** Metadatos del último ROI válido (para warp en alta resolución). */
  const lastRoiCaptureMetaRef = useRef<MobileGuideRoiCapture | null>(null);
  /** Último sondeo de calidad OMR del loop en vivo (líneas/columnas detectadas). */
  const lastQualityProbeRef = useRef<CalifacilSheetQualityProbe | null>(null);
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
  const [autoGradePersisted, setAutoGradePersisted] = useState(false);
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
  const presentInstantCaptureGradeRef = useRef<(draft: Record<string, string>) => Promise<void>>(
    async () => {}
  );
  const finalizeCapturedSheetRef = useRef<
    (
      source: HTMLImageElement | HTMLCanvasElement,
      fallbackFile?: File,
      opts?: { skipReviewUi?: boolean; preWarped?: boolean; warpAlignment?: WarpAlignmentReport | null }
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
  const sheets = useMemo(() => (questions.length > 0 ? [questions] : []), [questions]);
  const totalSheets = sheets.length;
  const omrRowCount = questions.length;
  const currentChunk = useMemo(() => sheets[sheetIndex] ?? [], [sheets, sheetIndex]);
  const maxQuestions = 30;
  const expectedChunkPicks = useMemo(
    () => draftSelectionsToColumnPicks(currentChunk, examVirtualKeyByQuestionId),
    [currentChunk, examVirtualKeyByQuestionId]
  );
  const reviewOrangeFrameRect = useMemo(
    () =>
      reviewOmrGeometry
        ? califacilReviewOrangeFrameRect(reviewOmrGeometry, currentChunk.length, isMobile)
        : null,
    [reviewOmrGeometry, currentChunk.length, isMobile]
  );

  /** Comparación borrador vs clave automática (vacío = incorrecto). */
  const chunkKeyComparison = useMemo(() => {
    const draft = buildMcDraftFromChunk(currentChunk, draftSelections);
    return gradeMcDraftAgainstKey(draft, currentChunk, examVirtualKeyByQuestionId);
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
    if (!track || typeof track.applyConstraints !== 'function') return false;
    const attempts: MediaTrackConstraints[] = [
      { advanced: [{ torch: enabled } as MediaTrackConstraintSet] },
      { torch: enabled } as MediaTrackConstraints,
      { advanced: [{ fillLightMode: enabled ? 'flash' : 'off' } as MediaTrackConstraintSet] },
    ];
    for (const constraints of attempts) {
      try {
        await track.applyConstraints(constraints);
        setFlashOn(enabled);
        setFlashSupported(true);
        return true;
      } catch {
        // Siguiente método (Android / iOS varían).
      }
    }
    return false;
  }, []);

  const toggleFlash = useCallback(async () => {
    const next = !flashOn;
    const ok = await setTorchEnabled(next);
    if (!ok && next) {
      toast.message('Este navegador no permite activar el flash. Mejora la luz o acércate a una lámpara.');
    }
  }, [flashOn, setTorchEnabled]);

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
    shadowTorchTicksRef.current = 0;
    glareHintShownRef.current = false;
    autoFinalizeInProgressRef.current = false;
    liveLockedAnswersRef.current = {};
    liveReadingStreakRef.current = {};
    strictValidationTicksRef.current = 0;
    cornerStableTicksRef.current = 0;
    lastRoiQuadRef.current = null;
    lastRoiCaptureMetaRef.current = null;
    lastQualityProbeRef.current = null;
    liveDraftDisplaySigRef.current = '';
    liveResolvedDisplayedRef.current = -1;
    liveCompleteSoundPlayedRef.current = false;
    stopScanningHum();
    setLiveDraftSelections({});
    setLiveResolvedCount(0);
    setLiveScanGeometry(null);
    setLiveScanPicks([]);
    setLiveScanLockedRows([]);
    setLiveScanAmbiguousRows([]);
    setLiveVideoLayout(null);
    setLiveShowBubbleOverlay(false);
    setCornersAlignedView(false);
    setMobileSheetFillRatio(0);
    setMobileFiducialCount(0);
    setMobileFiducialCorners([false, false, false, false]);
    setMobileShadowWarning(false);
    setMobileStableTicks(0);
    setLiveStatus(
      isMobile
        ? 'Coloca los cuadros negros de la hoja dentro de los visores blancos. La captura es automática.'
        : 'Elige una imagen: puede ser la hoja completa o solo el recuadro CaliFacil; se leerá la tabla y se comparará con la clave del examen.'
    );
    clearAutoSnapshot();
  }, [clearAutoSnapshot, isMobile]);

  const stopLiveCamera = useCallback(() => {
    stopScanningHum();
    if (liveTickRef.current !== null) {
      window.clearTimeout(liveTickRef.current);
      liveTickRef.current = null;
    }
    void exitExamFullscreenSafe();
    setCameraFullscreenMode('none');
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
    shadowTorchTicksRef.current = 0;
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await video.play();
        if (!video.paused) break;
      } catch {
        await sleep(120);
      }
    }
  }, []);

  const updateLiveVideoLayout = useCallback(() => {
    const container = mobileVideoViewportRef.current;
    const video = videoRef.current;
    if (!container || !video || video.videoWidth < 40 || video.videoHeight < 40) return;
    const { width: cw, height: ch } = container.getBoundingClientRect();
    if (cw < 20 || ch < 20) return;
    const layout = getObjectContainVideoLayout(video.videoWidth, video.videoHeight, cw, ch);
    setLiveVideoLayout({
      ...layout,
      frameW: video.videoWidth,
      frameH: video.videoHeight,
    });
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
      opts?: { skipReviewUi?: boolean; preWarped?: boolean; warpAlignment?: WarpAlignmentReport | null }
    ): Promise<{ success: boolean; chunkDraft?: Record<string, string> }> => {
      if (!examId || !exam || !supportsCalifacil) {
        toast.error('Selecciona un examen válido antes de escanear.');
        return { success: false };
      }
      const skipReviewUi = opts?.skipReviewUi;
      const preWarped = Boolean(opts?.preWarped);
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) {
        toast.error('No hay preguntas para escanear en esta hoja.');
        return { success: false };
      }
      /** En móvil o archivo subido, respetamos la imagen tal cual: sin auto-rotar/deformar. */
      const isMobileCamera = isMobile && !fallbackFile;
      const preserveCapturedFrame = isMobileCamera ? false : isMobile || Boolean(fallbackFile);
      const oriented =
        preWarped && isMobileCamera
          ? source
          : isMobileCamera
            ? (autoOrientCalifacilSheet(source, omrCols, {
                useGuideCrop: false,
                allowTiltSweep: true,
              }) ?? source)
            : preserveCapturedFrame
              ? source
              : (autoOrientCalifacilSheet(source, omrCols, {
                  useGuideCrop: false,
                  allowTiltSweep: true,
                }) ?? source);
      const examCanvas =
        oriented instanceof HTMLCanvasElement
          ? oriented
          : prepareCalifacilScanInput(oriented, { useGuideCrop: false });
      const sheetLikely = examCanvas ? isCalifacilExamSheetLikely(examCanvas, omrCols) : false;
      const sheetStrict = examCanvas ? isCalifacilExamSheetStrict(examCanvas, omrCols) : false;
      if (!examCanvas || !sheetLikely) {
        setLiveStatus(
          isMobile
            ? 'Alinea los 4 cuadros negros de esquina con las esquinas naranjas y mejora la luz.'
            : 'No se detecta la tabla CaliFacil. Prueba una foto más nítida de la hoja completa o del pie con la tabla N.º / A–D.'
        );
        toast.error(
          isMobileCamera
            ? 'No se reconoce el examen. Alinea las esquinas negras impresas con el marco naranja e intenta de nuevo.'
            : isMobile
              ? 'No se reconoce el examen CaliFacil. Incluye la hoja impresa completa y que se vea el pie con las casillas A–D.'
              : 'No se reconoce el examen CaliFacil. Incluye bien la tabla del pie (página completa o solo el recuadro), buena luz y sin cortes.'
        );
        return { success: false };
      }
      const useFixedTemplate = preWarped && isMobileCamera ? true : isMobileCamera ? sheetStrict : Boolean(fallbackFile);
      let activeScanSource: HTMLImageElement | HTMLCanvasElement = oriented;
      let meta = scanCalifacilOmrSheetWithMeta(activeScanSource, omrCols, {
        skipGuideCrop: true,
        geometryMode: preWarped && isMobileCamera ? 'fullSheet' : isMobileCamera ? 'auto' : fallbackFile ? 'fullSheet' : isMobile ? 'fullSheet' : 'auto',
        preserveInputCanvas: preWarped && isMobileCamera ? true : isMobileCamera ? false : preserveCapturedFrame,
        fixedTemplateAnchor: useFixedTemplate,
        answerSheetTemplateOnly: preWarped && isMobileCamera,
        rowCount: omrRowCount,
        includeWarpAlignment: OMR_DEBUG_ENABLED || Boolean(opts?.warpAlignment),
      });
      const warpAlignment = opts?.warpAlignment ?? meta.warpAlignment ?? null;
      let raw = [...meta.picks];
      let mapped = mapRawToDraft(raw, chunk);
      const minResolved = Math.max(1, Math.ceil(chunk.length * MIN_AUTO_READ_RATIO));

      if (isMobile && mapped.resolvedCount < minResolved && !(preWarped && isMobileCamera)) {
        const recoverySource =
          autoOrientCalifacilSheet(source, omrCols, {
            useGuideCrop: false,
            allowTiltSweep: true,
          }) ?? (oriented as HTMLCanvasElement | HTMLImageElement);

        const recoveryMeta = scanCalifacilOmrSheetWithMeta(recoverySource, omrCols, {
          skipGuideCrop: true,
          geometryMode: isMobileCamera ? 'auto' : fallbackFile ? 'fullSheet' : isMobile ? 'fullSheet' : 'auto',
          preserveInputCanvas: false,
          fixedTemplateAnchor: useFixedTemplate,
          rowCount: omrRowCount,
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

      if (
        isMobileCamera &&
        ambiguousIdx.length > Math.ceil(chunk.length * AMBIGUOUS_ROW_WARN_RATIO)
      ) {
        toast.message(
          'Algunas respuestas fueron ambiguas; las casillas sin lectura clara se tomarán como incorrectas.'
        );
      }

      const si = sheetIndexRef.current;
      const picksInChunk = raw.slice(0, chunk.length);
      const allSameCol =
        chunk.length > 1 &&
        picksInChunk.every((p, i) => i === 0 || p === picksInChunk[0]) &&
        picksInChunk[0] !== null &&
        picksInChunk.every((p) => p !== null);

      if (
        CALIFACIL_VISION_POLICY.onAmbiguousRows &&
        ambiguousIdx.length > 0 &&
        examId &&
        !fallbackFile &&
        !isMobileCamera
      ) {
        const rowsPayload = ambiguousIdx.map((i) => ({
          questionId: chunk[i].id,
          globalNumber: i + 1,
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
        !fallbackFile &&
        !isMobileCamera
      ) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: i + 1,
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
        !fallbackFile &&
        !isMobileCamera
      ) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: i + 1,
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

      if (
        CALIFACIL_VISION_POLICY.onFinalizeEveryRow &&
        examId &&
        chunk.length > 0 &&
        !fallbackFile &&
        !isMobileCamera
      ) {
        const rowsPayload = chunk.map((q, i) => ({
          questionId: q.id,
          globalNumber: i + 1,
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
      if (mergedResolved < minResolved && !isMobileCamera) {
        setDraftSelections({});
        setLiveDraftSelections(mergedDraft);
        setLiveResolvedCount(mergedResolved);
        setLiveStatus(
          isMobile
            ? 'Lectura insuficiente: alinea las esquinas negras, mejora la luz y evita sombras.'
            : 'Lectura insuficiente: prueba una foto más nítida de la página completa o del pie CaliFacil, bien iluminada.'
        );
        if (!skipReviewUi) {
          toast.error(
            isMobile
              ? `Lectura insuficiente (${mergedResolved}/${chunk.length}). Vuelve a capturar con mejor encuadre.`
              : 'La imagen no permite leer bien la tabla. Incluye la hoja completa o el recuadro del pie, con buena luz.'
          );
          return { success: false };
        }
        toast.message(
          `Lectura parcial (${mergedResolved}/${chunk.length}). Se abrió revisión para corregir manualmente.`
        );
      } else if (isMobileCamera && mergedResolved < minResolved) {
        toast.message(
          `Lectura parcial (${mergedResolved}/${chunk.length}). Las casillas vacías se calificarán como incorrectas.`
        );
      } else if (isMobileCamera && !sheetStrict && !skipReviewUi) {
        toast.message(
          'Lectura aceptable sin alineación perfecta de esquinas. Revisa las respuestas antes de guardar.'
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

      if (isMobileCamera) {
        const fullChunkDraft = buildMcDraftFromChunk(chunk, mergedDraft);
        const snapSource =
          meta.reviewSourceCanvas ??
          (activeScanSource instanceof HTMLCanvasElement
            ? (prepareAnswerSheetDisplayCanvas(activeScanSource) ?? activeScanSource)
            : activeScanSource);
        let snapUrl: string | null = null;
        if (snapSource instanceof HTMLCanvasElement) {
          const blob = await new Promise<Blob | null>((resolve) => {
            snapSource.toBlob((b) => resolve(b), 'image/jpeg', 0.96);
          });
          if (blob) snapUrl = URL.createObjectURL(blob);
        }
        if (snapUrl && meta.geometry) {
          let geom: CalifacilOmrScanGeometry;
          try {
            geom = structuredClone(meta.geometry);
          } catch {
            geom = JSON.parse(JSON.stringify(meta.geometry)) as CalifacilOmrScanGeometry;
          }
          setMobileSheetSnapshots((prev) => [
            ...prev,
            {
              sheetIndex: sheetIndexRef.current,
              previewUrl: snapUrl!,
              geometry: geom,
              questionIds: chunk.map((q) => q.id),
              selectionsByQuestionId: { ...fullChunkDraft },
              answerSheetLayout: true,
              warpAlignment: OMR_DEBUG_ENABLED ? warpAlignment : undefined,
            },
          ]);
        }
        try {
          await presentInstantCaptureGradeRef.current(fullChunkDraft);
        } catch {
          toast.error('No se pudo mostrar el resultado. Intenta de nuevo.');
          return { success: false };
        }
        return { success: true, chunkDraft: fullChunkDraft };
      }

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
    [exam, examId, isMobile, mapRawToDraft, omrCols, omrRowCount, setPreviewFromSource, sheets, supportsCalifacil]
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
    setCameraPortalReady(true);
  }, []);

  useEffect(() => {
    if (!isMobile || phase !== 'capturar') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isMobile, phase]);

  useLayoutEffect(() => {
    if (!cameraOpen) return;
    void attachStreamToVideo();
    const video = videoRef.current;
    if (!video) return;
    const onLoadedMetadata = () => {
      void attachStreamToVideo();
      updateLiveVideoLayout();
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [attachStreamToVideo, cameraOpen, updateLiveVideoLayout]);

  useEffect(() => {
    if (!cameraOpen) {
      setLiveVideoLayout(null);
      return;
    }
    const container = mobileVideoViewportRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => updateLiveVideoLayout());
    ro.observe(container);
    updateLiveVideoLayout();
    return () => ro.disconnect();
  }, [cameraOpen, updateLiveVideoLayout]);

  useEffect(() => {
    if (!isMobile || phase !== 'capturar') return;
    let cancelled = false;
    const tryEnter = async () => {
      if (cancelled) return;
      const el = mobileCameraShellRef.current;
      if (!el) return;
      const mode = await enterExamFullscreen(el);
      if (!cancelled) setCameraFullscreenMode(mode);
    };
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => void tryEnter());
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
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
    if (cameraOpen || startingCameraRef.current) {
      if (opts?.skipPhaseGuard) {
        stopLiveCamera();
        startingCameraRef.current = false;
        mobileCaptureBusyRef.current = false;
        await sleep(80);
      } else {
        return;
      }
    }
    startingCameraRef.current = true;
    try {
      resumeScanAudioContext();
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        toast.error('Tu navegador no permite cámara en vivo en esta pantalla.');
        startingCameraRef.current = false;
        return;
      }
      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
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
      resetLiveReadings();
      setCameraOpen(true);
      const track = stream.getVideoTracks()[0];
      const capabilities =
        typeof track?.getCapabilities === 'function'
          ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
          : null;
      const supportsTorch = Boolean(capabilities?.torch);
      setFlashSupported(isMobile || supportsTorch);
      // Inicia siempre con flash apagado para abrir la cámara más rápido.
      setFlashOn(false);
      if (track && typeof track.applyConstraints === 'function') {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
        } catch {
          // Algunos navegadores no exponen focusMode vía applyConstraints.
        }
      }
      const scanCanvas = document.createElement('canvas');
      const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
      let hotLoopStatus = '';

      const scheduleLiveScan = (delayMs: number) => {
        if (liveTickRef.current !== null) {
          window.clearTimeout(liveTickRef.current);
        }
        liveTickRef.current = window.setTimeout(() => {
          void runLiveScanLoop();
        }, delayMs);
      };

      const runLiveScanLoop = async () => {
        let nextDelay = isMobile ? MOBILE_CORNER_LOOP_MS : 600;
        if (!streamRef.current || !examId || !exam || phaseRef.current !== 'capturar') {
          stopScanningHum();
          liveTickRef.current = null;
          return;
        }
        if (liveBusyRef.current) {
          scheduleLiveScan(100);
          return;
        }
        if (isMobile && mobileCaptureBusyRef.current) {
          scheduleLiveScan(200);
          return;
        }

        liveBusyRef.current = true;
        try {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || video.videoWidth < 40 || video.videoHeight < 40) {
            nextDelay = 100;
            return;
          }
          if (isMobile && video.paused) {
            void attachStreamToVideo();
            nextDelay = 150;
            return;
          }
          if (!isMobile && !scanCtx) return;

          const chunk = sheets[sheetIndexRef.current] ?? [];
          if (chunk.length === 0) return;

          let oriented: HTMLCanvasElement | null = null;
          let sheetLikely = false;
          if (isMobile) {
            const roiCapture = captureVideoGuideRoiFrame(video, {
              maxSide: MOBILE_ROI_DETECT_MAX_SIDE,
            });
            if (!roiCapture) {
              nextDelay = 100;
              return;
            }
            const { roiCanvas } = roiCapture;
            if (estimateCanvasMeanLuminance(roiCanvas) < MIN_FRAME_LUMINANCE) {
              setCornersAlignedView(false);
              setMobileSheetFillRatio(0);
              setMobileFiducialCount(0);
              setMobileFiducialCorners([false, false, false, false]);
              setMobileShadowWarning(false);
              setMobileStableTicks(0);
              setLiveScanGeometry(null);
              setLiveScanPicks([]);
              setLiveScanLockedRows([]);
              setLiveScanAmbiguousRows([]);
              setLiveShowBubbleOverlay(false);
              cornerStableTicksRef.current = 0;
              lastRoiQuadRef.current = null;
              lastRoiCaptureMetaRef.current = null;
              nextDelay = 200;
              setLiveStatus('Mejora la iluminación o activa el flash.');
              return;
            }

            const roiQuad = detectLargestQuadInRoiCanvas(roiCanvas);
            const roiW = roiCanvas.width;
            const roiH = roiCanvas.height;
            const quadValid = roiQuad !== null && isValidMobileRoiQuad(roiQuad, roiW, roiH);
            if (quadValid && roiQuad) {
              lastRoiCaptureMetaRef.current = roiCapture;
            }
            const fillRatio =
              roiQuad !== null ? measureRoiSheetFillRatio(roiQuad, roiW, roiH) : 0;
            const fiducialCorners = detectAnswerSheetFiducialsInRoi(roiCanvas, roiQuad);
            const fiducialCount = fiducialCorners.filter(Boolean).length;
            const shadowAsym = estimateCanvasShadowAsymmetry(roiCanvas);
            const shadowStrong = shadowAsym >= SHADOW_ASYMMETRY_TORCH;

            setMobileSheetFillRatio(fillRatio);
            setMobileFiducialCount(fiducialCount);
            setMobileFiducialCorners(fiducialCorners);
            setMobileShadowWarning(shadowStrong);
            if (quadValid && roiQuad && liveVideoLayout) {
              setMobileSheetCornerGuides(
                mapRoiQuadCornersToViewportPx(roiQuad, roiCapture, liveVideoLayout)
              );
            } else {
              setMobileSheetCornerGuides(null);
            }

            if (shadowStrong && flashSupported && !flashOn && !autotorchTriedRef.current) {
              shadowTorchTicksRef.current += 1;
              if (shadowTorchTicksRef.current >= SHADOW_AUTOTORCH_TICKS) {
                autotorchTriedRef.current = true;
                void setTorchEnabled(true);
              }
            } else if (!shadowStrong) {
              shadowTorchTicksRef.current = 0;
            }

            setLiveShowBubbleOverlay(false);
            setLiveScanGeometry(null);
            setLiveScanPicks([]);
            setLiveScanLockedRows([]);
            setLiveScanAmbiguousRows([]);

            if (!quadValid || !roiQuad) {
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              lastRoiQuadRef.current = null;
              lastRoiCaptureMetaRef.current = null;
              setCornersAlignedView(false);
              lowVisibilityTicksRef.current += 1;
              if (
                flashSupported &&
                !flashOn &&
                !autotorchTriedRef.current &&
                lowVisibilityTicksRef.current >= LOW_VISIBILITY_AUTOTORCH_TICKS
              ) {
                autotorchTriedRef.current = true;
                void setTorchEnabled(true);
                setLiveStatus('Activé el flash. Encuadra la hoja dentro del rectángulo.');
              } else {
                setLiveStatus('Encuadra la hoja dentro del rectángulo.');
              }
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            if (fillRatio < MOBILE_MIN_ROI_FILL_RATIO) {
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              lastRoiQuadRef.current = roiQuad;
              setCornersAlignedView(false);
              setLiveStatus(
                fillRatio < 0.15
                  ? 'Acerca un poco el teléfono — o usa el botón de captura manual abajo.'
                  : 'Centra los cuadros negros en los visores blancos.'
              );
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            if (fiducialCount < MOBILE_MIN_FIDUCIAL_CORNERS) {
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              lastRoiQuadRef.current = roiQuad;
              setCornersAlignedView(false);
              setLiveStatus(
                'Coloca cada cuadro negro dentro de su visor — o captura manual con el botón blanco.'
              );
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            const stable = mobileRoiQuadsAreStable(lastRoiQuadRef.current, roiQuad, roiW, roiH);
            lastRoiQuadRef.current = roiQuad;
            if (!stable) {
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              setCornersAlignedView(false);
              setLiveStatus('Mantén la hoja quieta dentro del rectángulo…');
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            cornerStableTicksRef.current += 1;
            lowVisibilityTicksRef.current = 0;
            setMobileStableTicks(cornerStableTicksRef.current);
            setCornersAlignedView(true);
            if (cornerStableTicksRef.current < CORNER_ALIGN_STABLE_TICKS) {
              setLiveStatus('Mantén la hoja quieta…');
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            if (mobileCaptureBusyRef.current) {
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            const captureQuad = lastRoiQuadRef.current;
            const captureRoi = lastRoiCaptureMetaRef.current;
            cornerStableTicksRef.current = 0;
            setMobileStableTicks(0);
            lastRoiQuadRef.current = null;
            lastRoiCaptureMetaRef.current = null;
            mobileCaptureBusyRef.current = true;
            setLiveStatus('Capturando foto para calificar…');
            try {
              const fullCanvas = captureVideoFullFrame(video, {
                maxSide: MOBILE_CAPTURE_MAX_SIDE,
              });
              if (!fullCanvas) return;
              if (!captureQuad || !captureRoi) {
                setLiveStatus('Encuadre perdido. Vuelve a alinear la hoja.');
                toast.error('No se conservó el encuadre. Mantén la hoja quieta e intenta de nuevo.');
                return;
              }
              playAutoCaptureClickSound();
              const { warped, alignment } = warpMobileCaptureWithFallback(
                fullCanvas,
                captureQuad,
                captureRoi
              );
              if (!warped) {
                setLiveStatus('No se alinearon las esquinas. Vuelve a encuadrar la hoja.');
                toast.error('No se detectaron las 4 esquinas. Alinea la hoja e intenta de nuevo.');
                return;
              }
              if (!alignment?.ok) {
                toast.message('Alineación aproximada — revisa las respuestas en la siguiente pantalla.');
              }
              setScanBusy(true);
              const result = await finalizeCapturedSheetRef.current(warped, undefined, {
                preWarped: true,
                warpAlignment: alignment,
              });
              if (result.success) {
                playScanCompleteChime();
                stopLiveCamera();
              } else {
                setLiveStatus('No se pudo leer la captura. Vuelve a encuadrar la hoja.');
              }
            } finally {
              mobileCaptureBusyRef.current = false;
              setScanBusy(false);
            }
            nextDelay = MOBILE_CORNER_LOOP_MS;
            return;
          } else {
            if (!scanCtx) return;
            let targetW = video.videoWidth;
            let targetH = video.videoHeight;
            if (targetW > MOBILE_SCAN_MAX_WIDTH) {
              const s = MOBILE_SCAN_MAX_WIDTH / Math.max(1, targetW);
              targetW = MOBILE_SCAN_MAX_WIDTH;
              targetH = Math.max(1, Math.round(targetH * s));
            }
            if (scanCanvas.width !== targetW || scanCanvas.height !== targetH) {
              scanCanvas.width = targetW;
              scanCanvas.height = targetH;
            }
            scanCtx.drawImage(video, 0, 0, targetW, targetH);
            oriented = scanCanvas;
            sheetLikely = isCalifacilExamSheetLikely(oriented, omrCols);
          }

          if (!sheetLikely) {
            stopScanningHum();
            stablePartialTicksRef.current = 0;
            stableFullTicksRef.current = 0;
            strictValidationTicksRef.current = 0;
            lastQualityProbeRef.current = null;
            liveReadingStreakRef.current = {};
            if (isMobile) {
              setLiveScanGeometry(null);
              setLiveScanPicks([]);
              setLiveScanLockedRows([]);
              setLiveScanAmbiguousRows([]);
              setLiveShowBubbleOverlay(false);
            }
            lowVisibilityTicksRef.current += 1;
            const locksNoExam = liveLockedAnswersRef.current;
            const mergedNoExam: Record<string, string> = {};
            let resolvedNoExam = 0;
            let noExamSig = '';
            for (const q of chunk) {
              const locked = locksNoExam[q.id]?.trim();
              mergedNoExam[q.id] = locked || '';
              noExamSig += `${locked ?? ''}\n`;
              if (locked) resolvedNoExam++;
            }
            if (
              noExamSig !== liveDraftDisplaySigRef.current ||
              resolvedNoExam !== liveResolvedDisplayedRef.current
            ) {
              liveDraftDisplaySigRef.current = noExamSig;
              liveResolvedDisplayedRef.current = resolvedNoExam;
              setLiveDraftSelections(mergedNoExam);
              setLiveResolvedCount(resolvedNoExam);
            }
            const nextStatus = isMobile
              ? 'Alinea los 4 cuadros negros de esquina con las esquinas naranjas del marco.'
              : 'Encuadra toda la hoja dentro de la pantalla, con buena luz y la tabla de respuestas visible abajo.';
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
                'Activé el flash automáticamente para mejorar detección. Mantén la hoja dentro del marco.'
              );
              if (!glareHintShownRef.current) {
                glareHintShownRef.current = true;
                toast.message('Si hay reflejo, inclina ligeramente el celular y evita brillo directo.');
              }
            }
            return;
          }

          const strictOk = isMobile
            ? isCalifacilExamSheetStrict(oriented, omrCols)
            : isCalifacilExamSheetLikely(oriented, omrCols);
          if (strictOk) {
            strictValidationTicksRef.current += 1;
          } else {
            strictValidationTicksRef.current = 0;
          }
          const showBubbles =
            isMobile && strictValidationTicksRef.current >= LIVE_STRICT_OVERLAY_TICKS;
          if (isMobile) {
            setLiveShowBubbleOverlay(showBubbles);
          }

          lowVisibilityTicksRef.current = 0;
          const scanMeta = scanCalifacilOmrSheetWithMeta(oriented, omrCols, {
            skipGuideCrop: true,
            qnumSweep: 'live',
            columnShiftSweep: 'live',
            geometryMode: isMobile ? 'fullSheet' : 'fullSheet',
            preserveInputCanvas: isMobile,
            fixedTemplateAnchor: false,
            rowCount: omrRowCount,
          });
          const raw = [...scanMeta.picks];
          const mapped = mapRawToDraft(raw, chunk);
          if (isMobile) {
            lastQualityProbeRef.current = probeCalifacilSheetQuality(oriented, omrCols);
            if (showBubbles) {
              setLiveScanGeometry(scanMeta.geometry);
              setLiveScanPicks(raw.slice(0, chunk.length));
            } else {
              setLiveScanGeometry(null);
              setLiveScanPicks([]);
            }
          }
          const locks = liveLockedAnswersRef.current;
          const streaks = liveReadingStreakRef.current;
          const mergedLive: Record<string, string> = {};
          let mergedResolved = 0;
          let draftSig = '';
          for (const q of chunk) {
            const locked = locks[q.id]?.trim();
            if (locked) {
              mergedLive[q.id] = locked;
              mergedResolved++;
            } else {
              const v = mapped.draft[q.id]?.trim() ?? '';
              if (v) {
                const prev = streaks[q.id];
                if (prev?.value === v) {
                  prev.streak += 1;
                } else {
                  streaks[q.id] = { value: v, streak: 1 };
                }
                if (streaks[q.id]!.streak >= CONSENSUS_LOCK_TICKS) {
                  locks[q.id] = v;
                  mergedLive[q.id] = v;
                  mergedResolved++;
                } else {
                  mergedLive[q.id] = v;
                }
              } else {
                delete streaks[q.id];
                mergedLive[q.id] = '';
              }
            }
            draftSig += `${mergedLive[q.id] ?? ''}\n`;
          }
          let tentativeResolved = 0;
          for (const q of chunk) {
            if (mergedLive[q.id]?.trim()) tentativeResolved++;
          }
          if (isMobile) {
            const lockedRowFlags = chunk.map((q) => Boolean(locks[q.id]?.trim()));
            const ambiguousRowFlags = chunk.map((_, i) => Boolean(scanMeta.rows[i]?.ambiguous));
            if (showBubbles) {
              setLiveScanLockedRows(lockedRowFlags);
              setLiveScanAmbiguousRows(ambiguousRowFlags);
            } else {
              setLiveScanLockedRows([]);
              setLiveScanAmbiguousRows([]);
            }
          }
          if (draftSig !== liveDraftDisplaySigRef.current) {
            liveDraftDisplaySigRef.current = draftSig;
            setLiveDraftSelections(mergedLive);
          }
          if (mergedResolved !== liveResolvedDisplayedRef.current) {
            liveResolvedDisplayedRef.current = mergedResolved;
            setLiveResolvedCount(mergedResolved);
          }

          if (isMobile && mergedResolved >= chunk.length && chunk.length > 0) {
            nextDelay = 1050;
          }

          if (chunk.length > 0) {
            if (isMobile) {
              if (mergedResolved >= chunk.length && strictOk) {
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
          const autoCaptureMin = Math.max(1, Math.ceil(chunk.length * MOBILE_AUTO_CAPTURE_MIN_RATIO));
          if (isMobile && !strictOk && chunk.length > 0) {
            const nextStatus =
              'Alinea los 4 cuadros negros de esquina con las esquinas naranjas del marco.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (isMobile && mergedResolved >= autoCaptureMin && strictOk && chunk.length > 0) {
            const nextStatus =
              'Lectura estable: capturando en automático o pulsa el botón naranja.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (mergedResolved >= chunk.length && chunk.length > 0) {
            const nextStatus = isMobile
              ? 'Lectura completa: capturando en automático o pulsa el botón naranja.'
              : 'Detección completa. Toca «Revisar y confirmar».';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (mergedResolved >= minResolved) {
            const nextStatus = isMobile
              ? 'Casi listo: mantén fijo el encuadre o pulsa el botón naranja.'
              : 'Lecturas capturadas. Completa faltantes o pulsa «Revisar y confirmar».';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else if (tentativeResolved >= Math.ceil(chunk.length * 0.25)) {
            const nextStatus = 'Detectando respuestas… mantén la hoja quieta y bien iluminada.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          } else {
            const nextStatus =
              'Encuadra toda la hoja dentro de la pantalla; debe verse la tabla de respuestas al pie.';
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
          if (
            isMobile
              ? mergedResolved >= autoCaptureMin && strictOk && chunk.length > 0
              : mergedResolved >= chunk.length && chunk.length > 0
          ) {
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
            await showAutoCaptureSnapshot(oriented);
            const nextStatus =
              'Hoja completa detectada. Toca «Revisar y confirmar» para validar respuestas antes de guardar.';
            if (nextStatus !== hotLoopStatus) {
              hotLoopStatus = nextStatus;
              setLiveStatus(nextStatus);
            }
          }
        } finally {
          liveBusyRef.current = false;
          if (streamRef.current && examId && exam && phaseRef.current === 'capturar') {
            scheduleLiveScan(nextDelay);
          } else {
            if (liveTickRef.current !== null) {
              window.clearTimeout(liveTickRef.current);
              liveTickRef.current = null;
            }
          }
        }
      };

      scheduleLiveScan(100);
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
    stopLiveCamera,
    sheets,
    supportsCalifacil,
  ]);

  startLiveCameraRef.current = startLiveCamera;

  const retakeMobileSheetPhoto = useCallback(
    (sheetIdx = sheetIndexRef.current) => {
      setMobileSheetSnapshots((prev) => prev.filter((snap) => snap.sheetIndex !== sheetIdx));
      setMobileResultsDraft((prev) => {
        const chunk = sheets[sheetIdx] ?? [];
        const next = { ...prev };
        for (const q of chunk) delete next[q.id];
        return next;
      });
      setReviewOmrGeometry(null);
      setReviewQualityHint(null);
      setDraftSelections({});
      setPreviewUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setAutoGradeDialogOpen(false);
      setSheetIndex(sheetIdx);
      sheetIndexRef.current = sheetIdx;
      stopLiveCamera();
      startingCameraRef.current = false;
      mobileCaptureBusyRef.current = false;
      setScanBusy(false);
      flushSync(() => {
        setPhase('capturar');
      });
      phaseRef.current = 'capturar';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void startLiveCamera({ skipPhaseGuard: true });
        });
      });
    },
    [sheets, startLiveCamera, stopLiveCamera]
  );

  const openMobileCapture = useCallback(() => {
    if (examLoading) {
      toast.error('Cargando examen, espera un momento.');
      return;
    }
    if (!examId || !exam || !supportsCalifacil) {
      toast.error('Selecciona primero un examen válido y entra a captura.');
      return;
    }
    stopLiveCamera();
    startingCameraRef.current = false;
    mobileCaptureBusyRef.current = false;
    setScanBusy(false);
    clearMobileSnapshots();
    setMobileResultsDraft({});
    setResultsSheetIdx(0);
    flushSync(() => {
      setPhase('capturar');
    });
    phaseRef.current = 'capturar';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void startLiveCamera({ skipPhaseGuard: true });
      });
    });
  }, [
    clearMobileSnapshots,
    exam,
    examId,
    examLoading,
    startLiveCamera,
    stopLiveCamera,
    supportsCalifacil,
  ]);

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
    let earnedPoints = 0;
    let maxMcPoints = 0;
    const rows = questions.map((question: Question) => {
      const answerText = (merged[question.id] ?? '').trim();
      const expected = (effectiveKey[question.id] ?? '').trim();
      const gotIdx = resolveOptionIndexFromValue(question.options, answerText);
      const wantIdx = resolveOptionIndexFromValue(question.options, expected);
      const isCorrect =
        question.type === 'multiple_choice'
          ? gotIdx !== null && wantIdx !== null && gotIdx === wantIdx
          : null;
      const pts = questionPoints(question);
      if (question.type === 'multiple_choice') {
        maxMcPoints += pts;
        if (isCorrect) {
          correctCount++;
          earnedPoints += pts;
        }
      }

      return {
        exam_id: examId,
        student_id: studentId,
        question_id: question.id,
        answer_text: answerText,
        is_correct: isCorrect,
        score: isCorrect ? pts : 0,
      };
    });

    const { error: answersError } = await supabase.from('answers').upsert(rows, {
      onConflict: 'exam_id,student_id,question_id',
    });
    if (answersError) throw answersError;

    const pct = calculatePercentage(earnedPoints, maxMcPoints);
    const wrong = Math.max(0, mcTotal - correctCount);
    return { pct, correct: correctCount, wrong, total: mcTotal };
  };

  const presentInstantCaptureGrade = useCallback(
    async (fullDraft: Record<string, string>) => {
      const stats = gradeMcDraftAgainstKey(fullDraft, questions, examVirtualKeyByQuestionId);
      setAutoGradeStats(stats);
      setMobileResultsDraft({ ...fullDraft });

      const canPersist =
        Boolean(selectedStudentId) &&
        sortedStudents.some((s) => s.id === selectedStudentId) &&
        canGradeStudents;

      let persisted = false;
      if (canPersist) {
        try {
          await persistStudentAnswers(fullDraft);
          persisted = true;
          toast.success('Calificación guardada.');
        } catch (err: unknown) {
          const code = err instanceof Error ? err.message : '';
          if (code === 'incomplete_key') {
            toast.error('Clave automática incompleta. No se pudo guardar en la nube.');
          } else {
            toast.error('No se pudo guardar en la nube. El resultado se muestra igual.');
          }
        }
      } else {
        toast.message('Resultado calculado. Las casillas sin marcar cuentan como incorrectas.');
      }

      setAutoGradePersisted(persisted);
      setAutoGradeDialogOpen(true);
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
      setReviewOmrGeometry(null);
      setReviewQualityHint(null);
    },
    [
      canGradeStudents,
      examVirtualKeyByQuestionId,
      questions,
      selectedStudentId,
      sortedStudents,
      stopLiveCamera,
    ]
  );

  presentInstantCaptureGradeRef.current = presentInstantCaptureGrade;

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
      setAutoGradePersisted(true);
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
      const fullCanvas = captureVideoFullFrame(video, { maxSide: MOBILE_CAPTURE_MAX_SIDE });
      if (!fullCanvas) {
        toast.error('No se pudo capturar. Intenta de nuevo.');
        return;
      }
      let roiCapture = lastRoiCaptureMetaRef.current;
      let roiQuad = lastRoiQuadRef.current;
      if (!roiCapture || !roiQuad) {
        roiCapture = captureVideoGuideRoiFrame(video, { maxSide: MOBILE_ROI_DETECT_MAX_SIDE });
        if (roiCapture) {
          roiQuad = detectLargestQuadInRoiCanvas(roiCapture.roiCanvas);
        }
      }
      if (!roiCapture || !roiQuad) {
        const warpedOnly = warpCalifacilSheetFromCornerMarkers(fullCanvas);
        if (!warpedOnly) {
          toast.error('No se detectó la hoja. Alinea los visores blancos e intenta de nuevo.');
          return;
        }
        const alignmentOnly = measureWarpedFiducialAlignment(
          warpedOnly,
          MOBILE_WARP_FALLBACK_MAX_ERROR_PX
        );
        playAutoCaptureClickSound();
        const resultOnly = await finalizeCapturedSheet(warpedOnly, undefined, {
          preWarped: true,
          warpAlignment: alignmentOnly,
        });
        if (resultOnly.success) playScanCompleteChime();
        return;
      }
      const { warped, alignment } = warpMobileCaptureWithFallback(fullCanvas, roiQuad, roiCapture);
      if (!warped) {
        toast.error('No se detectaron las esquinas. Alinea la hoja e intenta de nuevo.');
        return;
      }
      if (!alignment?.ok) {
        toast.message('Alineación aproximada — revisa las respuestas.');
      }
      playAutoCaptureClickSound();
      const result = await finalizeCapturedSheet(warped, undefined, {
        preWarped: true,
        warpAlignment: alignment,
      });
      if (result.success) {
        playScanCompleteChime();
      }
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
    liveReadingStreakRef.current = {};
    strictValidationTicksRef.current = 0;
    lastQualityProbeRef.current = null;
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

  if (!user) return null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-3 pb-6 sm:gap-4 sm:pb-8">
      <Dialog open={autoGradeDialogOpen} onOpenChange={setAutoGradeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {autoGradePersisted ? 'Calificación guardada' : 'Resultado del examen'}
            </DialogTitle>
            <DialogDescription>
              {autoGradePersisted
                ? `Resultados para ${selectedStudentName.trim() || 'el alumno seleccionado'}.`
                : 'Las casillas sin marcar se consideraron respuestas incorrectas.'}
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
                  className="w-full border-orange-300 text-orange-800 hover:bg-orange-50"
                  onClick={() => {
                    setAutoGradeDialogOpen(false);
                    retakeMobileSheetPhoto(sheetIndexRef.current);
                  }}
                >
                  Tomar otra foto
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
            ? 'Cámara a pantalla completa: encuadra toda la hoja impresa. Captura automática al detectar respuestas, o pulsa el botón naranja.'
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
                    La cámara abre a pantalla completa. Coloca los{' '}
                    <strong>cuatro cuadros negros</strong> impresos en las esquinas de la hoja dentro de los{' '}
                    <strong>visores</strong>; al detectarlos se captura y califica automáticamente.
                  </p>
                  <Button
                    type="button"
                    className="w-full bg-orange-600 hover:bg-orange-700"
                    disabled={scanBusy || examLoading || !exam || !supportsCalifacil}
                    onClick={openMobileCapture}
                  >
                    Tomar foto
                  </Button>
                </div>
              )}
            </>
          )}

        </CardContent>
      </Card>

      {useLiveCameraUi &&
        phase === 'capturar' &&
        exam &&
        cameraPortalReady &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={mobileCameraShellRef}
            className={cn(
              'fixed inset-0 z-[200] flex h-[100dvh] w-full max-h-[100dvh] flex-col bg-black text-white',
              cameraFullscreenMode === 'pseudo' && EXAM_PSEUDO_FULLSCREEN_CLASS,
              cameraFullscreenMode === 'pseudo' && '!bg-black'
            )}
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
                  Preguntas 1–{currentChunk.length} · Encuadra la hoja carta
                  completa
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {isMobile ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-9 w-9 shrink-0 text-white hover:bg-white/10 hover:text-white',
                      flashOn && 'bg-white/15 text-amber-300'
                    )}
                    disabled={scanBusy}
                    aria-label={flashOn ? 'Apagar flash' : 'Encender flash'}
                    title={flashOn ? 'Apagar flash' : 'Encender flash'}
                    onClick={() => void toggleFlash()}
                  >
                    <Zap className="h-5 w-5" aria-hidden />
                  </Button>
                ) : null}
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
            </div>

            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleGalleryFile}
            />

            <div ref={mobileVideoViewportRef} className="relative min-h-0 flex-1 overflow-hidden bg-black">
              {!cameraOpen ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
                  <div className="flex items-center gap-2 text-sm text-orange-100">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Abriendo cámara en vivo…
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full max-w-xs"
                    onClick={() => void startLiveCamera({ skipPhaseGuard: true })}
                  >
                    Reintentar cámara
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative h-full min-h-0 w-full">
                    <div
                      className="absolute overflow-hidden bg-black"
                      style={
                        liveVideoLayout
                          ? {
                              left: liveVideoLayout.offsetX,
                              top: liveVideoLayout.offsetY,
                              width: liveVideoLayout.displayW,
                              height: liveVideoLayout.displayH,
                            }
                          : { inset: 0 }
                      }
                    >
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className={cn(
                          'h-full w-full bg-black object-center',
                          liveVideoLayout ? 'object-cover' : 'object-contain'
                        )}
                      />
                    </div>
                    <CalifacilLiveScanOverlay
                      geometry={liveScanGeometry}
                      picks={liveScanPicks}
                      lockedRows={liveScanLockedRows}
                      ambiguousRows={liveScanAmbiguousRows}
                      rowCount={currentChunk.length}
                      letterbox={liveVideoLayout}
                      visible={liveShowBubbleOverlay}
                    />
                    <MobileScanViewfinderOverlay
                      aligned={cornersAlignedView}
                      examTitle={exam.title}
                      sheetLabel={`Hoja ${sheetIndex + 1} de ${totalSheets}`}
                      guideRect={mobileGuideRectPx}
                      sheetCornerGuides={mobileSheetCornerGuides}
                      fillRatio={mobileSheetFillRatio}
                      stableTicks={mobileStableTicks}
                      stableTicksRequired={CORNER_ALIGN_STABLE_TICKS}
                      shadowWarning={mobileShadowWarning}
                      fiducialCount={mobileFiducialCount}
                      fiducialCorners={mobileFiducialCorners}
                    />
                  </div>
                  {scanBusy ? (
                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/35">
                      <Loader2
                        className="h-10 w-10 animate-spin text-orange-400 motion-reduce:animate-none [animation-duration:750ms]"
                        aria-hidden
                      />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="absolute bottom-[max(5.5rem,calc(env(safe-area-inset-bottom,0px)+4.5rem))] left-1/2 z-30 flex h-[3.5rem] w-[3.5rem] -translate-x-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-white/20 shadow-lg backdrop-blur-sm disabled:opacity-60"
                    disabled={scanBusy}
                    aria-label="Capturar manualmente"
                    title="Captura manual si la automática no dispara"
                    onClick={() => void captureMobilePhotoManually()}
                  >
                    <span className="block h-[2.75rem] w-[2.75rem] rounded-full border-2 border-white bg-white/30" />
                  </button>
                </>
              )}
              {cameraOpen ? (
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-6"
                  style={{
                    background:
                      'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)',
                  }}
                >
                  <p className="mb-1 text-center text-sm font-semibold text-white">
                    {cornersAlignedView && mobileStableTicks >= CORNER_ALIGN_STABLE_TICKS
                      ? 'Listo — capturando'
                      : mobileSheetFillRatio > 0 && mobileSheetFillRatio < MOBILE_MIN_ROI_FILL_RATIO
                        ? 'Acerca un poco o usa captura manual'
                        : mobileShadowWarning && !flashOn
                          ? 'Mejor luz — sigue alineando'
                          : mobileFiducialCount > 0 && mobileFiducialCount < MOBILE_MIN_FIDUCIAL_CORNERS
                            ? 'Alinea los visores con los cuadros negros'
                            : cornersAlignedView
                              ? 'Mantén la hoja quieta'
                              : 'Buscando hoja…'}
                  </p>
                  <p className="text-center text-xs leading-snug text-white/90">{liveStatus}</p>
                  <p className="mt-1 text-center text-[10px] text-white/70">
                    Botón blanco abajo = captura manual si no dispara sola
                  </p>
                </div>
              ) : null}
            </div>
          </div>,
          document.body
        )}

      {((phase === 'revisar_hoja') || (phase === 'capturar' && !useLiveCameraUi)) && exam && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              Hoja de alumno {sheetIndex + 1} de {totalSheets}
            </CardTitle>
            <CardDescription>
              Preguntas 1–{currentChunk.length} ·{' '}
              {isMobile
                ? 'Encuadra toda la hoja dentro de la pantalla; debe verse la tabla de respuestas al pie.'
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
                {reviewOmrGeometry ? (
                  <CalifacilReviewImageStack
                    previewUrl={previewUrl}
                    alt="Vista previa del examen escaneado"
                    geometry={reviewOmrGeometry}
                    orangeFrameRect={reviewOrangeFrameRect}
                    overlay={
                      <CalifacilOmrReviewOverlay
                        geometry={reviewOmrGeometry}
                        picks={draftSelectionsToColumnPicks(currentChunk, draftSelections)}
                        expectedPicks={expectedChunkPicks}
                        expectedOpacity={overlayOpacity / 100}
                        rowCount={currentChunk.length}
                        clipRect={null}
                      />
                    }
                  />
                ) : (
                  <div className="flex w-full justify-center overflow-hidden rounded-lg border bg-gray-50 p-1">
                    <div className="relative inline-block max-h-96 max-w-full">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="Vista previa del examen escaneado"
                        className="relative z-0 block max-h-96 w-auto max-w-full"
                      />
                    </div>
                  </div>
                )}
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
                    {isMobile ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 w-full border-orange-300 bg-white text-orange-800 hover:bg-orange-50"
                        onClick={() => retakeMobileSheetPhoto(sheetIndex)}
                      >
                        Tomar otra foto
                      </Button>
                    ) : null}
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
                  const globalNum = idx + 1;
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
                        retakeMobileSheetPhoto(sheetIndex);
                        return;
                      }
                      setPhase('capturar');
                      setReviewOmrGeometry(null);
                      setPreviewUrl((u) => {
                        if (u) URL.revokeObjectURL(u);
                        return null;
                      });
                      setDraftSelections({});
                      resetLiveReadings();
                    }}
                  >
                    {useLiveCameraUi ? 'Tomar otra foto' : 'Importar otra imagen'}
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
                const orangeFrameRect = califacilReviewOrangeFrameRect(
                  snap.geometry,
                  chunk.length,
                  snap.answerSheetLayout
                );
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
                    <CalifacilReviewImageStack
                      previewUrl={snap.previewUrl}
                      alt={`Hoja ${snap.sheetIndex + 1}`}
                      geometry={snap.geometry}
                      orangeFrameRect={orangeFrameRect}
                      overlay={
                        <>
                          <CalifacilOmrReviewOverlay
                            geometry={snap.geometry}
                            picks={tabPicks}
                            expectedPicks={tabExpectedPicks}
                            expectedOpacity={overlayOpacity / 100}
                            rowCount={chunk.length}
                            clipRect={null}
                          />
                          {OMR_DEBUG_ENABLED && snap.warpAlignment ? (
                            <CalifacilOmrDebugOverlay
                              imageWidth={snap.geometry.imageWidth}
                              imageHeight={snap.geometry.imageHeight}
                              template={buildCalifacilAnswerSheetOmrTemplate(chunk.length)}
                              alignment={snap.warpAlignment}
                            />
                          ) : null}
                        </>
                      }
                    />
                    {OMR_DEBUG_ENABLED && snap.warpAlignment ? (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-center text-[11px] text-amber-950">
                        {formatWarpAlignmentSummary(snap.warpAlignment)}
                      </p>
                    ) : null}
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 w-full border-orange-300 bg-white text-orange-800 hover:bg-orange-50"
                          onClick={() => retakeMobileSheetPhoto(snap.sheetIndex)}
                        >
                          Tomar otra foto de esta hoja
                        </Button>
                      </div>
                    ) : null}
                    {chunk.map((q, idx) => {
                      const globalNum = idx + 1;
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
                variant="outline"
                className="flex-1 border-orange-300 text-orange-800 hover:bg-orange-50"
                disabled={scanBusy}
                onClick={() => retakeMobileSheetPhoto(mobileSheetSnapshots[resultsSheetIdx]?.sheetIndex ?? sheetIndex)}
              >
                Tomar otra foto
              </Button>
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
