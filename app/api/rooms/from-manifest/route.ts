import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { posix } from "node:path";

import { getServerAuth, getServerFirestore, getServerStorageBucket } from "@/server/database";
import {
  ALLOWED_MEDIA_EXTENSIONS,
  validateQuizFile,
  validateRoomId,
  type ValidatedRound,
} from "@/server/rooms/validation";

const SESSION_COOKIE_NAME = "__session";
const DAILY_ROOM_API = "https://api.daily.co/v1/rooms";

type ManifestPayload = {
  id?: string;
  name?: string;
  hostName?: string;
  password?: string;
  quizJson?: string;
  mediaMap?: Record<string, string>;
  sessionId?: string;
};

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
      console.warn("[rooms-manifest] Bearer verification failed", error);
    }
  }

  if (sessionCookie) {
    try {
      const decoded = await auth.verifySessionCookie(sessionCookie, true);
      return { uid: decoded.uid };
    } catch (error) {
      console.warn("[rooms-manifest] Session cookie verification failed", error);
    }
  }

  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

function ensureString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMediaPath(path: string): string | null {
  const trimmed = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("..")) return null;
  const normalized = posix.normalize(trimmed);
  if (normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

function configuredMediaTransport(): string {
  return (process.env.MEDIA_TRANSPORT ?? process.env.NEXT_PUBLIC_MEDIA_TRANSPORT ?? "daily").toLowerCase();
}

async function ensureDailyRoom(roomId: string) {
  if (
    process.env.MEDIA_DISABLED === "true" ||
    process.env.NEXT_PUBLIC_MEDIA_DISABLED === "true" ||
    configuredMediaTransport() !== "daily"
  ) {
    return;
  }
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    throw new Error("Daily API key is not configured.");
  }

  const response = await fetch(DAILY_ROOM_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: roomId,
      privacy: "private",
      properties: {
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      },
    }),
  });

  if (response.ok || response.status === 409) {
    return;
  }

  const payload = await response.json().catch(() => ({}));
  const message =
    typeof payload?.info === "string" && payload.info.length
      ? payload.info
      : "Unable to create Daily room.";
  throw new Error(message);
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);
  if (!("uid" in authResult)) {
    return authResult;
  }

  let payload: ManifestPayload;
  try {
    payload = (await request.json()) as ManifestPayload;
  } catch {
    return NextResponse.json({ message: "Invalid JSON payload." }, { status: 400 });
  }

  const roomId = ensureString(payload.id)?.toLowerCase() ?? "";
  const roomName = ensureString(payload.name);
  const hostName = ensureString(payload.hostName);
  const password = ensureString(payload.password);
  const quizJson = ensureString(payload.quizJson);
  const sessionId = ensureString(payload.sessionId);
  const mediaMap = payload.mediaMap ?? {};

  const validationError = validateRoomId(roomId);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }
  if (!roomName) {
    return NextResponse.json({ message: "Room name is required." }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ message: "Room password is required." }, { status: 400 });
  }
  if (!hostName) {
    return NextResponse.json({ message: "Host name is required." }, { status: 400 });
  }
  if (!quizJson) {
    return NextResponse.json({ message: "Quiz JSON is required." }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ message: "Upload session is required." }, { status: 400 });
  }

  const db = getServerFirestore();
  const sessionRef = db.collection("uploadSessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    return NextResponse.json({ message: "Upload session not found." }, { status: 404 });
  }
  const sessionData = sessionSnap.data() ?? {};
  if (sessionData.uid !== authResult.uid) {
    return NextResponse.json({ message: "Upload session is not valid for this user." }, { status: 403 });
  }
  if (sessionData.roomId !== roomId) {
    return NextResponse.json({ message: "Upload session does not match room id." }, { status: 400 });
  }
  const expiresAt = typeof sessionData.expiresAt === "number" ? sessionData.expiresAt : 0;
  if (expiresAt && Date.now() > expiresAt) {
    return NextResponse.json({ message: "Upload session expired." }, { status: 410 });
  }

  const validationResult = validateQuizFile(quizJson);
  if (typeof validationResult === "string") {
    return NextResponse.json({ message: validationResult }, { status: 400 });
  }
  const rounds: ValidatedRound[] = validationResult;

  const referencedMedia = new Set<string>();
  rounds.forEach((round) => {
    if (round.type === "text") {
      round.questions.forEach((q) => {
        q.promptStages.forEach((stage) => {
          if (stage.media?.path) {
            referencedMedia.add(stage.media.path);
          }
        });
        q.answerStages.forEach((stage) => {
          if (stage.media?.path) {
            referencedMedia.add(stage.media.path);
          }
        });
      });
      return;
    }

    round.questions.forEach((q) => {
      if (q.prompt?.media?.path) {
        referencedMedia.add(q.prompt.media.path);
      }
      referencedMedia.add(q.imagePath);
    });
  });

  const uploadPrefix = ensureString(sessionData.uploadPrefix);
  const maxFiles = typeof sessionData.maxFiles === "number" ? sessionData.maxFiles : 0;
  const maxTotalBytes =
    typeof sessionData.maxTotalBytes === "number" ? sessionData.maxTotalBytes : 0;
  const maxFileBytes =
    typeof sessionData.maxFileBytes === "number" ? sessionData.maxFileBytes : 0;

  if (!uploadPrefix || !maxFiles || !maxTotalBytes || !maxFileBytes) {
    return NextResponse.json({ message: "Upload session is invalid." }, { status: 400 });
  }

  if (referencedMedia.size > maxFiles) {
    return NextResponse.json(
      { message: `Quiz references too many media files (${referencedMedia.size}).` },
      { status: 400 }
    );
  }

  const roomRef = db.collection("rooms").doc(roomId);
  const roomSnap = await roomRef.get();
  if (roomSnap.exists) {
    return NextResponse.json({ message: "Room id is already taken." }, { status: 409 });
  }

  try {
    await ensureDailyRoom(roomId);
  } catch (error) {
    console.error("[rooms-manifest] Daily room creation failed", error);
    return NextResponse.json(
      { message: "Unable to provision Daily room right now." },
      { status: 502 }
    );
  }

  const bucket = getServerStorageBucket();
  const mediaFiles = new Map<
    string,
    { uploadPath: string; contentType: string; size: number; filename: string; originalPath: string }
  >();
  let totalBytes = 0;

  for (const relPath of referencedMedia) {
    const normalized = normalizeMediaPath(relPath);
    if (!normalized) {
      return NextResponse.json({ message: `Invalid media path "${relPath}".` }, { status: 400 });
    }
    const ext = posix.extname(normalized).toLowerCase();
    if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { message: `Unsupported media extension "${ext}".` },
        { status: 400 }
      );
    }
    const uploadPath = mediaMap[relPath] ?? mediaMap[normalized];
    if (!uploadPath) {
      return NextResponse.json(
        { message: `Missing upload for media file "${relPath}".` },
        { status: 400 }
      );
    }
    if (!uploadPath.startsWith(`${uploadPrefix}/`)) {
      return NextResponse.json(
        { message: `Invalid upload path for "${relPath}".` },
        { status: 400 }
      );
    }

    let meta;
    try {
      [meta] = await bucket.file(uploadPath).getMetadata();
    } catch {
      return NextResponse.json(
        { message: `Uploaded media "${relPath}" not found.` },
        { status: 400 }
      );
    }
    const size = Number(meta.size ?? 0);
    if (!size || size > maxFileBytes) {
      return NextResponse.json(
        { message: `Media file "${relPath}" exceeds size limits.` },
        { status: 400 }
      );
    }
    totalBytes += size;
    if (totalBytes > maxTotalBytes) {
      return NextResponse.json(
        { message: "Total media size exceeds upload limits." },
        { status: 400 }
      );
    }

    const contentType = typeof meta.contentType === "string" ? meta.contentType : "";
    const filename =
      typeof meta.metadata?.filename === "string"
        ? meta.metadata.filename
        : posix.basename(normalized);

    mediaFiles.set(relPath, {
      uploadPath,
      contentType,
      size,
      filename,
      originalPath: normalized,
    });
  }

  const batch = db.batch();
  const copiedMedia = new Set<string>();
  const resolveMedia = async (path: string) => {
    const mediaMeta = mediaFiles.get(path);
    if (!mediaMeta) {
      throw new Error(`Missing media metadata for "${path}".`);
    }

    const storagePath = posix.join(
      "rooms",
      roomId,
      "media",
      mediaMeta.originalPath.replace(/^[\\/]+/, "").replace(/\\/g, "/")
    );
    if (!copiedMedia.has(storagePath)) {
      await bucket.file(mediaMeta.uploadPath).copy(storagePath);
      await bucket.file(storagePath).setMetadata({
        contentType: mediaMeta.contentType,
        cacheControl: "public,max-age=31536000,immutable",
        metadata: {
          originalPath: mediaMeta.originalPath,
          filename: mediaMeta.filename,
        },
      });
      copiedMedia.add(storagePath);
    }

    return {
      storagePath,
      contentType: mediaMeta.contentType,
      size: mediaMeta.size,
      filename: mediaMeta.filename,
      originalPath: path,
    };
  };

  batch.set(roomRef, {
    title: roomName,
    state: "pending",
    createdAt: FieldValue.serverTimestamp(),
    presenting: { round: null, question: null, withAnswer: false, promptPage: 0, answerPage: 0 },
    handRaisingEnabled: true,
    countdownEndsAt: null,
  });

  batch.set(roomRef.collection("auth").doc("default"), {
    password,
    createdAt: FieldValue.serverTimestamp(),
  });

  batch.set(
    roomRef.collection("members").doc(authResult.uid),
    {
      uid: authResult.uid,
      name: hostName,
      role: "host",
      joinedAt: FieldValue.serverTimestamp(),
      team: null,
    },
    { merge: true }
  );

  for (const round of rounds) {
    const roundId = `round-${round.order + 1}`;
    const roundRef = roomRef.collection("rounds").doc(roundId);

    batch.set(roundRef, {
      type: round.type,
      title: round.title,
      order: round.order,
      state: "scheduled",
      activeWindow: { startedAt: null, endedAt: null },
      questionCount: round.questions.length,
      gradingRequired: false,
    });

    if (round.type === "text") {
      for (const question of round.questions) {
        const questionId = `question-${question.order + 1}`;
        const questionRef = roundRef.collection("questions").doc(questionId);
        const promptStages = await Promise.all(
          question.promptStages.map(async (stage) => {
            if (!stage.media?.path) {
              return { text: stage.text ?? null, media: null };
            }
            const media = await resolveMedia(stage.media.path);
            return {
              text: stage.text ?? null,
              media,
            };
          })
        );

        batch.set(questionRef, {
          order: question.order,
          stages: promptStages,
        });

        const answerRef = roundRef.collection("answers").doc(questionId);
        const answerStages = await Promise.all(
          question.answerStages.map(async (stage) => {
            if (!stage.media?.path) {
              return { text: stage.text ?? null, media: null };
            }
            const media = await resolveMedia(stage.media.path);
            return {
              text: stage.text ?? null,
              media,
            };
          })
        );
        batch.set(answerRef, {
          hint: question.answerHint,
          stages: answerStages,
        });
      }
    } else {
      for (const question of round.questions) {
        const answerMedia = await resolveMedia(question.imagePath);
        const imageRef = roundRef.collection("images").doc();
        batch.set(imageRef, {
          media: {
            storagePath: answerMedia.storagePath,
            contentType: answerMedia.contentType,
            size: answerMedia.size,
            filename: answerMedia.filename,
            originalPath: answerMedia.originalPath,
          },
        });

        const hasPromptContent = Boolean(
          question.prompt?.text || question.prompt?.media?.path
        );
        if (!hasPromptContent) {
          continue;
        }

        const questionId = `question-${question.order + 1}`;
        const questionRef = roundRef.collection("questions").doc(questionId);
        let promptMedia:
          | {
              storagePath: string;
              contentType: string;
              size: number;
              filename: string;
              originalPath: string;
            }
          | null = null;

        if (question.prompt?.media?.path) {
          promptMedia = await resolveMedia(question.prompt.media.path);
        }

        batch.set(questionRef, {
          order: question.order,
          text: question.prompt?.text ?? null,
          media: promptMedia,
        });

        const answerRef = roundRef.collection("answers").doc(questionId);
        batch.set(answerRef, {
          answer: imageRef.id,
        });
      }
    }
  }

  await batch.commit();

  await Promise.all(
    Array.from(mediaFiles.values()).map((meta) =>
      bucket.file(meta.uploadPath).delete().catch(() => undefined)
    )
  );
  await sessionRef.delete().catch(() => undefined);

  return NextResponse.json({ id: roomId, title: roomName }, { status: 201 });
}
