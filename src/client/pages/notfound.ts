import { h } from '../dom.ts';
import type { AppCtx, Page } from '../main.ts';

export function mountNotFound(container: HTMLElement, ctx: AppCtx): Page {
  ctx.setTitle('Page not found');
  container.append(
    h('div', { class: 'wrap prose' }, h('h1', null, 'Page not found'), h('p', null, 'This address does not match a page on River Guide.'), h('p', null, h('a', { href: '/' }, 'Browse all rivers'))),
  );
  return {};
}
