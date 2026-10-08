/** JSON stored in a D1 text column: null when absent or unparseable. */
export function parseJson<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}
