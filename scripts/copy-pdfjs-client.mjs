import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const destDir = path.join(process.cwd(), 'public', 'pdfjs');

const files = ['pdf.min.mjs', 'pdf.worker.min.mjs'];

if (!fs.existsSync(srcDir)) {
  console.warn('[copy-pdfjs-client] pdfjs-dist not found, skipping');
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
for (const file of files) {
  const src = path.join(srcDir, file);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-pdfjs-client] missing ${file}, skipping`);
    continue;
  }
  fs.copyFileSync(src, path.join(destDir, file));
}
console.log('[copy-pdfjs-client] copied pdfjs client assets to public/pdfjs/');
