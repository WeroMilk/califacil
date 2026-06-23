/** pdfjs-dist puede transferir/detach el ArrayBuffer original; clonar siempre antes de getDocument. */
export function pdfBufferBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}
