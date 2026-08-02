export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface FetchOpts {
  method?: string;
  body?: unknown;
  token?: string | null;
  tenantId?: string | null;
}

function headers(opts: FetchOpts): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) h["Authorization"] = `Bearer ${opts.token}`;
  if (opts.tenantId) h["X-Tenant-Id"] = opts.tenantId;
  return h;
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: FetchOpts = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || "GET",
    headers: headers(opts),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const detail =
      (payload as { detail?: string })?.detail ||
      (typeof payload === "string" ? payload : "") ||
      `Request failed (${res.status})`;
    throw new ApiError(
      Array.isArray(detail) ? JSON.stringify(detail) : String(detail),
      res.status
    );
  }
  return payload as T;
}

/** Download any binary export endpoint and trigger a browser save. */
export async function downloadFile(
  path: string,
  token: string,
  tenantId: string,
  filename: string
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId },
  });
  if (!res.ok) throw new ApiError("Download failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download the COA xlsx export and trigger a browser save. */
export async function downloadExport(
  structureId: string,
  token: string,
  tenantId: string,
  filename = "chart_of_accounts.xlsx"
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/coa/structures/${structureId}/export`,
    { headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId } }
  );
  if (!res.ok) throw new ApiError("Export failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
