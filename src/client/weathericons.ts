// Weather icons (Meteocons by Bas Milius, MIT, in public/icons/weather) for WMO weather codes.
// Animated, with a still copy for people who ask for reduced motion.

import { h } from './dom.ts';

/** The icon and a short word for a WMO weather code. */
export function sky(code: number, isDay = true): { icon: string; label: string } {
  const d = isDay ? 'day' : 'night';
  if (code <= 0) return { icon: `clear-${d}`, label: 'Clear' };
  if (code === 1) return { icon: `clear-${d}`, label: 'Mostly clear' };
  if (code === 2) return { icon: `partly-cloudy-${d}`, label: 'Partly cloudy' };
  if (code === 3) return { icon: 'overcast', label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: 'fog', label: 'Fog' };
  if (code === 56 || code === 57) return { icon: 'sleet', label: 'Freezing drizzle' };
  if (code >= 51 && code <= 55) return { icon: 'drizzle', label: 'Drizzle' };
  if (code === 61) return { icon: 'rain', label: 'Light rain' };
  if (code === 63) return { icon: 'rain', label: 'Rain' };
  if (code === 65) return { icon: 'rain', label: 'Heavy rain' };
  if (code === 66 || code === 67) return { icon: 'sleet', label: 'Freezing rain' };
  if (code >= 71 && code <= 77) return { icon: 'snow', label: 'Snow' };
  if (code >= 80 && code <= 82) return { icon: `partly-cloudy-${d}-rain`, label: code === 82 ? 'Heavy showers' : 'Showers' };
  if (code === 85 || code === 86) return { icon: 'snow', label: 'Snow showers' };
  if (code >= 95) return { icon: 'thunderstorms-rain', label: 'Thunder' };
  return { icon: 'overcast', label: 'Cloudy' };
}

/** The icon for a code as a picture: still when reduced motion is asked for. Decorative (alt ""). */
export function weatherIcon(code: number, isDay: boolean, cls: string): HTMLElement {
  const { icon } = sky(code, isDay);
  return h(
    'picture',
    { class: cls },
    h('source', { srcset: `/icons/weather/static/${icon}.svg`, media: '(prefers-reduced-motion: reduce)' }),
    h('img', { src: `/icons/weather/${icon}.svg`, alt: '', width: '64', height: '64', decoding: 'async' }),
  );
}
