/**
 * Cloudinary helpers.
 *
 * Files go straight from the browser to Cloudinary — the API route only hands
 * out a short-lived signature. That keeps the API secret on the server and
 * keeps multi-megabyte uploads out of the serverless function, which has a
 * request body limit far smaller than a phone screenshot.
 */

/** Insert a transformation into a delivery URL: .../upload/<t>/v123/file.png */
export function thumbnailUrl(url: string): string | null {
  if (!url.includes("/upload/")) return null;
  return url.replace("/upload/", "/upload/c_fill,g_auto,w_400,h_300,q_auto,f_auto/");
}

export function isImage(mime: string, resourceType?: string): boolean {
  return mime.startsWith("image/") || resourceType === "image";
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
