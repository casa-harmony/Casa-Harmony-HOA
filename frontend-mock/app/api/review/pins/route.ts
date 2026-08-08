import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/review/auth";
import { hasDatabase } from "@/lib/review/db";
import { createPin, loadPins, parsePinInput } from "@/lib/review/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shared guard: locked visitors see nothing, and no DB means local-only mode. */
async function guard(): Promise<NextResponse | null> {
  if (!(await isUnlocked())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no-database" }, { status: 503 });
  }
  return null;
}

export async function GET(req: Request) {
  const blocked = await guard();
  if (blocked) return blocked;

  const path = new URL(req.url).searchParams.get("path");
  try {
    return NextResponse.json({ pins: await loadPins(path) });
  } catch (err) {
    console.error("[review] load failed", err);
    return NextResponse.json({ error: "database-error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const blocked = await guard();
  if (blocked) return blocked;

  try {
    const pin = await createPin(parsePinInput(await req.json()));
    return NextResponse.json({ pin }, { status: 201 });
  } catch (err) {
    console.error("[review] create failed", err);
    return NextResponse.json({ error: "create-failed" }, { status: 400 });
  }
}
