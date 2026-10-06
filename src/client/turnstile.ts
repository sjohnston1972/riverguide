// Cloudflare Turnstile, loaded only when chat needs a session.

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Verification script failed to start.')));
    s.onerror = () => reject(new Error("Couldn't load the verification check. Check your connection, or turn off blockers for this site."));
    document.head.appendChild(s);
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

/** One widget per container; each call to token() yields a fresh token. */
export class TurnstileWidget {
  private id: string | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly siteKey: string,
  ) {}

  async token(): Promise<string> {
    const ts = await load();
    return new Promise<string>((resolve, reject) => {
      this.pending?.reject(new Error('Superseded'));
      this.pending = { resolve, reject };
      const settle = (fn: (p: NonNullable<TurnstileWidget['pending']>) => void) => {
        const p = this.pending;
        this.pending = null;
        if (p) fn(p);
      };
      if (this.id == null) {
        this.id = ts.render(this.el, {
          sitekey: this.siteKey,
          appearance: 'interaction-only',
          theme: 'auto',
          size: 'flexible',
          callback: (t: string) => settle((p) => p.resolve(t)),
          'error-callback': () => {
            settle((p) => p.reject(new Error('Verification failed. Please try again.')));
            return true;
          },
          'expired-callback': () => undefined,
          'timeout-callback': () => settle((p) => p.reject(new Error('Verification timed out. Please try again.'))),
        });
      } else {
        ts.reset(this.id);
      }
    });
  }
}
