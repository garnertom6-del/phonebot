/**
 * Public base URL for client links. On Render, RENDER_EXTERNAL_URL is set
 * automatically, so a Blueprint deploy needs zero manual URL configuration.
 */
export function appBaseUrl(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "http://localhost:3000"
  );
}
