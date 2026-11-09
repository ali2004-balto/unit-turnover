/** Keys are made by the app ("turnovers/<id>/<step>/<id>.jpg"); anything else is refused. */
const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{2,5}$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) throw new Error(`Unsafe storage key: ${key}`);
}
