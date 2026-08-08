import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/review/auth";
import { hasDatabase } from "@/lib/review/db";
import { addMessage, parseMessageInput } from "@/lib/review/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reply to an existing pin. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  if (!hasDatabase()) return NextResponse.json({ error: "no-database" }, { status: 503 });

  const { id } = await ctx.params;
  try {
    const pin = await addMessage(id, parseMessageInput(await req.json()));
    if (!pin) return NextResponse.json({ error: "not-found" }, { status: 404 });
    return NextResponse.json({ pin }, { status: 201 });
  } catch (err) {
    console.error("[review] reply failed", err);
    return NextResponse.json({ error: "reply-failed" }, { status: 400 });
  }
}
