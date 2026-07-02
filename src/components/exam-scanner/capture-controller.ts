export const CAPTURE_STABLE_TICKS_REQUIRED = 3;

export type AutoCaptureGate = {
  autoShutterEnabled: boolean;
  captureBusy: boolean;
  stableTicks: number;
  requiredTicks?: number;
};

/** Indica si se debe disparar la captura automática (sin efectos secundarios). */
export function shouldTriggerAutoCapture({
  autoShutterEnabled,
  captureBusy,
  stableTicks,
  requiredTicks = CAPTURE_STABLE_TICKS_REQUIRED,
}: AutoCaptureGate): boolean {
  return autoShutterEnabled && !captureBusy && stableTicks >= requiredTicks;
}
