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
        'exam-scanner-root fixed inset-0 z-[200] overflow-hidden bg-black text-white',
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
          <div className="pointer-events-none absolute inset-0 z-0">
            <CameraView
              ref={viewportRef as RefObject<HTMLDivElement> | undefined}
              videoRef={videoRef}
            />
            <OverlayRenderer
              phase={phase}
              documentPolygon={documentPolygon}
              guideRect={guideRect}
            />
          </div>

          <div className="exam-scanner-controls pointer-events-none absolute inset-0 z-[120]">
            <div
              className="exam-scanner-topbar pointer-events-auto absolute inset-x-0 flex items-start gap-2.5 px-3"
              style={{ top: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
            >
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-all duration-200 active:scale-95"
                style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                aria-label="Cerrar escáner"
                disabled={scanBusy}
                onClick={(event) => event.preventDefault()}
                onPointerUp={(event) => {
                  if (scanBusy || (event.pointerType === 'mouse' && event.button !== 0)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onClose();
                }}
              >
                <X className="h-4.5 w-4.5" strokeWidth={2.5} />
              </button>
              <StatusCard
                examTitle={examTitle}
                statusLabel={statusLabel}
                stableProgress={progress}
                phase={phase}
              />
            </div>

            {!scanBusy ? (
              <ScanHud
                flashMode={flashMode}
                flashOn={flashOn}
                flashSupported={flashSupported}
                captureReady={captureReady}
                onChangeExam={onChangeExam}
                onFlash={onFlash}
                onCapture={onCapture}
              />
            ) : null}
          </div>

          <CaptureFlash active={shutterFlash} />

          {scanBusy ? (
            <div className="pointer-events-none absolute inset-0 z-[110] flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
              <Loader2
                className="h-9 w-9 animate-spin text-white/90 motion-reduce:animate-none [animation-duration:650ms]"
                aria-hidden
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
