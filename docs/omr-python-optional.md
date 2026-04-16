# OMR Python opcional (OMRChecker / OpenCV)

La app CaliFacil lee burbujas **en el navegador** (`src/lib/omrScan.ts`). Para máxima paridad con herramientas como [OMRChecker](https://github.com/Udayraj123/OMRChecker) (Python + OpenCV), puedes desplegar un **microservicio aparte** que:

1. Reciba la imagen (idealmente el recorte del recuadro CaliFacil, JPEG/PNG en el body).
2. Ejecute un script Python con OpenCV (o el propio OMRChecker adaptado a una plantilla JSON que coincida con la tabla impresa).
3. Devuelva JSON `{ "answers": [{ "questionIndex": 0, "columnIndex": 0 }, ...] }` mapeable a opciones en el cliente.

## Por qué no va en Vercel serverless por defecto

Las rutas API de Next en Vercel suelen ser Node.js sin OpenCV nativo. Opciones típicas:

- **Contenedor** (Docker) en Railway, Render, Fly.io, Azure Container Apps, etc.
- **Máquina virtual** o VPS con Python instalado.
- **Cliente solo**: mantener el flujo actual + `NEXT_PUBLIC_CALIFACIL_VISION_ON_FINAL` para visión en la nube (ver `src/lib/califacilVisionPolicy.ts`).

## Integración sugerida

1. Añadir variable `NEXT_PUBLIC_OMR_PYTHON_URL` apuntando al servicio.
2. En `finalizeCapturedSheet` (o solo cuando falle el umbral de confianza), `fetch` POST al servicio con la misma imagen que ya se envía a visión.
3. Fusionar resultados: prioridad configurable (Python > OMR local > visión).

Este documento describe despliegue; el código del microservicio no forma parte del repositorio principal hasta que elijáis host y plantilla.
