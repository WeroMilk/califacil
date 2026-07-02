export type ViewportPoint = { x: number; y: number };

export type ViewfinderGuideRectPx = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DocumentDetectionPhase = 'lost' | 'searching' | 'stable' | 'capturing';

export type LiveVideoLayoutPx = {
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
};
