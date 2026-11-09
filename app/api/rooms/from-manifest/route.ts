import { randomUUID } from "node:crypto";
import { clueMediaType, type StoredClueStage } from "@/server/rooms/clue-media";
import type { QuizStage } from "@/types/quiz-stage";
import { writeCluesRound } from "@/server/rooms/clues-manifest";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { posix } from "node:path";
import { validateColorAssets } from "@/server/rooms/color-assets";
import { parseColorSvg } from "@/lib/media/color-svg";

import { getServerAuth, getServerFirestore, getServerStorageBucket } from "@/server/database";
import {
  ALLOWED_MEDIA_EXTENSIONS,
  validateQuizFile,
  validateRoomId,
  type ValidatedRound,
} from "@/server/rooms/validation";
import { collectReferencedMedia, createRoundDocumentData } from "@/server/rooms/manifest";
import { createServerMediaProvider } from "@/lib/media/provisioning";
import { hostingResponse } from "@/server/rooms/hosting-response";

const SESSION_COOKIE_NAME = "__session";

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

export async function POST(request: NextRequest) {
  return hostingResponse("Finalizing quiz", () => createRoom(request));
}

async function createRoom(request: NextRequest) {
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
  const referencedMedia = collectReferencedMedia(rounds);

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
    await createServerMediaProvider().provisionRoom(roomId);
  } catch (error) {
    console.error("[rooms-manifest] Media room provisioning failed", error);
    return NextResponse.json(
      { message: "Unable to provision media room right now." },
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

  try {
    for (const round of rounds) {
      if (round.type !== "color") continue;
      for (const question of round.questions) {
        if (question.regionIds) {
          const [bytes] = await bucket.file(mediaFiles.get(question.imagePath)!.uploadPath).download();
          parseColorSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes), question.regionIds);
          continue;
        }
        const [image, mask] = await Promise.all([question.imagePath, question.maskPath].map(async (path) => {
          const [bytes] = await bucket.file(mediaFiles.get(path)!.uploadPath).download();
          return bytes;
        }));
        await validateColorAssets(image, mask);
      }
    }
  } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400 });
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

  const resolveStages = async (stages: Array<{ text?: string; media?: { path: string } }>) =>
    Promise.all(
      stages.map(async (stage) => {
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

  const privateMedia = new Map<string, NonNullable<StoredClueStage["media"]>>();
  const resolvePrivateStage = async (stage: QuizStage): Promise<StoredClueStage> => {
    if (!stage.media) return { text: stage.text ?? null, media: null };
    let media = privateMedia.get(stage.media);
    if (!media) {
      const source = mediaFiles.get(stage.media)!;
      const [bytes] = await bucket.file(source.uploadPath).download();
      const extension = posix.extname(stage.media);
      const storagePath = `rooms/${roomId}/clue-media/${randomUUID()}${extension}`;
      const contentType = clueMediaType(stage.media);
      await bucket.file(storagePath).save(bytes, { metadata: { contentType, cacheControl: "no-store", metadata: {} } });
      media = { storagePath, contentType, filename: source.filename };
      privateMedia.set(stage.media, media);
    }
    return { text: stage.text ?? null, media };
  };
  const resolvePackStage = async (stage: QuizStage) => {
    const [resolved] = await resolveStages([{ text: stage.text, ...(stage.media ? { media: { path: stage.media } } : {}) }]);
    return resolved;
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

    batch.set(roundRef, createRoundDocumentData(round));

    if (round.type === "clues") {
      await writeCluesRound(batch, roundRef, round, resolvePackStage, resolvePrivateStage);
    } else if (round.type === "sorting") {
      for (const question of round.questions) {
        const [stage] = await resolveStages([question]);
        batch.set(roundRef.collection("questions").doc(question.id), stage);
      }
      batch.set(roundRef.collection("answers").doc("order"), { correctOrder: round.correctOrder });
    } else if (round.type === "color") {
      for (const question of round.questions) {
        const id = `question-${question.order + 1}`;
        batch.set(roundRef.collection("questions").doc(id), {
          order: question.order, media: await resolveMedia(question.imagePath),
          ...(question.regionIds ? { regionIds: question.regionIds } : { mask: await resolveMedia(question.maskPath) }), initialColor: question.initialColor,
        });
        batch.set(roundRef.collection("answers").doc(id), { answer: question.targetColor });
      }
    } else if (round.type === "text") {
      for (const question of round.questions) {
        const questionId = `question-${question.order + 1}`;
        const questionRef = roundRef.collection("questions").doc(questionId);
        const promptStages = await resolveStages(question.promptStages);

        batch.set(questionRef, {
          order: question.order,
          stages: promptStages,
        });

        const answerRef = roundRef.collection("answers").doc(questionId);
        const answerStages = await resolveStages(question.answerStages);
        batch.set(answerRef, {
          hint: question.answerHint,
          stages: answerStages,
        });
      }
    } else if (round.type === "multi-step") {
      for (const question of round.questions) {
        const questionId = `question-${question.order + 1}`;
        const questionRef = roundRef.collection("questions").doc(questionId);
        const stepStages = await resolveStages(question.steps);
        batch.set(questionRef, {
          order: question.order,
          stages: stepStages,
        });

        const answerRef = roundRef.collection("answers").doc(questionId);
        const answerStages = await resolveStages(question.answerStages);
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
