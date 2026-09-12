import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load, sign, type Claims } from "@moq/token";

import { getServerAuth, getServerFirestore } from "@/server/database";
import { moqBroadcastName, moqRelayRoot } from "@/lib/media/moq-paths";

type SessionRequest = {
  userId?: string;
  displayName?: string;
};

const SESSION_COOKIE_NAME = "__session";
const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 4;

function parseBearerToken(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;
  const [scheme, token] = headerValue.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;
  return token.trim();
}

function tokenTtlSeconds(): number {
  const raw = process.env.MOQ_TOKEN_TTL_SECONDS;
  if (!raw) return DEFAULT_TOKEN_TTL_SECONDS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOKEN_TTL_SECONDS;
}

async function authenticate(request: NextRequest): Promise<string | NextResponse> {
  const auth = getServerAuth();
  const bearer = parseBearerToken(request.headers.get("authorization"));
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (bearer) {
    try {
      const decoded = await auth.verifyIdToken(bearer);
      return decoded.uid;
    } catch (error) {
      console.warn("[moq-session] Bearer verification failed", error);
    }
  }

  if (sessionCookie) {
    try {
      const decoded = await auth.verifySessionCookie(sessionCookie, true);
      return decoded.uid;
    } catch (error) {
      console.warn("[moq-session] Session cookie verification failed", error);
    }
  }

  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

async function loadSigningKey() {
  const keyPath = process.env.MOQ_JWK_PATH ?? "quizee-default.jwk";
  const jwk = await readFile(resolve(process.cwd(), keyPath), "utf8");
  return load(jwk);
}

function relayUrlWithToken(relayUrl: string, token: string): string {
  const url = new URL(relayUrl);
  url.searchParams.set("jwt", token);
  return url.toString();
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ room: string }> }
) {
  const authResult = await authenticate(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { room } = await context.params;
  const roomId = room?.trim();
  if (!roomId) {
    return NextResponse.json(
      { message: "Room parameter is required." },
      { status: 400 }
    );
  }

  let payload: SessionRequest = {};
  try {
    payload = (await request.json()) as SessionRequest;
  } catch {
    payload = {};
  }

  if (payload.userId && payload.userId !== authResult) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const displayName =
    typeof payload.displayName === "string" ? payload.displayName.trim() : "";

  try {
    const relayUrl = process.env.MOQ_RELAY_URL ?? process.env.NEXT_PUBLIC_MOQ_RELAY_URL;
    if (!relayUrl) {
      return NextResponse.json(
        { message: "MoQ relay URL is not configured." },
        { status: 500 }
      );
    }

    const db = getServerFirestore();
    const memberRef = db.collection("rooms").doc(roomId).collection("members").doc(authResult);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const now = Math.floor(Date.now() / 1000);
    const claims: Claims = {
      root: moqRelayRoot(relayUrl),
      put: moqBroadcastName(roomId, authResult),
      get: roomId,
      iat: now,
      exp: now + tokenTtlSeconds(),
    };
    const token = await sign(await loadSigningKey(), claims);

    return NextResponse.json(
      {
        relayUrl: relayUrlWithToken(relayUrl, token),
        broadcastName: moqBroadcastName(roomId, authResult),
        userId: authResult,
        displayName: displayName || memberSnap.data()?.name || undefined,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[moq-session]", error);
    return NextResponse.json(
      { message: "Unable to create MoQ session right now." },
      { status: 500 }
    );
  }
}
