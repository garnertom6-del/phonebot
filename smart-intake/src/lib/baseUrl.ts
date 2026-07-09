/**
 * Public base URL for client links. On Render, RENDER_EXTERNAL_URL is set
 * automatically, so a Blueprint deploy needs zero manual URL configuration.
 */
export function appBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_BASE_URL or RENDER_EXTERNAL_URL must be set before creating public links.");
  }
  return "http://localhost:3000";
}
