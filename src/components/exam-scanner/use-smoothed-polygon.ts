'use client';

import { useEffect, useRef, useState } from 'react';
import type { ViewportPoint } from '@/components/exam-scanner/types';

function lerpPoint(a: ViewportPoint, b: ViewportPoint, t: number): ViewportPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Suaviza el polígono del documento con requestAnimationFrame (~200 ms). */
export function useSmoothedPolygon(target: ViewportPoint[] | null): ViewportPoint[] | null {
  const [display, setDisplay] = useState<ViewportPoint[] | null>(target);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef<ViewportPoint[] | null>(target);
  const startRef = useRef(0);

  useEffect(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (!target || target.length !== 4) {
      setDisplay(null);
      fromRef.current = null;
      return;
    }
    const from = fromRef.current ?? target;
    fromRef.current = target;
    startRef.current = performance.now();
    const duration = 200;

    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const eased = 1 - (1 - t) ** 3;
      setDisplay(
        target.map((p, i) => lerpPoint(from[i] ?? p, p, eased)) as ViewportPoint[]
      );
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return display;
}
