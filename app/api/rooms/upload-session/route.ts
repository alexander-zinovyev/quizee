import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

import { getServerAuth, getServerFirestore } from "@/server/database";
import { validateRoomId } from "@/server/rooms/validation";

const SESSION_COOKIE_NAME = "__session";
const MAX_UPLOAD_FILES = 250;
const MAX_UPLOAD_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 1000 * 60 * 60 * 6;

function parseBearerToken(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;
  const [scheme, token] = headerValue.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;
  return token.trim();
}

async function authenticateRequest(request: NextRequest): Promise<{ uid: string } | NextResponse> {
  const auth = getServerAuth();
  const bearer = parseBearerToken(request.headers.get("authorization"));
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (bearer) {
    try {
      const decoded = await auth.verifyIdToken(bearer);
      return { uid: decoded.uid };
    } catch (error) {
      console.warn("[upload-session] Bearer verification failed", error);
    }
  }

  if (sessionCookie) {
    try {
      const decoded = await auth.verifySessionCookie(sessionCookie, true);
      return { uid: decoded.uid };
    } catch (error) {
      console.warn("[upload-session] Session cookie verification failed", error);
    }
  }

  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!("uid" in authResult)) {
    return authResult;
  }

  let payload: { roomId?: string } = {};
  try {
    payload = (await request.json()) as { roomId?: string };
  } catch {
    return NextResponse.json({ message: "Invalid JSON payload." }, { status: 400 });
  }

  const roomId = payload.roomId?.trim().toLowerCase();
  const validationError = validateRoomId(roomId);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }
  if (!roomId) {
    return NextResponse.json({ message: "Room id is required." }, { status: 400 });
  }

  const db = getServerFirestore();
  const roomSnap = await db.collection("rooms").doc(roomId).get();
  if (roomSnap.exists) {
    return NextResponse.json({ message: "Room id is already taken." }, { status: 409 });
  }

  const sessionId = crypto.randomUUID();
  const uploadPrefix = `uploads/${authResult.uid}/${sessionId}`;
  const expiresAt = Date.now() + UPLOAD_SESSION_TTL_MS;

  await db.collection("uploadSessions").doc(sessionId).set({
    uid: authResult.uid,
    roomId,
    uploadPrefix,
    maxFiles: MAX_UPLOAD_FILES,
    maxTotalBytes: MAX_UPLOAD_TOTAL_BYTES,
    maxFileBytes: MAX_UPLOAD_FILE_BYTES,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  return NextResponse.json(
    {
      sessionId,
      uploadPrefix,
      maxFiles: MAX_UPLOAD_FILES,
      maxTotalBytes: MAX_UPLOAD_TOTAL_BYTES,
      maxFileBytes: MAX_UPLOAD_FILE_BYTES,
      expiresAt,
    },
    { status: 200 }
  );
}
