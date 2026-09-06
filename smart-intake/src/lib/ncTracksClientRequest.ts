export async function ncTracksRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.assign("/provider?next=/nctracks"); throw new Error("Sign in again to continue."); }
    if (!response.ok) throw new Error(body.error || `The request could not be completed (${response.status}).`);
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The response timed out. Reload saved requests before retrying; a request may already have been saved.");
    throw error;
  } finally { window.clearTimeout(timer); }
}
