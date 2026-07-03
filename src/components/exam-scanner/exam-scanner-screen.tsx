'use client';

import { useMemo, type RefObject } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CameraView } from '@/components/exam-scanner/camera-view';
import { OverlayRenderer } from '@/components/exam-scanner/overlay-renderer';
import { StatusCard } from '@/components/exam-scanner/status-card';
import { ScanHud } from '@/components/exam-scanner/scan-hud';
import { CaptureFlash } from '@/components/exam-scanner/capture-flash';
import {
  deriveDetectionPhase,
  deriveStatusLabel,
} from '@/components/exam-scanner/document-detector';
import type { ViewfinderGuideRectPx, ViewportPoint } from '@/components/exam-scanner/types';
import {
  EXAM_PSEUDO_FULLSCREEN_CLASS,
  type ExamFullscreenMode,
} from '@/lib/examFullscreen';

type FlashMode = 'auto' | 'on' | 'off';

export type ExamScannerScreenProps = {
  shellRef?: RefObject<HTMLDivElement | null>;
  viewportRef?: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  cameraOpen: boolean;
  scanBusy: boolean;
  shutterFlash: boolean;
  examTitle: string;
  documentPolygon: ViewportPoint[] | null;
  guideRect: ViewfinderGuideRectPx | null;
  aligned: boolean;
  stableProgress: number;
  lowLight?: boolean;
  cameraFullscreenMode?: ExamFullscreenMode;
  flashMode: FlashMode;
  flashOn: boolean;
  flashSupported: boolean;
  onClose: () => void;
  onChangeExam: () => void;
  onFlash: () => void;
  onCapture: () => void;
  onRetryCamera: () => void;
  onVideoMount?: (node: HTMLVideoElement | null) => void;
  captureReady?: boolean;
};

export function ExamScannerScreen({
  shellRef,
  viewportRef,
  videoRef,
  cameraOpen,
  scanBusy,
  shutterFlash,
  examTitle,
  documentPolygon,
  guideRect,
  aligned,
  stableProgress,
  lowLight,
  cameraFullscreenMode = 'none',
  flashMode,
  flashOn,
  flashSupported,
  onClose,
  onChangeExam,
  onFlash,
  onCapture,
  onRetryCamera,
  onVideoMount,
  captureReady = false,
}: ExamScannerScreenProps) {
  const documentVisible = documentPolygon !== null && documentPolygon.length === 4;

  const phase = useMemo(
    () =>
      deriveDetectionPhase({
        documentVisible,
        aligned,
        stableProgress,
        scanBusy,
        lowLight,
      }),
    [documentVisible, aligned, stableProgress, scanBusy, lowLight]
  );

  const statusLabel = useMemo(
    () => deriveStatusLabel(phase, stableProgress),
    [phase, stableProgress]
  );

  const progress = scanBusy ? 1 : stableProgress;

  return (
    <div
      ref={shellRef as RefObject<HTMLDivElement> | undefined}
      className={cn(
        'exam-scanner-root fixed inset-0 z-[10000] overflow-hidden bg-black text-white',
        cameraFullscreenMode === 'pseudo' && EXAM_PSEUDO_FULLSCREEN_CLASS
      )}
    >
      {!cameraOpen ? (
        <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-4 p-6">
          <Loader2 className="h-8 w-8 animate-spin text-white/80" />
          <p className="text-sm text-white/75">Abriendo cámara…</p>
          <Button type="button" variant="secondary" className="w-full max-w-xs" onClick={onRetryCamera}>
            Reintentar cámara
          </Button>
        </div>
      ) : (
        <>
          <CameraView
            ref={viewportRef as RefObject<HTMLDivElement> | undefined}
            videoRef={videoRef}
            onVideoMount={onVideoMount}
          />
          <OverlayRenderer
            phase={phase}
            documentPolygon={documentPolygon}
            guideRect={guideRect}
          />

          <header
            className="exam-scanner-topbar pointer-events-none fixed inset-x-0 top-0 z-[10005] flex items-start gap-2.5 px-3"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
          >
            <button
              type="button"
              data-scanner-action="close"
              className="pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md active:scale-95 disabled:opacity-40"
              aria-label="Cerrar escáner"
              disabled={scanBusy}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <X className="h-5 w-5" strokeWidth={2.5} />
            </button>
            <div className="pointer-events-auto min-w-0 flex-1">
              <StatusCard
                examTitle={examTitle}
                statusLabel={statusLabel}
                stableProgress={progress}
                phase={phase}
                onTapCapture={!scanBusy ? onCapture : undefined}
              />
            </div>
          </header>

          <ScanHud
            flashMode={flashMode}
            flashOn={flashOn}
            flashSupported={flashSupported}
            captureReady={captureReady}
            disabled={scanBusy}
            onChangeExam={onChangeExam}
            onFlash={onFlash}
            onCapture={onCapture}
          />

          <CaptureFlash active={shutterFlash} />

          {scanBusy ? (
            <div
              className="pointer-events-none fixed inset-0 z-[10004] flex items-center justify-center bg-black/25"
              aria-live="polite"
            >
              <div className="rounded-2xl bg-black/55 px-5 py-4 text-center shadow-xl backdrop-blur-sm">
                <Loader2
                  className="mx-auto h-9 w-9 animate-spin text-white motion-reduce:animate-none [animation-duration:650ms]"
                  aria-hidden
                />
                <p className="mt-2 text-sm font-medium text-white/90">Calificando hoja…</p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
