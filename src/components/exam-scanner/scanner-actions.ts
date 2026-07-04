/** Acciones del escáner móvil; se actualizan vía ref para evitar closures obsoletos en iOS. */
export type ScannerActions = {
  capture: () => void;
  flash: () => void;
  changeExam: () => void;
  gallery: () => void;
  close: () => void;
};

export function runScannerAction(
  actions: ScannerActions,
  action: keyof ScannerActions
): void {
  try {
    actions[action]();
  } catch {
    /* evitar que un fallo en un handler bloquee la UI */
  }
}
