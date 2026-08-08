import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/review/auth";
import { hasDatabase } from "@/lib/review/db";
import { deletePin, setStatus } from "@/lib/review/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(): Promise<NextResponse | null> {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  if (!hasDatabase()) return NextResponse.json({ error: "no-database" }, { status: 503 });
  return null;
}

/** Resolve or reopen a pin. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await guard();
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: string; actor?: string };
  const status = body.status === "resolved" ? "resolved" : "open";

  try {
    const pin = await setStatus(id, status, String(body.actor ?? "Guest"));
    if (!pin) return NextResponse.json({ error: "not-found" }, { status: 404 });
    return NextResponse.json({ pin });
  } catch (err) {
    console.error("[review] status update failed", err);
    return NextResponse.json({ error: "database-error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await guard();
  if (blocked) return blocked;

  const { id } = await ctx.params;
  try {
    await deletePin(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[review] delete failed", err);
    return NextResponse.json({ error: "database-error" }, { status: 500 });
  }
}
