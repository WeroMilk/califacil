import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(root, 'public', 'gobierno-sonora-logo.png');
const tmp = path.join(root, 'public', 'gobierno-sonora-logo.tmp.png');
const finalPath = path.join(root, 'public', 'gobierno-sonora-logo.png');

const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;
if (channels !== 4) {
  console.error('Expected RGBA');
  process.exit(1);
}

/** Píxeles casi negros → transparente (fondo del PNG original). */
const thr = 42;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  if (r <= thr && g <= thr && b <= thr) {
    data[i + 3] = 0;
  }
}

await sharp(data, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(tmp);

const fs = await import('fs/promises');
await fs.rename(tmp, finalPath);

console.log('Wrote transparent background:', finalPath);
