const SYMBOLS = ['+', '−', '×', 'x', '÷', '%', '/'] as const;

/** 0..1 determinista (misma salida en servidor y cliente) */
function jitter(index: number, salt: number): number {
  const t = Math.sin(index * 127.1 + salt * 311.7) * 10000;
  return t - Math.floor(t);
}

const COLS = 16;
const ROWS = 12;

function layoutSymbol(index: number) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const jx = (jitter(index, 1) - 0.5) * 4.5;
  const jy = (jitter(index, 2) - 0.5) * 4.5;
  const left = ((col + 0.5) / COLS) * 100 + jx;
  const top = ((row + 0.5) / ROWS) * 100 + jy;
  const sizeRem = 1.0 + jitter(index, 3) * 0.65;
  const rotate = jitter(index, 4) * 56 - 28;
  const opacity = 0.09 + jitter(index, 5) * 0.1;
  return {
    left: `${Math.min(97, Math.max(1.5, left))}%`,
    top: `${Math.min(96, Math.max(1.5, top))}%`,
    sizeRem,
    rotate,
    opacity,
  };
}

export function MathWallpaper() {
  const count = COLS * ROWS;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute inset-0 bg-gradient-to-br from-orange-50 via-amber-50/80 to-orange-100/90"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-10%,rgba(251,146,60,0.12),transparent_55%)]"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_85%_75%,rgba(245,158,11,0.07),transparent_45%)]"
        aria-hidden
      />

      {Array.from({ length: count }, (_, i) => {
        const sym = SYMBOLS[i % SYMBOLS.length];
        const { left, top, sizeRem, rotate, opacity } = layoutSymbol(i);
        return (
          <span
            key={i}
            className="absolute select-none font-semibold tabular-nums text-orange-500 antialiased"
            style={{
              left,
              top,
              fontSize: `${sizeRem}rem`,
              lineHeight: 1,
              transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
              opacity,
              fontFamily: 'ui-rounded, system-ui, sans-serif',
            }}
          >
            {sym}
          </span>
        );
      })}
    </div>
  );
}
