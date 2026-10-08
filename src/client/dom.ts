// Tiny DOM builder. Strings become text nodes, so API data inserted through
// h() is never interpreted as HTML.

export type Child = Node | string | number | null | undefined | false | Child[];
type AttrValue = string | number | boolean | null | undefined | ((ev: any) => void);
export type Attrs = Record<string, AttrValue>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (typeof v === 'function') {
        el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const parsedIcons = new Map<string, HTMLTemplateElement>();

/** Inline SVG icon from a trusted constant in icons.ts (never API data). Each icon is parsed once, then cloned. */
export function icon(svg: string, cls = 'icon'): HTMLSpanElement {
  let t = parsedIcons.get(svg);
  if (!t) {
    t = document.createElement('template');
    t.innerHTML = svg;
    parsedIcons.set(svg, t);
  }
  const s = document.createElement('span');
  s.className = cls;
  s.setAttribute('aria-hidden', 'true');
  s.append(t.content.cloneNode(true));
  return s;
}

/** Only allow http(s) links from API data into href attributes. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}
