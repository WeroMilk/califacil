import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/** Ratón/trackpad de escritorio: no pedir cámara aunque la ventana sea estrecha. */
export function isDesktopPointerDevice(): boolean {
  if (typeof window === "undefined") return true
  const finePointer = window.matchMedia("(pointer: fine)").matches
  const hover = window.matchMedia("(hover: hover)").matches
  return finePointer && hover
}

/**
 * Cámara en vivo solo en móvil táctil (no en escritorio con ratón, ni ventana estrecha en PC).
 * Por defecto false hasta medir en cliente (evita getUserMedia al cargar).
 */
export function useCalificarLiveCamera(): boolean {
  const narrowLayout = useIsMobile()
  const [enabled, setEnabled] = React.useState(false)

  React.useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches
    const touchLike = coarse || (!isDesktopPointerDevice() && navigator.maxTouchPoints > 0)
    setEnabled(narrowLayout && touchLike)
  }, [narrowLayout])

  return enabled
}
