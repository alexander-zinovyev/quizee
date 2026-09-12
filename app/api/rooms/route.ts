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
      } else {
        round.questions.forEach((q) => {
          if (q.prompt?.media?.path) {
            referencedMedia.add(q.prompt.media.path);
          }
          referencedMedia.add(q.imagePath);
        });
      }
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
    const uploadedMedia = new Set<string>();
    const resolveMedia = async (path: string) => {
      const mediaMeta = mediaFiles.get(path);
      if (!mediaMeta) {
        throw new Error(`Missing media file "${path}" in quiz pack.`);
      }
      const storagePath = posix.join(
        "rooms",
        roomId,
        "media",
        path.replace(/^[\\/]+/, "").replace(/\\/g, "/")
      );
      if (!uploadedMedia.has(storagePath)) {
        await bucket.upload(mediaMeta.absolutePath, {
          destination: storagePath,
          metadata: {
            contentType: mediaMeta.contentType,
            cacheControl: "public,max-age=31536000,immutable",
            metadata: {
              originalPath: path,
              filename: mediaMeta.filename,
            },
          },
        });
        uploadedMedia.add(storagePath);
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
      title: name,
      state: INITIAL_ROOM_STATE,
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
          const imageMedia = await resolveMedia(question.imagePath);
          const imageRef = roundRef.collection("images").doc();
          batch.set(imageRef, {
            media: {
              storagePath: imageMedia.storagePath,
              contentType: imageMedia.contentType,
              size: imageMedia.size,
              filename: imageMedia.filename,
              originalPath: imageMedia.originalPath,
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
