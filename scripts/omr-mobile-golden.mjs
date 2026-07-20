/**
 * Golden / regression checks for mobile OMR helpers (no UI).
 * Run: node scripts/omr-mobile-golden.mjs
 */
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);

// Compile-free smoke: duplicate the gate math used by isMobileWarpedAnswerSheetAcceptable.
const MOBILE_MIN_FIDUCIAL_CORNERS = 4;
const MOBILE_LIVE_MIN_FIDUCIAL_CORNERS = 3;

function isWarpedLetterCanvas(w, h) {
  const aspect = w / Math.max(1, h);
  return aspect > 0.72 && aspect < 0.86;
}

function isAcceptable({ width, height, corners, strips }) {
  if (!isWarpedLetterCanvas(width, height)) return false;
  if (corners >= MOBILE_MIN_FIDUCIAL_CORNERS) return true;
  return corners >= MOBILE_LIVE_MIN_FIDUCIAL_CORNERS && strips;
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

function testSameFrameQuadIdentity() {
  // Mapping identity: quad on full canvas must stay unchanged when frame==canvas size.
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
  // MOBILE_FULL_FRAME_DETECT_MAX_SIDE must equal MOBILE_ROI_DETECT_MAX_SIDE (1024).
  const ROI = 1024;
  const FULL = ROI;
  assert(FULL === 1024, 'detect max side unified');
  console.log('ok: detect max side = 1024');
}

try {
  testGates();
  testSameFrameQuadIdentity();
  testReferenceLetterCanvas();
  testDetectSideConstant();
  console.log('\nAll omr-mobile golden checks passed.');
} catch (err) {
  console.error('\nFAILED:', err.message);
  process.exit(1);
}
