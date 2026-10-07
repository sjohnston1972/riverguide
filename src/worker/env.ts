/** Bindings + vars from wrangler.jsonc, plus secrets set with `wrangler secret put`. */
export type AppEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  SESSION_SECRET?: string;
  TURNSTILE_SECRET?: string;
  /** Optional SEPA API key (base64 client credentials); without it SEPA's keyless access is used. */
  SEPA_API_KEY?: string;
};

export function flag(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}
