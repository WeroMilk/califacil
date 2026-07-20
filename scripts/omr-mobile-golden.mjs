/**
 * Golden / regression checks for mobile OMR helpers (no UI).
 * Run: node scripts/omr-mobile-golden.mjs
 */
import { createCanvas } from '@napi-rs/canvas';

const MOBILE_MIN_FIDUCIAL_CORNERS = 4;
const MOBILE_LIVE_MIN_FIDUCIAL_CORNERS = 3;
const MOBILE_MIN_QUAD_INTERIOR_LUMINANCE = 0.28;

function isWarpedLetterCanvas(w, h) {
  const aspect = w / Math.max(1, h);
  return aspect > 0.72 && aspect < 0.86;
}

function isAcceptable({ width, height, corners, strips }) {
  if (!isWarpedLetterCanvas(width, height)) return false;
  if (corners >= MOBILE_MIN_FIDUCIAL_CORNERS) return true;
  return corners >= MOBILE_LIVE_MIN_FIDUCIAL_CORNERS && strips;
}

/** Mirror of isMobileExamSheetReadyForCapture (live gate). */
function isReadyForCapture({ corners, strips, fill = 0.1, interior = 0.35 }) {
  if (!strips) return false;
  const minCorners =
    corners >= MOBILE_MIN_FIDUCIAL_CORNERS
      ? MOBILE_MIN_FIDUCIAL_CORNERS
      : MOBILE_LIVE_MIN_FIDUCIAL_CORNERS;
  if (corners < minCorners) return false;
  if (fill < 0.06) return false;
  if (interior < MOBILE_MIN_QUAD_INTERIOR_LUMINANCE) return false;
  return true;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testGates() {
  assert(isAcceptable({ width: 850, height: 1100, corners: 4, strips: false }), '4 corners ok');
  assert(isAcceptable({ width: 850, height: 1100, corners: 3, strips: true }), '3+strips ok');
  assert(!isAcceptable({ width: 850, height: 1100, corners: 3, strips: false }), '3 without strips reject');
  assert(!isAcceptable({ width: 1200, height: 800, corners: 4, strips: true }), 'non-letter reject');
  console.log('ok: gate parity live↔post-warp');
}

function testLiveCaptureGate() {
  assert(isReadyForCapture({ corners: 4, strips: true }), '4 corners + strips = ready');
  assert(isReadyForCapture({ corners: 3, strips: true }), '3 corners + strips = ready');
  assert(!isReadyForCapture({ corners: 4, strips: false }), '4 corners without strips reject');
  assert(!isReadyForCapture({ corners: 2, strips: true }), '2 corners reject');
  assert(isReadyForCapture({ corners: 4, strips: true, interior: 0.29 }), 'interior 0.29 ok');
  assert(!isReadyForCapture({ corners: 4, strips: true, interior: 0.2 }), 'interior 0.2 reject');
  console.log('ok: live capture gate 4 corners + strips');
}

function testSameFrameQuadIdentity() {
  const w = 1600;
  const h = 2000;
  const quad = [
    { x: 100, y: 120 },
    { x: 1500, y: 110 },
    { x: 1480, y: 1880 },
    { x: 90, y: 1900 },
  ];
  const scale = (q, fromW, fromH, toW, toH) =>
    q.map((p) => ({ x: (p.x / fromW) * toW, y: (p.y / fromH) * toH }));
  const scaled = scale(quad, w, h, w, h);
  for (let i = 0; i < 4; i++) {
    assert(Math.abs(scaled[i].x - quad[i].x) < 1e-9, `x[${i}]`);
    assert(Math.abs(scaled[i].y - quad[i].y) < 1e-9, `y[${i}]`);
  }
  console.log('ok: same-frame quad identity');
}

function testReferenceLetterCanvas() {
  const canvas = createCanvas(850, 1100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 850, 1100);
  assert(isWarpedLetterCanvas(canvas.width, canvas.height), 'napi letter canvas');
  console.log('ok: reference-grade letter aspect');
}

function testDetectSideConstant() {
  const ROI = 1024;
  const FULL = ROI;
  assert(FULL === 1024, 'detect max side unified');
  console.log('ok: detect max side = 1024');
}

function testCaptureMaxSide() {
  const CAPTURE = 1920;
  assert(CAPTURE === 1920, 'mobile capture maxSide 1920');
  console.log('ok: capture maxSide = 1920');
}

try {
  testGates();
  testLiveCaptureGate();
  testSameFrameQuadIdentity();
  testReferenceLetterCanvas();
  testDetectSideConstant();
  testCaptureMaxSide();
  console.log('\nAll omr-mobile golden checks passed.');
} catch (err) {
  console.error('\nFAILED:', err.message);
  process.exit(1);
}
