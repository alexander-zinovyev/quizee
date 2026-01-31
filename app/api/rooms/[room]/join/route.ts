import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { getServerAuth, getServerFirestore } from "@/server/database";

const scryptAsync = promisify(scrypt);

type JoinRequestBody = {
  room?: string;
  name?: string;
  password?: string;
};

type AuthData = {
  password?: string;
  passwordHash?: string;
  passwordSalt?: string;
};

type AuthSuccess =
  | {
      uid: string;
      tokenSource: "idToken" | "sessionCookie";
      sessionCookieValue?: string;
    }
  | { error: NextResponse };

const SESSION_COOKIE_NAME = "__session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const DERIVED_KEY_LENGTH = 64;

function parseBearerToken(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;

  const [scheme, token] = headerValue.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;

  return token.trim();
}

async function authenticateRequest(
  request: NextRequest,
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<AuthSuccess> {
  const auth = getServerAuth();
  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (bearerToken) {
    try {
      const decoded = await auth.verifyIdToken(bearerToken);
      let sessionCookieValue: string | undefined;

      if (!sessionCookie) {
        sessionCookieValue = await auth.createSessionCookie(bearerToken, {
          expiresIn: SESSION_MAX_AGE_MS,
        });
      }

      return {
        uid: decoded.uid,
        tokenSource: "idToken",
        sessionCookieValue,
      };
    } catch (error) {
      console.warn("[join-auth] Bearer token verification failed", error);
    }
  }

  if (sessionCookie) {
    try {
      const decoded = await auth.verifySessionCookie(sessionCookie, true);
      return { uid: decoded.uid, tokenSource: "sessionCookie" };
    } catch (error) {
      console.warn("[join-auth] Session cookie verification failed", error);
    }
  }

  return {
    error: NextResponse.json({ message: "Unauthorized" }, { status: 401 }),
  };
}

async function getRoomAuth(
  db: Firestore,
  roomSlug: string
): Promise<AuthData | null> {
  const authDocs = await db
    .collection("rooms")
    .doc(roomSlug)
    .collection("auth")
    .limit(1)
    .get();

  if (authDocs.empty) {
    return null;
  }

  return authDocs.docs[0].data() as AuthData;
}

function bufferFromHash(hash: string): Buffer | null {
  try {
    return Buffer.from(hash, "hex");
  } catch {
    return null;
  }
}

async function verifyPassword(
  providedPassword: string,
  authData: AuthData
): Promise<boolean> {
  if (authData.passwordHash && authData.passwordSalt) {
    const storedHash = bufferFromHash(authData.passwordHash);
    if (!storedHash) {
      return false;
    }

    const derivedLength = storedHash.length || DERIVED_KEY_LENGTH;
    const derived = (await scryptAsync(
      providedPassword,
      authData.passwordSalt,
      derivedLength
    )) as Buffer;

    if (derived.length !== storedHash.length) {
      return false;
    }

    return timingSafeEqual(storedHash, derived);
  }

  if (authData.password) {
    const expected = Buffer.from(authData.password);
    const provided = Buffer.from(providedPassword);

    if (expected.length !== provided.length) {
      return false;
    }

    return timingSafeEqual(expected, provided);
  }

  return false;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ room: string }> }
) {
  const body = ((await request.json().catch(() => ({}))) ??
    {}) as JoinRequestBody;

  const password = body.password?.trim() ?? "";
  const displayName = body.name?.trim() ?? "";
  const { room } = await context.params;
  const roomSlug = room?.trim() || body.room?.trim();

  if (!roomSlug) {
    return NextResponse.json(
      { message: "Room parameter is required." },
      { status: 400 }
    );
  }

  if (!password) {
    return NextResponse.json(
      { message: "Password is required." },
      { status: 400 }
    );
  }

  if (!displayName) {
    return NextResponse.json(
      { message: "Name is required." },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  const authResult = await authenticateRequest(request, cookieStore);
  if ("error" in authResult) {
    return authResult.error;
  }

  try {
    const db = getServerFirestore();
    const roomRef = db.collection("rooms").doc(roomSlug);
    const roomSnapshot = await roomRef.get();

    if (!roomSnapshot.exists) {
      return NextResponse.json(
        { message: `Room "${roomSlug}" was not found.` },
        { status: 404 }
      );
    }

    const authData = await getRoomAuth(db, roomSlug);
    if (!authData) {
      return NextResponse.json(
        { message: "Room is not configured for authentication." },
        { status: 500 }
      );
    }

    const isPasswordValid = await verifyPassword(password, authData);
    if (!isPasswordValid) {
      return NextResponse.json(
        { message: "Invalid room password." },
        { status: 401 }
      );
    }

    await roomRef.collection("members").doc(authResult.uid).set(
      {
        uid: authResult.uid,
        name: displayName,
        joinedAt: FieldValue.serverTimestamp(),
        role: "player",
        team: null,
      },
      { merge: true }
    );

    const response = NextResponse.json({ message: "Joined the room." });

    if (authResult.sessionCookieValue) {
      response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: authResult.sessionCookieValue,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
      });
    }

    return response;
  } catch (error) {
    console.error("[rooms-join]", error);
    return NextResponse.json(
      { message: "Unable to join the room. Try again." },
      { status: 500 }
    );
  }
}
