import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isUnlocked } from "@/lib/review/auth";
import { cloudinaryCreds } from "@/lib/review/cloudinary-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hand the browser a signed Cloudinary upload ticket.
 *
 * The signature covers the folder and timestamp, so a leaked ticket can only
 * drop a file into the review folder, and only for the next few minutes.
 */
export async function POST() {
  if (!(await isUnlocked())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }

  const creds = cloudinaryCreds();
  if (!creds) {
    return NextResponse.json({ error: "no-cloudinary" }, { status: 503 });
  }
  const { cloudName, apiKey, apiSecret } = creds;

  const folder = process.env.CLOUDINARY_FOLDER || "casa-harmony/review";
  const timestamp = Math.round(Date.now() / 1000);
  // Cloudinary signs the alphabetically sorted params, secret appended.
  const signature = createHash("sha1")
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest("hex");

  return NextResponse.json({
    cloudName,
    apiKey,
    folder,
    timestamp,
    signature,
    endpoint: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
  });
}
