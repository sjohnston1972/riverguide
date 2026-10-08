// Builds web-sized logo and icon files from the master logo in media/.
// Also writes "-dark" variants for dark backgrounds, where the logo's navy is
// lifted to a light blue (the cyan stays as it is).
// Usage: npm run icons

import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'media/riverguide_logo.png';
const OUT = 'public/icons';
mkdirSync(OUT, { recursive: true });

/** Colour that replaces the darkest parts of the logo on dark backgrounds. */
const DARK_MODE_NAVY: [number, number, number] = [150, 196, 240];

// Trim the transparent margin so the mark fills its box.
const trimmed = await sharp(SOURCE).trim().toBuffer();
const darkTrimmed = await recolourForDark(trimmed);

/**
 * Lightens the logo's dark tones for dark backgrounds: each pixel is blended
 * towards DARK_MODE_NAVY in proportion to how dark it is, so navy becomes
 * light blue, cyan is untouched and anti-aliased edges stay smooth.
 */
async function recolourForDark(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  let dark = 255;
  let light = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    dark = Math.min(dark, lum(i));
    light = Math.max(light, lum(i));
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const keep = Math.min(1, Math.max(0, (lum(i) - dark) / (light - dark)));
    for (let c = 0; c < 3; c++) data[i + c] = Math.round(DARK_MODE_NAVY[c] * (1 - keep) + data[i + c] * keep);
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function square(mark: Buffer, size: number, file: string, background?: string, inset = 0) {
  const inner = Math.round(size * (1 - inset * 2));
  const resized = await sharp(mark).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, gravity: 'center' }])
    .png({ compressionLevel: 9, palette: size <= 64 })
    .toFile(`${OUT}/${file}`);
  console.log(`${OUT}/${file}`);
}

for (const [mark, suffix] of [
  [trimmed, ''],
  [darkTrimmed, '-dark'],
] as const) {
  await square(mark, 64, `logo-64${suffix}.png`); // header logo, 2x
  await square(mark, 128, `logo-128${suffix}.png`); // header logo, 3x+
  await square(mark, 32, `favicon-32${suffix}.png`);
  await square(mark, 16, `favicon-16${suffix}.png`);
}
await square(trimmed, 180, 'apple-touch-icon.png', '#ffffff', 0.08); // iOS fills transparency with black
// Home-screen icons for the web manifest; the maskable one keeps the logo inside Android's safe zone.
await square(trimmed, 192, 'icon-192.png', '#ffffff', 0.08);
await square(trimmed, 512, 'icon-512.png', '#ffffff', 0.08);
await square(trimmed, 512, 'icon-512-maskable.png', '#ffffff', 0.2);
