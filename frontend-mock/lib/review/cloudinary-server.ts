import "server-only";

/**
 * Cloudinary credentials, however they were pasted in.
 *
 * The dashboard hands you either three separate values or one `CLOUDINARY_URL`
 * of the form `cloudinary://<api_key>:<api_secret>@<cloud_name>`. Accepting
 * both removes the most likely deploy-time mistake.
 */
export interface CloudinaryCreds {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export function cloudinaryCreds(): CloudinaryCreds | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (cloudName && apiKey && apiSecret) return { cloudName, apiKey, apiSecret };

  const url = process.env.CLOUDINARY_URL?.trim();
  if (!url) return null;
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url);
  if (!m) return null;
  return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
}
