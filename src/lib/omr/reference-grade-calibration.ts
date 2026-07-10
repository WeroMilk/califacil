/**
 * Geometría calibrada desde chilo.pdf (generado por scripts/calibrate-reference-grade.mts).
 * No editar a mano — volver a ejecutar el script de calibración.
 */
import type { OmrNormRect } from '@/lib/omrScan';

export const REFERENCE_GRADE_ROW_COUNT = 30;
export const REFERENCE_GRADE_COLUMN_COUNT = 4;
export const REFERENCE_GRADE_MAX_SIDE = 1600;
export const REFERENCE_GRADE_WIDTH = 1230;
export const REFERENCE_GRADE_HEIGHT = 1600;

/** Marco naranja de la tabla (coords. normalizadas 0–1). */
export const REFERENCE_TABLE_FRAME_NORM: OmrNormRect = {
  "x": 0.16117073170731705,
  "y": 0.079875,
  "w": 0.8085528455284552,
  "h": 0.8346250000000001
};

/** 31 líneas horizontales de la rejilla (px, canvas de referencia). */
export const REFERENCE_ROW_LINE_YS: readonly number[] = [153,201,252,298,342,386,430,476,515,559,606,647,692,738,786,829,872,915,961,1005,1048,1092,1137,1181,1225,1269,1314,1358,1402,1446,1478];

/** Bordes verticales A–D (5 valores, px). */
export const REFERENCE_COL_EDGES: readonly number[] = [186,397,608,819,1151];

/** Ancho columna de número de pregunta / ancho tabla (calibrado). */
export const REFERENCE_QNUM_WIDTH_RATIO = 0.050000;
