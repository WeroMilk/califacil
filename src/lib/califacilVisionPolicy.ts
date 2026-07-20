/**
 * Política de cuándo llamar a `/api/calificar/vision-omr` (GPT-4o-mini).
 * Ajustar coste vs cobertura con variables de entorno públicas (solo flags, sin secretos).
 *
 * Requiere en el servidor: `OPENAI_API_KEY` (sin prefijo NEXT_PUBLIC).
 * Sin clave, la API devuelve 503 y solo se usa el lector OMR local.
 *
 * Por defecto la visión está APAGADA (happy path OMR en segundos).
 * Activar flags explícitos en `.env.local` solo si se necesita IA.
 *
 * Variables públicas (build-time; reiniciar dev server tras cambiar):
 * - `NEXT_PUBLIC_CALIFACIL_VISION_ON_LIVE_COMMIT` — visión al confirmar desde cámara en vivo.
 * - `NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL` — segunda pasada IA al importar/capturar toda la hoja.
 * - `NEXT_PUBLIC_CALIFACIL_VISION_ON_AMBIGUOUS` — filas ambiguas del OMR local.
 * - `NEXT_PUBLIC_CALIFACIL_VISION_ON_SAME_COLUMN` — muchas filas en la misma columna.
 *
 * Ver [.env.example](.env.example) en la raíz del proyecto.
 */

function envBool(name: string): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export const CALIFACIL_VISION_POLICY = {
  /** Filas marcadas como ambiguas por el OMR local. Off por defecto. */
  onAmbiguousRows: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_AMBIGUOUS'),
  /** ≥8 filas con la misma columna pero no todas. Off por defecto. */
  onManySameColumnAlign: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_SAME_COLUMN'),
  /** Todas las filas leen la misma columna. Off por defecto. */
  onAllSameColumn: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_SAME_COLUMN'),
  /**
   * Tras pulsar «Revisar y confirmar» con la cámara en vivo.
   * Off por defecto. Activar: `NEXT_PUBLIC_CALIFACIL_VISION_ON_LIVE_COMMIT=true`
   */
  onLiveCommitVision: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_LIVE_COMMIT'),
  /**
   * Tras importar/capturar imagen, segunda pasada sobre toda la hoja (más coste).
   * Off por defecto. Activar: `NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL=true`
   */
  onFinalizeEveryRow: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL'),
  /**
   * Fallback duro: menos del 45% de filas resueltas y hoja no en blanco.
   * Off por defecto en shutter; activar con `NEXT_PUBLIC_CALIFACIL_VISION_ON_LOW_RESOLVED=true`.
   */
  onLowResolvedRatio: envBool('NEXT_PUBLIC_CALIFACIL_VISION_ON_LOW_RESOLVED'),
  /** Umbral de resolved rows (0–1) para el fallback duro. */
  lowResolvedRatioThreshold: 0.45,
} as const;
