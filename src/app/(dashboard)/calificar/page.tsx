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
import { AlertCircle, Camera, Info, LayoutDashboard, Loader2, Palette, X, Zap } from 'lucide-react';
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
  califacilOmrOrangeFrameRect,
  califacilImageToJpegDataUrl,
  califacilMobileAnswerSheetGuideInViewportPx,
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
  isCalifacilAnswerSheetReadyForGrading,
  diagnoseCalifacilAnswerSheetReadiness,
  isValidMobileRoiQuad,
  mapRoiQuadToFrame,
  mapRoiQuadPolygonToViewportPx,
  scaleQuadToCanvas,
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
  refineWarpedCalifacilSheet,
  scanCalifacilOmrSheetWithMeta,
  scanWarpedWithBestTableFrame,
  scanWarpedWithNormTableFrame,
  readAnswerSheetControlNumberFromCanvas,
  canvasPreviewDataUrl,
  downscaleCanvasForOmrScan,
  smoothMobileRoiQuad,
  warpCalifacilSheetFromCornerMarkers,
  type WarpAlignmentReport,
  type CalifacilOmrScanGeometry,
  type OmrNormRect,
  type CalifacilSheetQualityProbe,
} from '@/lib/omrScan';
import { findStudentByControlNumber } from '@/lib/controlNumberOmr';
import { warpCalifacilMobileCaptureFast } from '@/lib/omr/pipeline';
import { setCameraTorch, trackReportsTorchCapability } from '@/lib/cameraTorch';
import { type LiveVideoLetterbox } from '@/components/califacil-live-scan-overlay';
import { CalifacilOmrReviewOverlay } from '@/components/califacil-omr-review-overlay';
import {
  CalifacilOmrDebugOverlay,
  formatWarpAlignmentSummary,
} from '@/components/califacil-omr-debug-overlay';
import { IosCaptureFlashOverlay } from '@/components/iphone-document-scanner-overlay';
import { MobileAnswerSheetAlignGuideOverlay } from '@/components/mobile-answer-sheet-bubble-guide-overlay';
import { MobileSheetScanReview } from '@/components/mobile-sheet-scan-review';
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

type FlashMode = 'auto' | 'on' | 'off';
type LiveColorMode = 'color' | 'grayscale' | 'bw';

type MobileCaptureReviewState = {
  sourceCanvas: HTMLCanvasElement;
  frameQuad: RoiQuad;
  warped: HTMLCanvasElement;
  alignment: WarpAlignmentReport | null;
};

type MobileReviewAlignPreview = {
  warped: HTMLCanvasElement;
  alignment: WarpAlignmentReport | null;
  geometry: CalifacilOmrScanGeometry;
  picks: (number | null)[];
  draft: Record<string, string>;
  previewUrl: string;
  orangeFrameNorm: OmrNormRect;
};

type MobileSheetSnapshot = {
  sheetIndex: number;
  previewUrl: string;
  geometry: CalifacilOmrScanGeometry;
  questionIds: string[];
  selectionsByQuestionId: Record<string, string>;
  /** Índice de columna OMR leído por fila (0 = A), alineado con la plantilla naranja. */
  columnPicks: (number | null)[];
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
const MOBILE_CAPTURE_MAX_SIDE = 1800;
/** Tras varios ticks sin detección, intentamos flash en móvil si está disponible. */
const LOW_VISIBILITY_AUTOTORCH_TICKS = 3;
/** Asimetría de luminancia izq/der que sugiere sombra fuerte en la hoja. */
const SHADOW_ASYMMETRY_TORCH = 0.14;
/** Ticks con sombra antes de activar flash automático. */
const SHADOW_AUTOTORCH_TICKS = 2;
/** Ticks consecutivos en validación estricta antes de mostrar burbujas en vivo. */
const LIVE_STRICT_OVERLAY_TICKS = 2;
/** Fotogramas estables antes de auto-captura (~0,5 s). Captura manual no espera. */
const CORNER_ALIGN_STABLE_TICKS = 6;
/** Intervalo del loop de detección de esquinas en móvil (ms). */
const MOBILE_CORNER_LOOP_MS = 80;
/** Tiempo mínimo de espera con hoja alineada antes de auto-captura. */
const MOBILE_ALIGN_HOLD_MS = CORNER_ALIGN_STABLE_TICKS * MOBILE_CORNER_LOOP_MS;
/** Tolerancia de alineación fiducial en captura móvil (más permisivo que escritorio). */
const MOBILE_WARP_FALLBACK_MAX_ERROR_PX = 18;
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
function warpMobileCaptureWithFallback(
  fullCanvas: HTMLCanvasElement,
  roiQuad: RoiQuad,
  roiCapture: MobileGuideRoiCapture
): { warped: HTMLCanvasElement | null; alignment: WarpAlignmentReport | null } {
  const result = warpCalifacilMobileCaptureFast(fullCanvas, {
    roiQuad,
    roiCapture,
    maxErrorPx: MOBILE_WARP_FALLBACK_MAX_ERROR_PX,
  });
  return { warped: result.warped, alignment: result.alignment };
}

function defaultDocumentQuad(canvasW: number, canvasH: number): RoiQuad {
  const m = 0.035;
  return [
    { x: canvasW * m, y: canvasH * m },
    { x: canvasW * (1 - m), y: canvasH * m },
    { x: canvasW * (1 - m), y: canvasH * (1 - m) },
    { x: canvasW * m, y: canvasH * (1 - m) },
  ];
}

function frameQuadOnFullCanvas(
  roiQuad: RoiQuad,
  roiCapture: MobileGuideRoiCapture,
  fullCanvas: HTMLCanvasElement
): RoiQuad {
  const frameQuad = mapRoiQuadToFrame(
    roiQuad,
    roiCapture.roiRect,
    roiCapture.roiCanvas.width,
    roiCapture.roiCanvas.height
  );
  return scaleQuadToCanvas(
    frameQuad,
    roiCapture.frameW,
    roiCapture.frameH,
    fullCanvas.width,
    fullCanvas.height
  );
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
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 48);
      });
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

function califacilReviewOrangeFrameRect(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): { x: number; y: number; w: number; h: number } | null {
  return (
    califacilOmrOrangeFrameRect(geometry, rowCount) ??
    califacilViewfinderNormRect(geometry.imageWidth, geometry.imageHeight)
  );
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
  const [detectedControlNumber, setDetectedControlNumber] = useState<string | null>(null);
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
  const [reviewOmrPicks, setReviewOmrPicks] = useState<(number | null)[]>([]);
  const [scanBusy, setScanBusy] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('Sube una imagen escaneada para leer respuestas.');
  const [liveResolvedCount, setLiveResolvedCount] = useState(0);
  const [liveDraftSelections, setLiveDraftSelections] = useState<Record<string, string>>({});
  const [flashSupported, setFlashSupported] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [flashMode, setFlashMode] = useState<FlashMode>('auto');
  const [autoShutterEnabled, setAutoShutterEnabled] = useState(true);
  const [liveColorMode, setLiveColorMode] = useState<LiveColorMode>('color');
  const [liveFilterMenuOpen, setLiveFilterMenuOpen] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [mobileDocumentPolygon, setMobileDocumentPolygon] = useState<
    Array<{ x: number; y: number }> | null
  >(null);
  const [cameraFullscreenMode, setCameraFullscreenMode] = useState<ExamFullscreenMode>('none');
  const [liveScanGeometry, setLiveScanGeometry] = useState<CalifacilOmrScanGeometry | null>(null);
  const [liveScanPicks, setLiveScanPicks] = useState<(number | null)[]>([]);
  const [liveScanLockedRows, setLiveScanLockedRows] = useState<boolean[]>([]);
  const [liveScanAmbiguousRows, setLiveScanAmbiguousRows] = useState<boolean[]>([]);
  const [liveVideoLayout, setLiveVideoLayout] = useState<LiveVideoLetterbox | null>(null);
  const [liveShowBubbleOverlay, setLiveShowBubbleOverlay] = useState(false);
  const [cornersAlignedView, setCornersAlignedView] = useState(false);
  const [mobileSheetFillRatio, setMobileSheetFillRatio] = useState(0);
  const [mobileFiducialCount, setMobileFiducialCount] = useState(0);
  const [mobileFiducialCorners, setMobileFiducialCorners] = useState<
    [boolean, boolean, boolean, boolean]
  >([false, false, false, false]);
  const [mobileShadowWarning, setMobileShadowWarning] = useState(false);
  const [mobileStableTicks, setMobileStableTicks] = useState(0);
  const [cameraPortalReady, setCameraPortalReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const liveVideoLayoutRef = useRef<LiveVideoLetterbox | null>(null);
  const autoShutterEnabledRef = useRef(true);
  const flashModeRef = useRef<FlashMode>('auto');
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
  const smoothedRoiQuadRef = useRef<RoiQuad | null>(null);
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
  const [mobileCaptureReview, setMobileCaptureReview] = useState<MobileCaptureReviewState | null>(
    null
  );
  const [mobileReviewAlign, setMobileReviewAlign] = useState<MobileReviewAlignPreview | null>(
    null
  );
  const [reviewScanning, setReviewScanning] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const mobileCaptureBusyRef = useRef(false);
  const mobileReviewOpenRef = useRef(false);
  const reviewScanGenRef = useRef(0);
  const triggerMobileSheetCaptureRef = useRef<
    (
      video: HTMLVideoElement,
      opts?: { roiQuad?: RoiQuad | null; roiCapture?: MobileGuideRoiCapture | null }
    ) => void
  >(() => {});
  const phaseRef = useRef<Phase>('elegir');
  const presentInstantCaptureGradeRef = useRef<
    (draft: Record<string, string>, studentIdOverride?: string) => Promise<void>
  >(
    async () => {}
  );
  const finalizeCapturedSheetRef = useRef<
    (
      source: HTMLImageElement | HTMLCanvasElement,
      fallbackFile?: File,
      opts?: {
        skipReviewUi?: boolean;
        preWarped?: boolean;
        warpAlignment?: WarpAlignmentReport | null;
        skipSheetValidation?: boolean;
        precomputedDraft?: Record<string, string>;
        precomputedPicks?: (number | null)[];
        precomputedGeometry?: CalifacilOmrScanGeometry | null;
      }
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
  const expectedChunkPicksRef = useRef(expectedChunkPicks);
  useEffect(() => {
    expectedChunkPicksRef.current = expectedChunkPicks;
  }, [expectedChunkPicks]);
  const mobileAlignPreviewProp = useMemo(() => {
    if (!mobileReviewAlign) return null;
    const stats = gradeMcDraftAgainstKey(
      mobileReviewAlign.draft,
      questions,
      examVirtualKeyByQuestionId
    );
    return {
      geometry: mobileReviewAlign.geometry,
      picks: mobileReviewAlign.picks,
      expectedPicks: expectedChunkPicks,
      previewCanvas: mobileReviewAlign.warped,
      previewUrl: mobileReviewAlign.previewUrl,
      orangeFrameNorm: mobileReviewAlign.orangeFrameNorm,
      score: { correct: stats.correct, total: stats.total, pct: stats.pct },
    };
  }, [mobileReviewAlign, expectedChunkPicks, questions, examVirtualKeyByQuestionId]);
  const reviewOrangeFrameRect = useMemo(
    () =>
      reviewOmrGeometry
        ? califacilReviewOrangeFrameRect(reviewOmrGeometry, currentChunk.length)
        : null,
    [reviewOmrGeometry, currentChunk.length]
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
  const autoIdentifyByControl = useMemo(
    () => sortedStudents.some((s) => (s.control_number ?? '').replace(/\D/g, '').length > 0),
    [sortedStudents]
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

  const setTorchEnabled = useCallback(
    async (enabled: boolean) => {
      const ok = await setCameraTorch({
        streamRef,
        videoEl: videoRef.current,
        enabled,
      });
      if (ok) {
        setFlashOn(enabled);
        setFlashSupported(true);
        await attachStreamToVideo();
        updateLiveVideoLayout();
      }
      return ok;
    },
    [attachStreamToVideo, updateLiveVideoLayout]
  );

  useEffect(() => {
    liveVideoLayoutRef.current = liveVideoLayout;
  }, [liveVideoLayout]);

  const mobileAnswerSheetGuideRect = useMemo(() => {
    if (!liveVideoLayout) return null;
    return califacilMobileAnswerSheetGuideInViewportPx(liveVideoLayout);
  }, [liveVideoLayout]);

  useEffect(() => {
    autoShutterEnabledRef.current = autoShutterEnabled;
  }, [autoShutterEnabled]);

  useEffect(() => {
    flashModeRef.current = flashMode;
  }, [flashMode]);

  const applyFlashMode = useCallback(
    async (mode: FlashMode): Promise<boolean> => {
      if (mode === 'on') {
        autotorchTriedRef.current = true;
        return setTorchEnabled(true);
      }
      if (mode === 'off') {
        autotorchTriedRef.current = true;
        return setTorchEnabled(false);
      }
      autotorchTriedRef.current = false;
      shadowTorchTicksRef.current = 0;
      lowVisibilityTicksRef.current = 0;
      return setTorchEnabled(false);
    },
    [setTorchEnabled]
  );

  const cycleFlashMode = useCallback(async () => {
    const order: FlashMode[] = ['auto', 'on', 'off'];
    const idx = order.indexOf(flashModeRef.current);
    const next = order[(idx + 1) % order.length]!;
    setFlashMode(next);
    flashModeRef.current = next;
    if (next === 'on') {
      const ok = await applyFlashMode(next);
      if (!ok) {
        toast.error('No se pudo activar el flash en este dispositivo.');
      }
    } else {
      await applyFlashMode(next);
    }
  }, [applyFlashMode]);

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
    smoothedRoiQuadRef.current = null;
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
    setMobileDocumentPolygon(null);
    setLiveFilterMenuOpen(false);
    setLiveStatus(
      isMobile
        ? 'Coloca la hoja dentro del marco naranja de la cámara. La captura es automática.'
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
    mobileReviewOpenRef.current = false;
    setMobileCaptureReview(null);
    setMobileReviewAlign(null);
    setReviewScanning(false);
    setReviewStatus(null);
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
    setFlashMode('auto');
    flashModeRef.current = 'auto';
    setMobileDocumentPolygon(null);
    setLiveFilterMenuOpen(false);
    setCameraOpen(false);
    clearAutoSnapshot();
  }, [clearAutoSnapshot, setTorchEnabled]);

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
      opts?: {
        skipReviewUi?: boolean;
        preWarped?: boolean;
        warpAlignment?: WarpAlignmentReport | null;
        skipSheetValidation?: boolean;
        precomputedDraft?: Record<string, string>;
        precomputedPicks?: (number | null)[];
        precomputedGeometry?: CalifacilOmrScanGeometry | null;
      }
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
      const sheetLikely = examCanvas
        ? opts?.skipSheetValidation
          ? true
          : isMobileCamera && preWarped
            ? isCalifacilAnswerSheetReadyForGrading(
                examCanvas,
                omrCols,
                omrRowCount,
                opts?.warpAlignment
              )
            : isCalifacilExamSheetLikely(examCanvas, omrCols)
        : false;
      const sheetStrict = examCanvas ? isCalifacilExamSheetStrict(examCanvas, omrCols) : false;
      if (!examCanvas || !sheetLikely) {
        const mobileDiag =
          isMobileCamera && preWarped && examCanvas
            ? diagnoseCalifacilAnswerSheetReadiness(
                examCanvas,
                omrCols,
                omrRowCount,
                opts?.warpAlignment
              ).issues
            : [];
        const detail =
          mobileDiag.length > 0
            ? mobileDiag.slice(0, 2).join('; ')
            : 'Encuadra la hoja impresa con las esquinas y franjas negras.';
        setLiveStatus(
          isMobile
            ? `No se detectó una hoja CaliFacil válida. ${detail}`
            : 'No se detecta la tabla CaliFacil. Prueba una foto más nítida de la hoja completa o del pie con la tabla N.º / A–D.'
        );
        toast.error(
          isMobileCamera
            ? `No es una hoja CaliFacil válida. ${detail}`
            : isMobile
              ? 'No se reconoce el examen CaliFacil. Incluye la hoja impresa completa y que se vea el pie con las casillas A–D.'
              : 'No se reconoce el examen CaliFacil. Incluye bien la tabla del pie (página completa o solo el recuadro), buena luz y sin cortes.'
        );
        return { success: false };
      }

      if (opts?.precomputedDraft && preWarped && isMobileCamera && examCanvas) {
        const mergedDraft = opts.precomputedDraft;
        const picksInChunk =
          opts.precomputedPicks ??
          draftSelectionsToColumnPicks(chunk, mergedDraft).slice(0, chunk.length);
        const fullChunkDraft = buildMcDraftFromChunk(chunk, mergedDraft);
        let gradeStudentId = selectedStudentId;
        const controlRead = readAnswerSheetControlNumberFromCanvas(examCanvas, omrRowCount);
        if (controlRead.controlNumber) {
          setDetectedControlNumber(controlRead.controlNumber);
          const matched = findStudentByControlNumber(sortedStudents, controlRead.controlNumber);
          if (matched) {
            gradeStudentId = matched.id;
            setSelectedStudentId(matched.id);
            if (!skipReviewUi) {
              toast.success(`Alumno identificado (${controlRead.controlNumber}): ${matched.name}`);
            }
          } else if (!skipReviewUi) {
            toast.error(
              `El control ${controlRead.controlNumber} no coincide con ningún alumno del examen. Elige al alumno manualmente.`
            );
          }
        } else {
          setDetectedControlNumber(null);
        }
        let snapUrl: string | null = null;
        const snapSource = prepareAnswerSheetDisplayCanvas(examCanvas) ?? examCanvas;
        if (snapSource instanceof HTMLCanvasElement) {
          const blob = await new Promise<Blob | null>((resolve) => {
            snapSource.toBlob((b) => resolve(b), 'image/jpeg', 0.96);
          });
          if (blob) snapUrl = URL.createObjectURL(blob);
        }
        if (snapUrl && opts.precomputedGeometry) {
          let geom: CalifacilOmrScanGeometry;
          try {
            geom = structuredClone(opts.precomputedGeometry);
          } catch {
            geom = JSON.parse(JSON.stringify(opts.precomputedGeometry)) as CalifacilOmrScanGeometry;
          }
          setMobileSheetSnapshots((prev) => [
            ...prev,
            {
              sheetIndex: sheetIndexRef.current,
              previewUrl: snapUrl!,
              geometry: geom,
              questionIds: chunk.map((q) => q.id),
              selectionsByQuestionId: { ...fullChunkDraft },
              columnPicks: picksInChunk,
              answerSheetLayout: true,
              warpAlignment: opts?.warpAlignment,
            },
          ]);
        }
        try {
          await presentInstantCaptureGradeRef.current(fullChunkDraft, gradeStudentId || undefined);
        } catch {
          toast.error('No se pudo mostrar el resultado. Intenta de nuevo.');
          return { success: false };
        }
        return { success: true, chunkDraft: fullChunkDraft };
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

      if (
        isMobileCamera &&
        preWarped &&
        warpAlignment &&
        !warpAlignment.ok
      ) {
        toast.message(
          `Alineación aproximada (${warpAlignment.maxErrorPx.toFixed(0)} px). Calificando con plantilla.`
        );
      }

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

      let gradeStudentId = selectedStudentId;
      if (meta.controlNumber) {
        setDetectedControlNumber(meta.controlNumber);
        const matched = findStudentByControlNumber(sortedStudents, meta.controlNumber);
        if (matched) {
          gradeStudentId = matched.id;
          setSelectedStudentId(matched.id);
          if (!skipReviewUi) {
            toast.success(`Alumno identificado (${meta.controlNumber}): ${matched.name}`);
          }
        } else if (!skipReviewUi) {
          toast.error(
            `El control ${meta.controlNumber} no coincide con ningún alumno del examen. Elige al alumno manualmente.`
          );
        }
      } else {
        setDetectedControlNumber(null);
        const partialDigits = meta.controlNumberDigits.filter((d) => d !== null).length;
        if (partialDigits >= 4 && !skipReviewUi) {
          toast.message(
            'No se leyó completo el número de control. Puedes elegir al alumno manualmente.'
          );
        }
      }

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
              columnPicks: picksInChunk,
              answerSheetLayout: true,
              warpAlignment: OMR_DEBUG_ENABLED ? warpAlignment : undefined,
            },
          ]);
        }
        try {
          await presentInstantCaptureGradeRef.current(fullChunkDraft, gradeStudentId || undefined);
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
        setReviewOmrPicks(raw.slice(0, chunk.length));
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
    [exam, examId, isMobile, mapRawToDraft, omrCols, omrRowCount, selectedStudentId, setPreviewFromSource, sheets, sortedStudents, supportsCalifacil]
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
    if (!cameraOpen || mobileCaptureReview) return;
    const syncVideo = async () => {
      await attachStreamToVideo();
      updateLiveVideoLayout();
      await applyFlashMode(flashModeRef.current);
    };
    void syncVideo();
    const video = videoRef.current;
    if (!video) return;
    const onLoadedMetadata = () => {
      void syncVideo();
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [
    applyFlashMode,
    attachStreamToVideo,
    cameraOpen,
    mobileCaptureReview,
    updateLiveVideoLayout,
  ]);

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
    setReviewOmrPicks([]);
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
      setReviewOmrPicks([]);
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
      setReviewOmrPicks([]);
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
      const supportsTorch =
        trackReportsTorchCapability(track) || (isMobile && Boolean(track));
      setFlashSupported(isMobile || supportsTorch);
      if (flashModeRef.current !== 'on') {
        setFlashOn(false);
      }
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
        if (isMobile && mobileReviewOpenRef.current) {
          scheduleLiveScan(300);
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
              smoothedRoiQuadRef.current = null;
              lastRoiCaptureMetaRef.current = null;
              nextDelay = 200;
              setLiveStatus('Mejora la iluminación o activa el flash.');
              return;
            }

            const roiQuadRaw = detectLargestQuadInRoiCanvas(roiCanvas);
            const roiW = roiCanvas.width;
            const roiH = roiCanvas.height;
            const quadValid =
              roiQuadRaw !== null && isValidMobileRoiQuad(roiQuadRaw, roiW, roiH);
            const roiQuad =
              quadValid && roiQuadRaw
                ? smoothMobileRoiQuad(smoothedRoiQuadRef.current, roiQuadRaw, 0.48)
                : null;
            if (quadValid && roiQuad) {
              smoothedRoiQuadRef.current = roiQuad;
              lastRoiCaptureMetaRef.current = roiCapture;
            }
            const layout = liveVideoLayoutRef.current;
            const fillRatio =
              roiQuad !== null ? measureRoiSheetFillRatio(roiQuad, roiW, roiH) : 0;
            const fiducialCorners = detectAnswerSheetFiducialsInRoi(roiCanvas, roiQuad);
            const fiducialCount = fiducialCorners.filter(Boolean).length;
            if (roiCapture && layout) {
              if (quadValid && roiQuad) {
                setMobileDocumentPolygon(
                  mapRoiQuadPolygonToViewportPx(roiQuad, roiCapture, layout)
                );
              } else {
                setMobileDocumentPolygon(null);
              }
            } else {
              setMobileDocumentPolygon(null);
            }
            const shadowAsym = estimateCanvasShadowAsymmetry(roiCanvas);
            const shadowStrong = shadowAsym >= SHADOW_ASYMMETRY_TORCH;

            setMobileSheetFillRatio(fillRatio);
            setMobileFiducialCount(fiducialCount);
            setMobileFiducialCorners(fiducialCorners);
            setMobileShadowWarning(shadowStrong);

            if (shadowStrong && flashSupported && flashModeRef.current === 'auto' && !flashOn && !autotorchTriedRef.current) {
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
              smoothedRoiQuadRef.current = null;
              lastRoiCaptureMetaRef.current = null;
              setCornersAlignedView(false);
              lowVisibilityTicksRef.current += 1;
              if (
                flashSupported &&
                flashModeRef.current === 'auto' &&
                !flashOn &&
                !autotorchTriedRef.current &&
                lowVisibilityTicksRef.current >= LOW_VISIBILITY_AUTOTORCH_TICKS
              ) {
                autotorchTriedRef.current = true;
                void setTorchEnabled(true);
                setLiveStatus('Activé el flash. Encuadra la hoja dentro del rectángulo.');
              } else {
                setLiveStatus('Encuadra la tabla dentro del marco naranja.');
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
                fillRatio < 0.12
                  ? 'Acerca un poco el teléfono o pulsa Capturar.'
                  : 'Centra la hoja en el marco o pulsa Capturar.'
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
                'Coloca la hoja impresa: deben verse las esquinas negras y las franjas laterales.'
              );
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            if (!lastRoiQuadRef.current) {
              lastRoiQuadRef.current = roiQuad;
              cornerStableTicksRef.current = 1;
              setMobileStableTicks(1);
              setCornersAlignedView(true);
              setLiveStatus('Hoja detectada — pulsa Capturar cuando esté bien encuadrada.');
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
              const secsLeft = Math.max(
                1,
                Math.ceil(
                  ((CORNER_ALIGN_STABLE_TICKS - cornerStableTicksRef.current) *
                    MOBILE_CORNER_LOOP_MS) /
                    1000
                )
              );
              setLiveStatus(
                `Hoja detectada — pulsa Capturar o espera ~${secsLeft} s`
              );
              nextDelay = MOBILE_CORNER_LOOP_MS;
              return;
            }

            if (
              autoShutterEnabledRef.current &&
              !mobileCaptureBusyRef.current &&
              cornerStableTicksRef.current >= CORNER_ALIGN_STABLE_TICKS
            ) {
              const captureQuad = smoothedRoiQuadRef.current ?? lastRoiQuadRef.current;
              const captureRoi = lastRoiCaptureMetaRef.current;
              cornerStableTicksRef.current = 0;
              setMobileStableTicks(0);
              triggerMobileSheetCaptureRef.current(video, {
                roiQuad: captureQuad,
                roiCapture: captureRoi,
              });
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
              flashModeRef.current === 'auto' &&
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
            flashModeRef.current === 'auto' &&
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
    omrRowCount,
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
      setReviewOmrPicks([]);
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
          columnPicks: reviewOmrPicks.slice(0, chunk.length),
        },
      ]);
    };

    await pushMobileSheetSnapshot();

    if (!isLast) {
      setSheetIndex((s) => s + 1);
      setReviewOmrGeometry(null);
      setReviewOmrPicks([]);
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

  const persistStudentAnswers = async (
    merged: Record<string, string>,
    studentIdOverride?: string
  ) => {
    const studentId = studentIdOverride ?? selectedStudentId;
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
    async (fullDraft: Record<string, string>, studentIdOverride?: string) => {
      const stats = gradeMcDraftAgainstKey(fullDraft, questions, examVirtualKeyByQuestionId);
      setAutoGradeStats(stats);
      setMobileResultsDraft({ ...fullDraft });

      const studentId =
        studentIdOverride && sortedStudents.some((s) => s.id === studentIdOverride)
          ? studentIdOverride
          : selectedStudentId;
      const canPersist =
        Boolean(studentId) &&
        sortedStudents.some((s) => s.id === studentId) &&
        canGradeStudents;

      let persisted = false;
      if (canPersist) {
        try {
          await persistStudentAnswers(fullDraft, studentId);
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
        toast.message(
          studentId
            ? 'Resultado calculado. Las casillas sin marcar cuentan como incorrectas.'
            : 'Resultado calculado. Marca el número de control en la hoja o elige al alumno para guardar.'
        );
      }

      setAutoGradePersisted(persisted);
      stopLiveCamera();

      if (isMobile) {
        setPhase('ver_resultados');
        setResultsSheetIdx(0);
        toast.success(
          `${stats.pct}% · ${stats.correct}/${stats.total} aciertos`,
          { description: persisted ? 'Guardado en la nube.' : 'Revisa y guarda si hace falta.' }
        );
      } else {
        setAutoGradeDialogOpen(true);
        setPhase('elegir');
        setSheetIndex(0);
        setConfirmedByQuestionId({});
        confirmedAnswersRef.current = {};
        setDraftSelections({});
        setPreviewUrl((u) => {
          if (u) URL.revokeObjectURL(u);
          return null;
        });
      }

      setLiveDraftSelections({});
      setLiveResolvedCount(0);
      liveLockedAnswersRef.current = {};
      setReviewOmrGeometry(null);
      setReviewOmrPicks([]);
      setReviewQualityHint(null);
    },
    [
      canGradeStudents,
      examVirtualKeyByQuestionId,
      isMobile,
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

  const processMobileSheetCapture = useCallback(
    async (
      video: HTMLVideoElement,
      opts?: { roiQuad?: RoiQuad | null; roiCapture?: MobileGuideRoiCapture | null }
    ) => {
      void setTorchEnabled(false);
      setFlashOn(false);

      const fullCanvas = captureVideoFullFrame(video, { maxSide: MOBILE_CAPTURE_MAX_SIDE });
      if (!fullCanvas) {
        toast.error('No se pudo capturar el fotograma. Intenta de nuevo.');
        setLiveStatus('Error de cámara. Pulsa Capturar de nuevo.');
        return;
      }

      let roiCapture = opts?.roiCapture ?? lastRoiCaptureMetaRef.current;
      let roiQuad = opts?.roiQuad ?? smoothedRoiQuadRef.current ?? lastRoiQuadRef.current;
      if (!roiCapture) {
        roiCapture = captureVideoGuideRoiFrame(video, { maxSide: MOBILE_ROI_DETECT_MAX_SIDE });
      }
      if (!roiQuad && roiCapture) {
        const detected = detectLargestQuadInRoiCanvas(roiCapture.roiCanvas);
        if (
          detected &&
          isValidMobileRoiQuad(detected, roiCapture.roiCanvas.width, roiCapture.roiCanvas.height)
        ) {
          roiQuad = smoothMobileRoiQuad(null, detected, 0.5);
        }
      }

      let warped: HTMLCanvasElement | null = null;
      let alignment: WarpAlignmentReport | null = null;
      if (roiCapture && roiQuad) {
        ({ warped, alignment } = warpMobileCaptureWithFallback(fullCanvas, roiQuad, roiCapture));
      }
      if (!warped) {
        const warpedOnly = warpCalifacilSheetFromCornerMarkers(fullCanvas);
        if (!warpedOnly) {
          toast.error('No se detectó la hoja. Encuadra la página completa e intenta de nuevo.');
          setLiveStatus('No se detectó la hoja. Ajusta el encuadre y pulsa Capturar.');
          return;
        }
        const refined = refineWarpedCalifacilSheet(warpedOnly, {
          maxAllowedPx: MOBILE_WARP_FALLBACK_MAX_ERROR_PX,
          fast: false,
        });
        warped = refined.canvas;
        alignment = refined.alignment;
      } else {
        const refined = refineWarpedCalifacilSheet(warped, {
          maxAllowedPx: MOBILE_WARP_FALLBACK_MAX_ERROR_PX,
          fast: false,
        });
        warped = refined.canvas;
        alignment = refined.alignment;
      }

      const frameQuad =
        roiCapture && roiQuad
          ? frameQuadOnFullCanvas(roiQuad, roiCapture, fullCanvas)
          : defaultDocumentQuad(fullCanvas.width, fullCanvas.height);

      playAutoCaptureClickSound();
      mobileReviewOpenRef.current = true;
      setMobileCaptureReview({
        sourceCanvas: fullCanvas,
        frameQuad,
        warped,
        alignment,
      });
    },
    [setTorchEnabled]
  );

  const retakeMobileCaptureReview = useCallback(() => {
    reviewScanGenRef.current += 1;
    mobileReviewOpenRef.current = false;
    setMobileCaptureReview(null);
    setMobileReviewAlign(null);
    setReviewScanning(false);
    setReviewStatus(null);
    setLiveStatus('Encuadra la hoja y pulsa el botón blanco para calificar');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (streamRef.current) {
          void (async () => {
            await attachStreamToVideo();
            updateLiveVideoLayout();
            await applyFlashMode(flashModeRef.current);
          })();
        } else if (phaseRef.current === 'capturar') {
          void startLiveCamera({ skipPhaseGuard: true });
        }
      });
    });
  }, [applyFlashMode, attachStreamToVideo, startLiveCamera, updateLiveVideoLayout]);

  const previewMobileCaptureAlignment = useCallback(
    async (warped: HTMLCanvasElement, alignment: WarpAlignmentReport | null) => {
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) {
        setReviewStatus('No hay preguntas en esta hoja.');
        toast.error('No hay preguntas en esta hoja.');
        return;
      }
      const scanGen = ++reviewScanGenRef.current;
      flushSync(() => {
        setReviewScanning(true);
        setReviewStatus('Leyendo respuestas…');
      });
      try {
        await yieldForSpinnerPaint();
        if (scanGen !== reviewScanGenRef.current) return;
        const scanCanvas = downscaleCanvasForOmrScan(warped, 1200);
        const { meta, orangeFrameNorm } = scanWarpedWithBestTableFrame(
          scanCanvas,
          omrCols,
          omrRowCount
        );
        if (scanGen !== reviewScanGenRef.current) return;
        const controlRead = readAnswerSheetControlNumberFromCanvas(warped, omrRowCount);
        if (controlRead.controlNumber) {
          setDetectedControlNumber(controlRead.controlNumber);
          const matched = findStudentByControlNumber(sortedStudents, controlRead.controlNumber);
          if (matched) {
            setSelectedStudentId(matched.id);
            toast.success(`Alumno identificado (${controlRead.controlNumber}): ${matched.name}`);
          } else {
            toast.error(
              `El control ${controlRead.controlNumber} no coincide con ningún alumno. Elige al alumno manualmente.`
            );
          }
        } else {
          setDetectedControlNumber(null);
        }
        const mapped = mapRawToDraft([...meta.picks], chunk);
        if (!meta.geometry) {
          setReviewStatus('No se alineó la tabla. Usa Ajustar y corrige las esquinas.');
          toast.error('No se alineó la tabla. Usa Ajustar y corrige las esquinas.');
          return;
        }
        const previewUrl = canvasPreviewDataUrl(scanCanvas, 1200) ?? '';
        setMobileReviewAlign({
          warped,
          alignment,
          geometry: meta.geometry,
          picks: [...meta.picks],
          draft: mapped.draft,
          previewUrl,
          orangeFrameNorm,
        });
        setReviewStatus(null);
      } catch {
        if (scanGen !== reviewScanGenRef.current) return;
        setReviewStatus('Error al leer la hoja. Intenta Ajustar las esquinas.');
        toast.error('No se pudo leer la hoja. Intenta ajustar las esquinas.');
      } finally {
        if (scanGen === reviewScanGenRef.current) setReviewScanning(false);
      }
    },
    [mapRawToDraft, omrCols, omrRowCount, sheets, sortedStudents]
  );

  const realignMobileCaptureOrangeFrame = useCallback(
    async (frame: OmrNormRect) => {
      if (!mobileReviewAlign) return;
      const chunk = sheets[sheetIndexRef.current] ?? [];
      if (chunk.length === 0) return;
      const scanGen = ++reviewScanGenRef.current;
      setReviewScanning(true);
      setReviewStatus('Actualizando lectura…');
      try {
        await yieldForSpinnerPaint();
        if (scanGen !== reviewScanGenRef.current) return;
        const scanCanvas = downscaleCanvasForOmrScan(mobileReviewAlign.warped, 1200);
        const controlRead = readAnswerSheetControlNumberFromCanvas(mobileReviewAlign.warped, omrRowCount);
        if (controlRead.controlNumber) {
          setDetectedControlNumber(controlRead.controlNumber);
          const matched = findStudentByControlNumber(sortedStudents, controlRead.controlNumber);
          if (matched) setSelectedStudentId(matched.id);
        }
        const meta = scanWarpedWithNormTableFrame(scanCanvas, omrCols, omrRowCount, frame);
        if (scanGen !== reviewScanGenRef.current) return;
        const mapped = mapRawToDraft([...meta.picks], chunk);
        if (!meta.geometry) {
          setReviewStatus('No se pudo leer con ese marco. Ajusta las esquinas.');
          return;
        }
        const previewUrl = canvasPreviewDataUrl(scanCanvas, 1200) ?? mobileReviewAlign.previewUrl;
        setMobileReviewAlign({
          ...mobileReviewAlign,
          geometry: meta.geometry,
          picks: [...meta.picks],
          draft: mapped.draft,
          previewUrl,
          orangeFrameNorm: frame,
        });
        setReviewStatus(null);
      } catch {
        if (scanGen !== reviewScanGenRef.current) return;
        setReviewStatus('Error al releer. Intenta mover el marco de nuevo.');
      } finally {
        if (scanGen === reviewScanGenRef.current) setReviewScanning(false);
      }
    },
    [mapRawToDraft, mobileReviewAlign, omrCols, omrRowCount, sheets, sortedStudents]
  );

  const finalizeMobileReviewGrade = useCallback(async () => {
    if (!mobileReviewAlign) return;
    setReviewScanning(true);
    setReviewStatus('Calificando…');
    try {
      const result = await finalizeCapturedSheet(mobileReviewAlign.warped, undefined, {
        preWarped: true,
        warpAlignment: mobileReviewAlign.alignment,
        skipReviewUi: true,
        skipSheetValidation: true,
        precomputedDraft: mobileReviewAlign.draft,
        precomputedPicks: mobileReviewAlign.picks,
        precomputedGeometry: mobileReviewAlign.geometry,
      });
      if (result.success) {
        playScanCompleteChime();
        mobileReviewOpenRef.current = false;
        setMobileCaptureReview(null);
        setMobileReviewAlign(null);
        setReviewStatus(null);
        stopLiveCamera();
      } else {
        setReviewStatus('No se pudo calificar. Ajusta el encuadre e intenta de nuevo.');
        toast.error('No se pudo calificar. Ajusta el encuadre e intenta de nuevo.');
      }
    } finally {
      setReviewScanning(false);
    }
  }, [finalizeCapturedSheet, mobileReviewAlign, stopLiveCamera]);

  const backFromMobileReviewAlign = useCallback(() => {
    reviewScanGenRef.current += 1;
    setMobileReviewAlign(null);
    setReviewScanning(false);
    setReviewStatus(null);
  }, []);

  const triggerMobileSheetCapture = useCallback(
    (
      video: HTMLVideoElement,
      opts?: { roiQuad?: RoiQuad | null; roiCapture?: MobileGuideRoiCapture | null; force?: boolean }
    ) => {
      if (mobileCaptureBusyRef.current && !opts?.force) return;
      mobileCaptureBusyRef.current = true;
      setScanBusy(true);
      setLiveFilterMenuOpen(false);
      void (async () => {
        try {
          await processMobileSheetCapture(video, opts);
        } catch {
          toast.error('Error al capturar. Intenta de nuevo.');
        } finally {
          mobileCaptureBusyRef.current = false;
          setScanBusy(false);
        }
      })();
    },
    [processMobileSheetCapture]
  );

  triggerMobileSheetCaptureRef.current = triggerMobileSheetCapture;

  useEffect(() => {
    if (!scanBusy) return;
    const timeout = window.setTimeout(() => {
      if (mobileCaptureBusyRef.current) {
        mobileCaptureBusyRef.current = false;
        setScanBusy(false);
        toast.error('La captura tardó demasiado. Pulsa Capturar de nuevo.');
        setLiveStatus('Tiempo agotado. Pulsa Capturar de nuevo.');
      }
    }, 45000);
    return () => window.clearTimeout(timeout);
  }, [scanBusy]);

  const captureMobilePhotoManually = useCallback(() => {
    if (!isMobile) return;
    const video = videoRef.current;
    if (!video) {
      toast.error('Cámara no disponible.');
      return;
    }
    if (video.readyState < 2 || video.videoWidth < 40) {
      toast.error('La cámara está iniciando. Espera un segundo.');
      return;
    }
    setShutterFlash(true);
    window.setTimeout(() => setShutterFlash(false), 220);
    playAutoCaptureClickSound();
    mobileCaptureBusyRef.current = false;
    setScanBusy(false);
    triggerMobileSheetCapture(video, {
      roiQuad: smoothedRoiQuadRef.current ?? lastRoiQuadRef.current,
      roiCapture: lastRoiCaptureMetaRef.current,
      force: true,
    });
  }, [isMobile, triggerMobileSheetCapture]);

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
    setReviewOmrPicks([]);
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
                  placeholder={
                    autoIdentifyByControl
                      ? 'Opcional si marcas el número de control'
                      : 'Busca y elige al alumno'
                  }
                  searchPlaceholder="Escribe para buscar…"
                  emptyText="Ningún alumno coincide."
                  noStudentsText={
                    exam && allowedGroupIds.length === 0
                      ? 'Este examen no tiene grupo asignado. Asigna un grupo al examen y registra alumnos en Grupos.'
                      : undefined
                  }
                />
                {detectedControlNumber ? (
                  <p className="text-xs text-green-700">
                    N.º de control leído: <strong>{detectedControlNumber}</strong>
                    {selectedStudentName ? ` — ${selectedStudentName}` : ''}
                  </p>
                ) : null}
                <p className="text-xs text-gray-500">
                  {canGradeStudents
                    ? autoIdentifyByControl
                      ? 'Marca el número de control en la hoja de respuestas y CaliFacil identificará al alumno al escanear. También puedes elegirlo aquí.'
                      : 'La comparación se hace automáticamente contra la tabla clave generada por el sistema.'
                    : 'Bloqueado: el examen necesita respuestas correctas válidas para generar la clave automática.'}
                </p>
              </div>

              {isMobile && canGradeStudents && (selectedStudentId || autoIdentifyByControl) && phase === 'elegir' && (
                <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50/90 p-3">
                  <p className="text-sm font-medium text-orange-950">
                    Listo para hoja {sheetIndex + 1} de {totalSheets}
                  </p>
                  <p className="text-xs text-orange-900/90">
                    {autoIdentifyByControl ? (
                      <>
                        Marca el <strong>número de control</strong> en la hoja. Pulsa <strong>Tomar foto</strong>,
                        encuadra la página y captura con el botón blanco — califica al instante.
                      </>
                    ) : (
                      <>
                        Pulsa <strong>Tomar foto</strong>, encuadra la hoja y captura con el botón blanco.
                        CaliFacil la endereza, lee las respuestas y muestra el resultado al momento.
                      </>
                    )}
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
        !mobileCaptureReview &&
        exam &&
        cameraPortalReady &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={mobileCameraShellRef}
            className={cn(
              'fixed inset-0 z-[200] bg-black text-white',
              cameraFullscreenMode === 'pseudo' && EXAM_PSEUDO_FULLSCREEN_CLASS,
              cameraFullscreenMode === 'pseudo' && '!bg-black'
            )}
          >
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleGalleryFile}
            />

            <div ref={mobileVideoViewportRef} className="relative h-[100dvh] w-full overflow-hidden bg-black">
              {!cameraOpen ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
                  <div className="flex items-center gap-2 text-sm text-white/80">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Abriendo cámara…
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
                  <div className="relative h-full w-full">
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
                    {mobileAnswerSheetGuideRect ? (
                      <>
                        <div className="pointer-events-none absolute inset-0 z-[10] bg-black/32" aria-hidden />
                        <MobileAnswerSheetAlignGuideOverlay
                          guideRect={mobileAnswerSheetGuideRect}
                          aligned={cornersAlignedView}
                        />
                        <p
                          className="pointer-events-none absolute left-1/2 z-[20] w-[min(92%,18rem)] -translate-x-1/2 rounded-lg bg-black/55 px-3 py-2 text-center text-[13px] font-medium leading-snug text-white/95 backdrop-blur-sm"
                          style={{ top: Math.max(56, mobileAnswerSheetGuideRect.top - 52) }}
                        >
                          {cornersAlignedView
                            ? 'Hoja detectada — pulsa el botón blanco para capturar'
                            : 'Encuadra la tabla dentro del marco naranja'}
                        </p>
                      </>
                    ) : null}
                    <IosCaptureFlashOverlay active={shutterFlash} />
                  </div>

                  <button
                    type="button"
                    className="absolute left-3 z-[70] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
                    style={{ top: 'max(0.65rem, env(safe-area-inset-top, 0px))' }}
                    aria-label="Cerrar cámara"
                    disabled={scanBusy}
                    onClick={() => {
                      stopLiveCamera();
                      setPhase('elegir');
                    }}
                  >
                    <X className="h-5 w-5" strokeWidth={2.5} />
                  </button>

                  {scanBusy ? (
                    <div className="pointer-events-none absolute inset-0 z-[65] flex items-center justify-center bg-black/35">
                      <Loader2
                        className="h-10 w-10 animate-spin text-white motion-reduce:animate-none [animation-duration:750ms]"
                        aria-hidden
                      />
                    </div>
                  ) : null}

                  <div
                    className="absolute inset-x-0 bottom-0 z-[70] flex flex-col items-center pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-10"
                    style={{
                      background:
                        'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)',
                    }}
                  >
                    <div className="mb-4 flex w-full max-w-xs items-end justify-between px-8">
                      <button
                        type="button"
                        className="relative flex flex-col items-center gap-1.5 text-[11px] font-medium text-white active:scale-95 transition-transform"
                        style={{ touchAction: 'manipulation' }}
                        aria-label="Flash"
                        onClick={() => {
                          void cycleFlashMode();
                        }}
                      >
                        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20 backdrop-blur-md">
                          <Zap
                            className={cn(
                              'h-[1.35rem] w-[1.35rem]',
                              (flashOn || flashMode === 'on') && 'fill-yellow-300 text-yellow-300'
                            )}
                          />
                          {flashMode === 'auto' ? (
                            <span className="absolute bottom-0.5 right-0.5 text-[10px] font-bold leading-none text-white/90">
                              A
                            </span>
                          ) : null}
                        </span>
                        Flash
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          className="flex flex-col items-center gap-1.5 text-[11px] font-medium text-white active:scale-95 transition-transform"
                          disabled={scanBusy}
                          aria-label="Filtros"
                          onClick={() => setLiveFilterMenuOpen((v) => !v)}
                        >
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20 backdrop-blur-md">
                            <Palette className="h-[1.35rem] w-[1.35rem]" />
                          </span>
                          Filtros
                        </button>
                        {liveFilterMenuOpen ? (
                          <div className="absolute bottom-full left-1/2 z-20 mb-2 w-40 -translate-x-1/2 rounded-2xl border border-white/15 bg-black/80 p-1.5 shadow-2xl backdrop-blur-xl">
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
                                  'block w-full rounded-xl px-3 py-2.5 text-left text-sm text-white',
                                  liveColorMode === id ? 'bg-white/20 font-semibold' : 'active:bg-white/10'
                                )}
                                onClick={() => {
                                  setLiveColorMode(id);
                                  setLiveFilterMenuOpen(false);
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
                        className="relative flex flex-col items-center gap-1.5 text-[11px] font-medium text-white active:scale-95 transition-transform"
                        disabled={scanBusy}
                        aria-label="Obturador automático"
                        onClick={() => setAutoShutterEnabled((v) => !v)}
                      >
                        <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/12 ring-1 ring-white/20 backdrop-blur-md">
                          <Camera className="h-[1.35rem] w-[1.35rem]" />
                          {autoShutterEnabled ? (
                            <span className="absolute bottom-0.5 right-0.5 text-[10px] font-bold leading-none text-white/90">
                              A
                            </span>
                          ) : null}
                        </span>
                        Obturador
                      </button>
                    </div>

                    <p className="mb-4 rounded-full bg-black/50 px-4 py-1 text-xs font-medium text-white/90 backdrop-blur-md">
                      {liveColorMode === 'color'
                        ? 'Color'
                        : liveColorMode === 'grayscale'
                          ? 'Escala grises'
                          : 'Blanco y negro'}
                    </p>

                    <button
                      type="button"
                      className={cn(
                        'flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.35)] transition-transform active:scale-90 disabled:opacity-50',
                        scanBusy && 'scale-95 opacity-70'
                      )}
                      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                      disabled={scanBusy}
                      aria-label="Capturar"
                      onClick={(e) => {
                        e.preventDefault();
                        captureMobilePhotoManually();
                      }}
                    >
                      <span className="block h-[4rem] w-[4rem] rounded-full border-[3px] border-black/10 bg-white" />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body
        )}

      {mobileCaptureReview &&
        typeof document !== 'undefined' &&
        createPortal(
          <MobileSheetScanReview
            sourceCanvas={mobileCaptureReview.sourceCanvas}
            frameQuad={mobileCaptureReview.frameQuad}
            initialWarped={mobileCaptureReview.warped}
            initialAlignment={mobileCaptureReview.alignment}
            initialFilter={liveColorMode}
            rowCount={currentChunk.length}
            columnCount={omrCols}
            alignPreview={mobileAlignPreviewProp}
            alignOrangeFrame={mobileReviewAlign?.orangeFrameNorm ?? null}
            scanning={reviewScanning}
            statusMessage={reviewStatus}
            onRetake={retakeMobileCaptureReview}
            onPreviewAlignment={(warped, alignment) =>
              void previewMobileCaptureAlignment(warped, alignment)
            }
            onRealignOrangeFrame={(frame) => void realignMobileCaptureOrangeFrame(frame)}
            onFinalizeGrade={() => void finalizeMobileReviewGrade()}
            onBackFromAlign={backFromMobileReviewAlign}
            detectedControlNumber={detectedControlNumber}
            identifiedStudentName={selectedStudentName || null}
          />,
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
                      <span className="font-medium text-orange-700">naranja</span> = burbuja correcta esperada,
                      <span className="font-medium text-red-600"> rojo punteado</span> = sin lectura en esa fila.
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
                      setReviewOmrPicks([]);
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
                  chunk.length
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
                const tabPicks =
                  snap.columnPicks.length > 0
                    ? snap.columnPicks
                    : draftSelectionsToColumnPicks(chunk, mobileResultsDraft);
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
                          Verde = acierto, rojo = opción leída incorrecta, círculo naranja = respuesta correcta esperada, rojo punteado = sin lectura.
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
