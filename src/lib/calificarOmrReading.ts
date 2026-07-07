import { CALIFACIL_VISION_POLICY } from '@/lib/califacilVisionPolicy';
import {
  mapOmrPicksToMcDraftDetailed,
} from '@/lib/calificarGrading';
import {
  autoOrientCalifacilSheet,
  califacilImageToJpegDataUrl,
  isAnswerSheetOmrMostlyBlank,
  scanCalifacilDesktopGradeDocument,
  scanCalifacilOmrSheetWithMeta,
  scanWarpedMobileCaptureSheet,
  syncCalifacilOmrGeometryImageSize,
  type OmrScanMetaResult,
  type WarpAlignmentReport,
} from '@/lib/omrScan';
import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import type { Question } from '@/types';

export const CALIFACIL_MIN_AUTO_READ_RATIO = 0.9;
export const CALIFACIL_AMBIGUOUS_ROW_WARN_RATIO = 0.35;

export type CalifacilOmrReadingInput = {
  source: HTMLImageElement | HTMLCanvasElement;
  oriented: HTMLImageElement | HTMLCanvasElement;
  chunk: Question[];
  examId: string;
  omrCols: number;
  omrRowCount: number;
  chunkQuestionOffset: number;
  preWarped: boolean;
  isMobileCamera: boolean;
  isMobile: boolean;
  fallbackFile?: File;
  skipReviewUi?: boolean;
  sheetStrict: boolean;
  preserveCapturedFrame: boolean;
  includeWarpAlignment?: boolean;
  warpAlignment?: WarpAlignmentReport | null;
  liveLockedAnswers: Record<string, string>;
};

export type CalifacilOmrReadingResult = {
  meta: OmrScanMetaResult;
  raw: (number | null)[];
  mapped: ReturnType<typeof mapOmrPicksToMcDraftDetailed> & {
    draft: Record<string, string>;
    unresolvedCount: number;
    resolvedCount: number;
  };
  mergedDraft: Record<string, string>;
  mergedResolved: number;
  picksInChunk: (number | null)[];
  activeScanSource: HTMLImageElement | HTMLCanvasElement;
  warpAlignment: WarpAlignmentReport | null;
  mostlyBlank: boolean;
  minResolved: number;
  ambiguousIdx: number[];
  insufficientForReview: boolean;
  updatedLiveLocks: Record<string, string>;
};

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
  const timeoutId =
    typeof window !== 'undefined' ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    return await fetch('/api/calificar/vision-omr', {
      method: 'POST',
      headers: { ...headers },
      credentials: 'include',
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    if (typeof window !== 'undefined') window.clearTimeout(timeoutId);
  }
}

function mapRawToDraftDetailed(raw: (number | null)[], chunk: Question[]) {
  const mapped = mapOmrPicksToMcDraftDetailed(chunk, raw);
  return {
    ...mapped,
    draft: mapped.draft,
    unresolvedCount: mapped.unresolvedCount,
    resolvedCount: mapped.resolvedCount,
  };
}

async function applyVisionSelections(
  raw: (number | null)[],
  chunk: Question[],
  indices: number[],
  selections: Record<string, string> | undefined
): Promise<void> {
  if (!selections) return;
  for (const i of indices) {
    const q = chunk[i];
    if (!q) continue;
    const text = (selections[q.id] ?? '').trim();
    const opts = q.options ?? [];
    if (text && opts.includes(text)) {
      raw[i] = opts.indexOf(text);
    }
  }
}

/**
 * Pipeline compartido desktop/móvil: scan OMR + recovery + visión asistida → picks/draft enriquecidos.
 * CalifacilOmrReviewOverlay solo consume el resultado; no califica por sí mismo.
 */
export async function runCalifacilOmrReadingPipeline(
  input: CalifacilOmrReadingInput
): Promise<CalifacilOmrReadingResult> {
  const {
    source,
    oriented,
    chunk,
    examId,
    omrCols,
    omrRowCount,
    chunkQuestionOffset,
    preWarped,
    isMobileCamera,
    isMobile,
    fallbackFile,
    sheetStrict,
    preserveCapturedFrame,
  } = input;

  const useFixedTemplate =
    preWarped && isMobileCamera ? true : isMobileCamera ? sheetStrict : Boolean(fallbackFile);

  let activeScanSource: HTMLImageElement | HTMLCanvasElement = oriented;
  let meta: OmrScanMetaResult;
  if (oriented instanceof HTMLCanvasElement && (Boolean(fallbackFile) || preWarped)) {
    meta = scanCalifacilDesktopGradeDocument(oriented, omrCols, omrRowCount);
    if (preWarped) {
      const resolved = meta.picks.filter((p) => p !== null).length;
      const minRecovery = Math.max(1, Math.ceil(omrRowCount * 0.45));
      if (resolved < minRecovery) {
        const recovery = scanWarpedMobileCaptureSheet(oriented, omrCols, omrRowCount);
        const recoveryResolved = recovery.picks.filter((p) => p !== null).length;
        if (recoveryResolved > resolved) {
          meta = recovery;
          if (meta.geometry && meta.reviewSourceCanvas) {
            meta = {
              ...meta,
              geometry: syncCalifacilOmrGeometryImageSize(
                meta.geometry,
                meta.reviewSourceCanvas.width,
                meta.reviewSourceCanvas.height
              ),
            };
          }
        }
      }
    }
  } else {
    meta = scanCalifacilOmrSheetWithMeta(activeScanSource, omrCols, {
      skipGuideCrop: true,
      geometryMode:
        isMobileCamera
          ? 'auto'
          : fallbackFile
            ? 'fullSheet'
            : isMobile
              ? 'fullSheet'
              : 'auto',
      preserveInputCanvas: isMobileCamera ? false : preserveCapturedFrame,
      fixedTemplateAnchor: useFixedTemplate,
      answerSheetTemplateOnly: false,
      rowCount: omrRowCount,
      includeWarpAlignment: Boolean(input.includeWarpAlignment) || Boolean(input.warpAlignment),
    });
  }

  const warpAlignment = input.warpAlignment ?? meta.warpAlignment ?? null;

  let raw = [...meta.picks];
  let mapped = mapRawToDraftDetailed(raw, chunk);
  const minResolved = Math.max(1, Math.ceil(chunk.length * CALIFACIL_MIN_AUTO_READ_RATIO));
  let mostlyBlank = isAnswerSheetOmrMostlyBlank(meta, chunk.length);

  if (mostlyBlank) {
    raw = raw.map(() => null);
    mapped = mapRawToDraftDetailed(raw, chunk);
  }

  if (isMobile && mapped.resolvedCount < minResolved && !(preWarped && isMobileCamera)) {
    const recoverySource =
      autoOrientCalifacilSheet(source, omrCols, {
        useGuideCrop: false,
        allowTiltSweep: true,
      }) ?? oriented;

    const recoveryMeta = scanCalifacilOmrSheetWithMeta(recoverySource, omrCols, {
      skipGuideCrop: true,
      geometryMode: isMobileCamera
        ? 'auto'
        : fallbackFile
          ? 'fullSheet'
          : isMobile
            ? 'fullSheet'
            : 'auto',
      preserveInputCanvas: false,
      fixedTemplateAnchor: useFixedTemplate,
      rowCount: omrRowCount,
    });
    const recoveryRaw = [...recoveryMeta.picks];
    const recoveryMapped = mapRawToDraftDetailed(recoveryRaw, chunk);

    if (recoveryMapped.resolvedCount > mapped.resolvedCount) {
      meta = recoveryMeta;
      raw = recoveryRaw;
      mapped = recoveryMapped;
      activeScanSource = recoverySource;
      mostlyBlank = isAnswerSheetOmrMostlyBlank(meta, chunk.length);
      if (mostlyBlank) {
        raw = raw.map(() => null);
        mapped = mapRawToDraftDetailed(raw, chunk);
      }
    }
  }

  const ambiguousIdx = meta.rows
    .map((r, i) => (i < chunk.length && r.ambiguous ? i : -1))
    .filter((i) => i >= 0);

  const picksBeforeVision = raw.slice(0, chunk.length);
  const allSameCol =
    chunk.length > 1 &&
    picksBeforeVision.every((p, i) => i === 0 || p === picksBeforeVision[0]) &&
    picksBeforeVision[0] !== null &&
    picksBeforeVision.every((p) => p !== null);

  const visionImageSource = oriented;

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onAmbiguousRows &&
    ambiguousIdx.length > 0 &&
    examId &&
    !fallbackFile
  ) {
    const rowsPayload = ambiguousIdx.map((i) => ({
      questionId: chunk[i]!.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: chunk[i]!.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok) {
        await applyVisionSelections(raw, chunk, ambiguousIdx, payload.selections);
      }
    } catch {
      /* mantener lectura local */
    }
  }

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onManySameColumnAlign &&
    examId &&
    chunk.length >= 8 &&
    meta.maxSameColumnCount >= 8 &&
    !allSameCol &&
    !fallbackFile
  ) {
    const rowsPayload = chunk.map((q, i) => ({
      questionId: q.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: q.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok && payload.selections) {
        for (let i = 0; i < chunk.length; i++) {
          await applyVisionSelections(raw, chunk, [i], payload.selections);
        }
      }
    } catch {
      /* mantener lectura local */
    }
  }

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onAllSameColumn &&
    allSameCol &&
    examId &&
    !ambiguousIdx.length &&
    !fallbackFile
  ) {
    const rowsPayload = chunk.map((q, i) => ({
      questionId: q.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: q.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok && payload.selections) {
        for (let i = 0; i < chunk.length; i++) {
          await applyVisionSelections(raw, chunk, [i], payload.selections);
        }
      }
    } catch {
      /* mantener lectura local */
    }
  }

  if (
    !mostlyBlank &&
    CALIFACIL_VISION_POLICY.onFinalizeEveryRow &&
    examId &&
    chunk.length > 0 &&
    !fallbackFile
  ) {
    const rowsPayload = chunk.map((q, i) => ({
      questionId: q.id,
      globalNumber: chunkQuestionOffset + i + 1,
      options: q.options ?? [],
    }));
    try {
      const imageBase64 = califacilImageToJpegDataUrl(visionImageSource);
      const res = await fetchVisionOmr({
        examId,
        imageBase64,
        rows: rowsPayload,
        omrColumnCount: omrCols,
        focusNumbers: rowsPayload.map((r) => r.globalNumber),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        selections?: Record<string, string>;
      };
      if (res.ok && payload.selections) {
        for (let i = 0; i < chunk.length; i++) {
          await applyVisionSelections(raw, chunk, [i], payload.selections);
        }
      }
    } catch {
      /* mantener OMR local */
    }
  }

  mapped = mapRawToDraftDetailed(raw, chunk);
  const picksInChunk = raw.slice(0, chunk.length);

  const locks = { ...input.liveLockedAnswers };
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

  const updatedLiveLocks: Record<string, string> = {};
  for (const q of chunk) {
    const v = mapped.draft[q.id]?.trim() ?? '';
    if (v) updatedLiveLocks[q.id] = v;
  }

  const insufficientForReview =
    !mostlyBlank && mergedResolved < minResolved && !isMobileCamera;

  return {
    meta,
    raw,
    mapped,
    mergedDraft,
    mergedResolved,
    picksInChunk,
    activeScanSource,
    warpAlignment,
    mostlyBlank,
    minResolved,
    ambiguousIdx,
    insufficientForReview,
    updatedLiveLocks,
  };
}

/** Lectura ya resuelta (p. ej. ZipGrade) sin repetir el pipeline CaliFacil completo. */
export function buildCalifacilOmrReadingOverride(
  meta: OmrScanMetaResult,
  chunk: Question[],
  activeScanSource: HTMLImageElement | HTMLCanvasElement,
  liveLockedAnswers: Record<string, string>,
  warpAlignment: WarpAlignmentReport | null = null
): CalifacilOmrReadingResult {
  let raw = [...meta.picks];
  let mapped = mapRawToDraftDetailed(raw, chunk);
  const minResolved = Math.max(1, Math.ceil(chunk.length * CALIFACIL_MIN_AUTO_READ_RATIO));
  let mostlyBlank = isAnswerSheetOmrMostlyBlank(meta, chunk.length);
  if (mostlyBlank) {
    raw = raw.map(() => null);
    mapped = mapRawToDraftDetailed(raw, chunk);
  }

  const ambiguousIdx = meta.rows
    .map((r, i) => (i < chunk.length && r.ambiguous ? i : -1))
    .filter((i) => i >= 0);

  const locks = { ...liveLockedAnswers };
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

  const updatedLiveLocks: Record<string, string> = {};
  for (const q of chunk) {
    const v = mapped.draft[q.id]?.trim() ?? '';
    if (v) updatedLiveLocks[q.id] = v;
  }

  return {
    meta,
    raw,
    mapped,
    mergedDraft,
    mergedResolved,
    picksInChunk: raw.slice(0, chunk.length),
    activeScanSource,
    warpAlignment,
    mostlyBlank,
    minResolved,
    ambiguousIdx,
    insufficientForReview: !mostlyBlank && mergedResolved < minResolved,
    updatedLiveLocks,
  };
}
