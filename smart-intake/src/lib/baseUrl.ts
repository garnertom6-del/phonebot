/**
 * Public base URL for client links. On Render, RENDER_EXTERNAL_URL is set
 * automatically, so a Blueprint deploy needs zero manual URL configuration.
 */
function requestOrigin(req?: Request | { headers?: Headers; nextUrl?: URL; url?: string }): string {
  if (!req) return "";
  try {
    if ("nextUrl" in req && req.nextUrl?.origin) return req.nextUrl.origin;
  } catch {}
  try {
    if ("url" in req && req.url) return new URL(req.url).origin;
  } catch {}
  const host = req.headers?.get?.("x-forwarded-host") || req.headers?.get?.("host") || "";
  const proto = req.headers?.get?.("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

export function appBaseUrl(req?: Request | { headers?: Headers; nextUrl?: URL; url?: string }): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const origin = requestOrigin(req);
  if (origin) return origin;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL or RENDER_EXTERNAL_URL must be set before creating public links.");
  }
  return "http://localhost:3000";
}
