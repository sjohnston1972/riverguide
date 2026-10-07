// Builds web-sized logo and icon files from the master logo in media/.
// Usage: npm run icons

import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'media/riverguide_logo.png';
const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

// Trim the transparent margin so the mark fills its box, then pad back a little.
const trimmed = await sharp(SOURCE).trim().toBuffer();

async function square(size: number, file: string, background?: string, inset = 0) {
  const inner = Math.round(size * (1 - inset * 2));
  const mark = await sharp(trimmed).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, gravity: 'center' }])
    .png({ compressionLevel: 9, palette: size <= 64 })
    .toFile(`${OUT}/${file}`);
  console.log(`${OUT}/${file}`);
}

await square(64, 'logo-64.png'); // header logo, shown at 32px (2x for sharp screens)
await square(128, 'logo-128.png'); // header logo, 3x
await square(32, 'favicon-32.png');
await square(16, 'favicon-16.png');
await square(180, 'apple-touch-icon.png', '#ffffff', 0.08); // iOS fills transparency with black
