import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 10;

/** argon2id with the library's defaults (19 MiB, 2 passes), the OWASP-recommended settings. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Returns a reason the password can't be used, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "That's too long.";
  return null;
}
