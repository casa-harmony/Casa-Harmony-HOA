import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Review mode is gated by one shared passcode held in `REVIEW_PASSCODE`.
 *
 * Unlocking swaps the passcode for an httpOnly cookie holding its hash, so the
 * passcode itself is never stored in the browser and never travels again after
 * the first request. With no passcode configured the whole feature is off and
 * the site is an ordinary mock.
 */

export const REVIEW_COOKIE = "ch_review";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export function reviewConfigured(): boolean {
  return !!process.env.REVIEW_PASSCODE;
}

export function tokenFor(passcode: string): string {
  return createHash("sha256").update(`casa-harmony:${passcode}`).digest("hex");
}

function sameString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function passcodeMatches(candidate: string): boolean {
  const expected = process.env.REVIEW_PASSCODE;
  if (!expected) return false;
  return sameString(candidate, expected);
}

export async function isUnlocked(): Promise<boolean> {
  if (!reviewConfigured()) return false;
  const jar = await cookies();
  const token = jar.get(REVIEW_COOKIE)?.value;
  if (!token) return false;
  return sameString(token, tokenFor(process.env.REVIEW_PASSCODE!));
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}
