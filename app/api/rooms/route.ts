import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize, posix, resolve } from "node:path";
import * as tar from "tar";

import { getServerAuth, getServerFirestore, getServerStorageBucket } from "@/server/database";
import { validateQuizFile, validateRoomId, type ValidatedRound } from "@/server/rooms/validation";

const INITIAL_ROOM_STATE = "pending";
const SESSION_COOKIE_NAME = "__session";
const QUIZ_PACK_FIELD = "quizPack";
const DAILY_ROOM_API = "https://api.daily.co/v1/rooms";
async function ensureDailyRoom(roomId: string) {
  if (process.env.MEDIA_DISABLED === "true") {
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

  if (response.ok) {
    return;
  }

  if (response.status === 409) {
    return;
  }

  const payload = await response.json().catch(() => ({}));
  const message =
    typeof payload?.info === "string" && payload.info.length
      ? payload.info
      : "Unable to create Daily room.";
  throw new Error(message);
}

function parseBearerToken(headerValue: string | null): string | undefined {
  if (!headerValue) return undefined;
  const [scheme, token] = headerValue.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") return undefined;
  return token.trim();
}

function parseStringField(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function POST(request: NextRequest) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch (error) {
    console.warn("[rooms-create] Failed to parse form data", error);
    return NextResponse.json(
      { message: "Request must be multipart/form-data." },
      { status: 400 }
    );
  }

  const roomId = parseStringField(formData.get("id"));
  const name = parseStringField(formData.get("name"));
  const password = parseStringField(formData.get("password"));
  const hostName = parseStringField(formData.get("hostName"));
  const quizPackFile =
    (formData.get(QUIZ_PACK_FIELD) as FormDataEntryValue | null) ??
    (formData.get("quizFile") as FormDataEntryValue | null); // backwards compatibility

  const validationError = validateRoomId(roomId);
  if (validationError) {
    return NextResponse.json({ message: validationError }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json(
      { message: "Room name is required." },
      { status: 400 }
    );
  }

  if (!password) {
    return NextResponse.json(
      { message: "Room password is required." },
      { status: 400 }
    );
  }

  if (!hostName) {
    return NextResponse.json(
      { message: "Host name is required." },
      { status: 400 }
    );
  }

  if (!(quizPackFile instanceof File)) {
    return NextResponse.json(
      { message: "Quiz pack (.tar.gz) file is required." },
      { status: 400 }
    );
  }
  let tempDir: string | null = null;
  let quizJsonPath: string | null = null;
  let mediaDir: string | null = null;
  let rounds: ValidatedRound[] | null = null;
  const mediaFiles = new Map<
    string,
    { absolutePath: string; contentType: string; size: number; filename: string }
  >();

  try {
    tempDir = await mkdtemp(join(tmpdir(), "quiz-pack-"));
    const packPath = join(tempDir, "pack.tar.gz");
    const arrayBuffer = await quizPackFile.arrayBuffer();
    await writeFile(packPath, Buffer.from(arrayBuffer));

    await tar.x({ file: packPath, cwd: tempDir });

    quizJsonPath = join(tempDir, "quiz.json");
    const quizContent = await readFile(quizJsonPath, "utf8").catch(() => null);
    if (!quizContent) {
      return NextResponse.json(
        { message: "quiz.json not found in the quiz pack." },
        { status: 400 }
      );
    }

    const validationResult = validateQuizFile(quizContent);

    if (typeof validationResult === "string") {
      return NextResponse.json({ message: validationResult }, { status: 400 });
    }

    rounds = validationResult;

    mediaDir = join(tempDir, "media");
    // Build media file map for referenced files only.
    const referencedMedia = new Set<string>();
    rounds.forEach((round) => {
      round.questions.forEach((q) => {
        if (q.media?.path) {
          referencedMedia.add(q.media.path);
        }
      });
    });

    for (const relPath of referencedMedia) {
      const normalized = normalize(relPath).replace(/^(\.\.[/\\])+/, "");
      const absolutePath = resolve(mediaDir, normalized);
      if (!absolutePath.startsWith(resolve(mediaDir))) {
        return NextResponse.json(
          { message: `Media path ${relPath} escapes media directory.` },
          { status: 400 }
        );
      }
      const fileStat = await stat(absolutePath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        return NextResponse.json(
          { message: `Media file "${relPath}" not found in quiz pack.` },
          { status: 400 }
        );
      }
      const ext = posix.extname(relPath).toLowerCase();
      const contentType = guessContentType(ext);
      mediaFiles.set(relPath, {
        absolutePath,
        contentType,
        size: fileStat.size,
        filename: posix.basename(relPath),
      });
    }

    let totalPromptCount = 0;
    let totalImageCount = 0;
    let totalTextQuestionCount = 0;

    rounds.forEach((round) => {
      if (round.type === "text") {
        totalTextQuestionCount += round.questions.length;
        return;
      }

      round.questions.forEach((question) => {
        totalImageCount += 1;
        const promptText =
          question.prompt ??
          (question.answer?.trim().length ? question.answer.trim() : null);
        if (promptText) {
          totalPromptCount += 1;
        }
      });
    });

    const auth = getServerAuth();
    const bearer = parseBearerToken(request.headers.get("authorization"));
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    let uid: string | undefined;

    if (bearer) {
      try {
        const decoded = await auth.verifyIdToken(bearer);
        uid = decoded.uid;
      } catch (error) {
        console.warn("[rooms-create] Bearer verification failed", error);
      }
    }

    if (!uid && sessionCookie) {
      try {
        const decoded = await auth.verifySessionCookie(sessionCookie, true);
        uid = decoded.uid;
      } catch (error) {
        console.warn("[rooms-create] Session cookie verification failed", error);
      }
    }

    if (!uid) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const db = getServerFirestore();
    const bucket = getServerStorageBucket();
    const roomRef = db.collection("rooms").doc(roomId);
    const snapshot = await roomRef.get();

    if (snapshot.exists) {
      return NextResponse.json(
        { message: "Room id is already taken." },
        { status: 409 }
      );
    }

    try {
      await ensureDailyRoom(roomId);
    } catch (error) {
      console.error("[rooms-create] Daily room creation failed", error);
      return NextResponse.json(
        { message: "Unable to provision Daily room right now." },
        { status: 502 }
      );
    }

    const batch = db.batch();

    batch.set(roomRef, {
      title: name,
      state: INITIAL_ROOM_STATE,
      createdAt: FieldValue.serverTimestamp(),
      presenting: { round: null, question: null, withAnswer: false, playMedia: false },
      handRaisingEnabled: true,
      countdownEndsAt: null,
    });

    batch.set(roomRef.collection("auth").doc("default"), {
      password,
      createdAt: FieldValue.serverTimestamp(),
    });

    batch.set(
      roomRef.collection("members").doc(uid),
      {
        uid,
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
      });

      if (round.type === "text") {
        for (const question of round.questions) {
          const questionId = `question-${question.order + 1}`;
          const questionRef = roundRef.collection("questions").doc(questionId);
          const mediaMeta = question.media?.path
            ? mediaFiles.get(question.media.path)
            : null;
          const storagePath =
            mediaMeta && question.media
              ? posix.join("rooms", roomId, "media", question.media.path.replace(/^[\\/]+/, "").replace(/\\/g, "/"))
              : null;
          if (mediaMeta && storagePath) {
            await bucket.upload(mediaMeta.absolutePath, {
              destination: storagePath,
              metadata: {
                contentType: mediaMeta.contentType,
                cacheControl: "public,max-age=31536000,immutable",
                metadata: {
                  originalPath: question.media?.path ?? "",
                  filename: mediaMeta.filename,
                },
              },
            });
            question.media!.storagePath = storagePath;
            question.media!.contentType = mediaMeta.contentType;
            question.media!.size = mediaMeta.size;
            question.media!.filename = mediaMeta.filename;
          }
          batch.set(questionRef, {
            order: question.order,
            prompt: question.prompt,
            media: question.media?.storagePath
              ? {
                  storagePath: question.media.storagePath,
                  contentType: question.media.contentType,
                  size: question.media.size,
                  autoplay: question.media.autoplay,
                  filename: question.media.filename,
                  originalPath: question.media.path,
                }
              : null,
          });

          const answerRef = roundRef.collection("answers").doc(questionId);
          batch.set(answerRef, {
            answer: question.answer,
          });
        }
      } else {
        let promptOrder = 0;

        for (const question of round.questions) {
          const promptText =
            question.prompt ??
            (question.answer?.trim().length ? question.answer.trim() : null);
          const mediaMeta = question.media?.path
            ? mediaFiles.get(question.media.path)
            : null;
          const storagePath =
            mediaMeta && question.media
              ? posix.join("rooms", roomId, "media", question.media.path.replace(/^[\\/]+/, "").replace(/\\/g, "/"))
              : null;
          if (mediaMeta && storagePath) {
            await bucket.upload(mediaMeta.absolutePath, {
              destination: storagePath,
              metadata: {
                contentType: mediaMeta.contentType,
                cacheControl: "public,max-age=31536000,immutable",
                metadata: {
                  originalPath: question.media?.path ?? "",
                  filename: mediaMeta.filename,
                },
              },
            });
            question.media!.storagePath = storagePath;
            question.media!.contentType = mediaMeta.contentType;
            question.media!.size = mediaMeta.size;
            question.media!.filename = mediaMeta.filename;
          }

          if (!storagePath || !question.media?.storagePath) {
            continue;
          }

          const imageRef = roundRef.collection("images").doc();
          batch.set(imageRef, {
            media: {
              storagePath: question.media.storagePath,
              contentType: question.media.contentType,
              size: question.media.size,
              autoplay: question.media.autoplay,
              filename: question.media.filename,
              originalPath: question.media.path,
            },
          });

          if (promptText) {
            const promptRef = roundRef.collection("prompts").doc();
            batch.set(promptRef, {
              order: promptOrder,
              prompt: promptText,
            });
            const answerRef = roundRef.collection("answers").doc(promptRef.id);
            batch.set(answerRef, {
              answer: imageRef.id,
            });
            promptOrder += 1;
          }
        }
      }
    }

    await batch.commit();

    return NextResponse.json({ id: roomId, title: name }, { status: 201 });
  } catch (error) {
    console.error("[rooms-create]", error);
    return NextResponse.json(
      { message: "Unable to create room right now. Please try again." },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function guessContentType(ext: string): string {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return "application/octet-stream";
  }
}
