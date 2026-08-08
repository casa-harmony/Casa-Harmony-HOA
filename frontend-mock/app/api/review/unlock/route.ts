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

/** Current state — used on load to decide whether to show the review layer. */
export async function GET() {
  return NextResponse.json({
    configured: reviewConfigured(),
    unlocked: await isUnlocked(),
    storage: hasDatabase() ? "remote" : "local",
    uploads: uploadsConfigured(),
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
