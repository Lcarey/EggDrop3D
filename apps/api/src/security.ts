import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const EDIT_TOKEN_BYTES = 32;
const EDIT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateEditToken(): string {
  return randomBytes(EDIT_TOKEN_BYTES).toString("base64url");
}

export function hashEditToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function isPlausibleEditToken(token: string): boolean {
  return EDIT_TOKEN_PATTERN.test(token);
}

export function editTokenMatches(token: string, expectedHash: string): boolean {
  if (!isPlausibleEditToken(token)) return false;

  const actual = Buffer.from(hashEditToken(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function anonymizeRateLimitIdentity(identity: string): string {
  return createHash("sha256").update(identity, "utf8").digest("hex");
}
