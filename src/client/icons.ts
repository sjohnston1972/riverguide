// Trusted inline SVG icons (24px grid, stroke = currentColor).

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  chat: svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  list: svg('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  map: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  send: svg('<path d="M4 12l16-8-6 16-2.5-6.5z"/>'),
  stop: svg('<rect x="7" y="7" width="10" height="10" rx="1.5"/>'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.95 6.75 19.7l1-5.85L3.5 9.7l5.9-.9z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  gauge: svg('<path d="M9 3v18M9 6h4M9 10h6M9 14h4M9 18h6"/>'),
  trend: svg('<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/>'),
  rain: svg('<path d="M7 15a4 4 0 1 1 1-7.9A5 5 0 0 1 17 9a3.5 3.5 0 0 1 0 7H7z"/><path d="M9 19l-1 2M13 19l-1 2M17 19l-1 2"/>'),
  people: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5M16 5a3 3 0 0 1 0 6M21 20c0-2.2-1.4-4-3.6-4.7"/>'),
  wave: svg('<path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>'),
};
