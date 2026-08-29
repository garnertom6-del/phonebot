import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, unauthenticatedStaffRedirect } from "@/lib/staffPageGate";

export function middleware(request: NextRequest) {
  const hasSession = !!request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const redirectTo = unauthenticatedStaffRedirect(request.nextUrl.pathname, hasSession);
  if (redirectTo) {
    const url = request.nextUrl.clone();
    url.pathname = redirectTo;
    url.search = "";
    return NextResponse.redirect(url);
  }
  const response = NextResponse.next();
  if (request.headers.get("accept")?.includes("text/html")) {
    // Avoid stale HTML referring to chunks from a previous Render deploy.
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }
  return response;
}

export const config = {
  matcher: ["/dashboard", "/master/:path*", "/admin/:path*", "/intakes/:path*", "/login"],
};
