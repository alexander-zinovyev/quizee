import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { getServerAuth, getServerFirestore } from "@/server/database";

type SessionRequest = {
  userId?: string;
  displayName?: string;
};

const SESSION_COOKIE_NAME = "__session";
const TOKEN_TTL_SECONDS = 60 * 15;

function parseBearerToken(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;
  const [scheme, token] = headerValue.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;
  return token.trim();
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
      console.warn("[daily-session] Bearer verification failed", error);
    }
  }

  if (sessionCookie) {
    try {
      const decoded = await auth.verifySessionCookie(sessionCookie, true);
      return decoded.uid;
    } catch (error) {
      console.warn("[daily-session] Session cookie verification failed", error);
    }
  }

  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

function dailyRoomName(roomId: string): string {
  return roomId;
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

  const displayName =
    typeof payload.displayName === "string" ? payload.displayName.trim() : "";

  try {
    const db = getServerFirestore();
    const memberRef = db.collection("rooms").doc(roomId).collection("members").doc(authResult);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const apiKey = process.env.DAILY_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { message: "Daily API key is not configured." },
        { status: 500 }
      );
    }

    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const tokenResponse = await fetch("https://api.daily.co/v1/meeting-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        properties: {
          room_name: dailyRoomName(roomId),
          user_name: displayName || null,
          user_id: authResult,
          exp,
        },
      }),
    });

    if (!tokenResponse.ok) {
      const errorPayload = await tokenResponse.json().catch(() => ({}));
      return NextResponse.json(
        {
          message: errorPayload?.info ?? "Unable to create Daily session.",
        },
        { status: 502 }
      );
    }

    const tokenPayload = (await tokenResponse.json()) as { token?: string };
    if (!tokenPayload?.token) {
      return NextResponse.json(
        { message: "Daily did not return a session token." },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        roomName: dailyRoomName(roomId),
        token: tokenPayload.token,
        userId: authResult,
        displayName: displayName || memberSnap.data()?.name || undefined,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[daily-session]", error);
    return NextResponse.json(
      { message: "Unable to create Daily session right now." },
      { status: 500 }
    );
  }
}
