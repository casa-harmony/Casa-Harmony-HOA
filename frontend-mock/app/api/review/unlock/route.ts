import { NextResponse } from "next/server";
import {
  REVIEW_COOKIE,
  cookieOptions,
  isUnlocked,
  passcodeMatches,
  reviewConfigured,
  tokenFor,
} from "@/lib/review/auth";
import { cloudinaryCreds } from "@/lib/review/cloudinary-server";
import { hasDatabase } from "@/lib/review/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uploadsConfigured(): boolean {
  return !!cloudinaryCreds();
}

/**
 * Which of the review variables the running function can actually see.
 *
 * Names and presence only — never values. This is the difference between
 * "the variable is misspelled" and "the variable never reached the function",
 * which is otherwise invisible from outside a deploy.
 */
function diagnostics() {
  const wanted = [
    "REVIEW_PASSCODE",
    "DATABASE_URL",
    "CLOUDINARY_URL",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  // Near-misses of the keys we want, and nothing else — a typo like
  // DATABASE_UR should surface without echoing unrelated site config back.
  const prefixes = ["REVIEW_", "DATABASE_", "CLOUDINARY_"];
  const lookalikes = Object.keys(process.env).filter(
    (k) => !wanted.includes(k) && prefixes.some((p) => k.startsWith(p))
  );

  return {
    present: wanted.filter((k) => !!process.env[k]),
    lookalikes,
    onNetlify: !!process.env.NETLIFY,
    context: process.env.CONTEXT ?? null,
  };
}

/** Current state — used on load to decide whether to show the review layer. */
export async function GET(req: Request) {
  const wantsDiag = new URL(req.url).searchParams.get("diag") === "1";
  return NextResponse.json({
    configured: reviewConfigured(),
    unlocked: await isUnlocked(),
    storage: hasDatabase() ? "remote" : "local",
    uploads: uploadsConfigured(),
    ...(wantsDiag ? { diag: diagnostics() } : {}),
  });
}

/** Exchange the shared passcode for the review cookie. */
export async function POST(req: Request) {
  if (!reviewConfigured()) {
    return NextResponse.json({ error: "Review mode is not configured." }, { status: 404 });
  }
  let key = "";
  try {
    key = String(((await req.json()) as { key?: unknown })?.key ?? "");
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!passcodeMatches(key)) {
    return NextResponse.json({ error: "That passcode is not right." }, { status: 401 });
  }

  const res = NextResponse.json({
    ok: true,
    storage: hasDatabase() ? "remote" : "local",
    uploads: uploadsConfigured(),
  });
  res.cookies.set(REVIEW_COOKIE, tokenFor(key), cookieOptions());
  return res;
}

/** Leave review mode on this browser. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(REVIEW_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return res;
}
