// Edge cache for API responses the Worker builds itself. Cloudflare only caches
// fetch()es to an origin automatically, so these go through the Cache API.
// The cache is per data centre: a purge clears the data centre it runs in, and
// the TTL bounds how stale any other one can be.

const ORIGIN = 'https://cache.riverguide';

export const sectionsKey = () => new Request(`${ORIGIN}/sections`);
export const sectionKey = (slug: string) => new Request(`${ORIGIN}/sections/${encodeURIComponent(slug)}`);

async function etagOf(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return `"${[...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

/**
 * JSON from the edge cache, or built and cached for `ttlSeconds`. Browsers are told to
 * revalidate every time (statuses can change with any poll or community report); a
 * matching If-None-Match gets a 304. Returns null when `build` finds nothing.
 */
export async function cachedJson(
  req: Request,
  key: Request,
  ttlSeconds: number,
  ctx: ExecutionContext,
  build: () => Promise<unknown>,
): Promise<Response | null> {
  let hit = await caches.default.match(key);
  if (!hit) {
    const body = await build();
    if (body == null) return null;
    const text = JSON.stringify(body);
    hit = new Response(text, {
      headers: { 'content-type': 'application/json', etag: await etagOf(text), 'cache-control': `public, max-age=${ttlSeconds}` },
    });
    ctx.waitUntil(caches.default.put(key, hit.clone()));
  }
  const etag = hit.headers.get('etag') ?? '';
  const headers = { 'content-type': 'application/json', etag, 'cache-control': 'no-cache' };
  if (etag && req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(hit.body, { headers });
}

/** Drop the cached section list (and, given slugs, those sections' pages) after the data changed. */
export async function purgeSections(...slugs: string[]): Promise<void> {
  await Promise.all([sectionsKey(), ...slugs.map(sectionKey)].map((k) => caches.default.delete(k)));
}
