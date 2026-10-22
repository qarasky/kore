import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/api";
import { redirectTo } from "@/lib/redirect";
import { loginUrl, PATH_HEADER } from "@/lib/routes";
import { safeNext } from "@/lib/safe-next";

/**
 * Optimistic auth gate (Next 16 "proxy", formerly `middleware.ts`).
 *
 * Only checks that the session cookie is present, which is cheap; Server
 * Components validate it for real via `requireUser()` (`/api/auth/me`).
 */
export function proxy(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  // Public share links work the same signed in or not: no redirects.
  if (pathname.startsWith("/s/")) {
    return NextResponse.next();
  }

  if (pathname === "/login") {
    // `expired` means the API rejected the cookie; let the user sign in again.
    if (hasSession && !searchParams.has("expired")) {
      return redirectTo(req, safeNext(searchParams.get("next")));
    }
    return NextResponse.next();
  }

  if (!hasSession) {
    return redirectTo(req, loginUrl(pathname + search));
  }

  const headers = new Headers(req.headers);
  headers.set(PATH_HEADER, pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
