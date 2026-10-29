import { NextResponse } from "next/server";
import { getServerAuth, getServerFirestore } from "@/server/database";
import { StatsError } from "@/server/stats/error";
import { statsJson, statsResponse } from "@/server/stats/http";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MS, adminCookie, assertSameOrigin, establishAdminSession, statsSessionUser } from "@/server/stats/sessions";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return statsResponse(async () => {
    const cookie = adminCookie(request);
    if (!cookie) throw new StatsError("unauthenticated", "Sign in to continue.", 401);
    return Response.json(await statsSessionUser(getServerAuth(), getServerFirestore(), cookie));
  });
}

export function POST(request: Request) {
  return statsResponse(async () => {
    assertSameOrigin(request);
    const body = await statsJson(request, ["idToken"]);
    if (typeof body.idToken !== "string" || !body.idToken || body.idToken.length > 20000) throw new StatsError("malformed-input", "An ID token is required.", 400);
    const cookie = await establishAdminSession(getServerAuth(), getServerFirestore(), body.idToken);
    const response = NextResponse.json({ signedIn: true });
    response.cookies.set(ADMIN_SESSION_COOKIE, cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: ADMIN_SESSION_MS / 1000 });
    return response;
  });
}

export function DELETE(request: Request) {
  return statsResponse(async () => {
    assertSameOrigin(request);
    const response = NextResponse.json({ signedIn: false });
    response.cookies.set(ADMIN_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  });
}
