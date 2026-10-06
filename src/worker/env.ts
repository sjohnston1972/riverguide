/** Bindings + vars from wrangler.jsonc, plus secrets set with `wrangler secret put`. */
export type AppEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  SESSION_SECRET?: string;
  TURNSTILE_SECRET?: string;
};

export function flag(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}
