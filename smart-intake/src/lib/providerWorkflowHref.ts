/** Keep a workflow's explicit provider across navigation, including return links. */
export function providerWorkflowHref(path: string, providerId?: string | null): string {
  const url = new URL(path, "http://workflow.local");
  if (providerId !== undefined && providerId !== null) url.searchParams.set("providerId", providerId.trim());
  return `${url.pathname}${url.search}${url.hash}`;
}
