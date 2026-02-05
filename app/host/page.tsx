"use client";

import { FormEvent, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { getStorage, ref, uploadBytesResumable } from "firebase/storage";
import { gunzipSync } from "fflate";

import { getClientFirestore, getFirebaseClientApp } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type SlugStatus = "idle" | "checking" | "available" | "unavailable" | "error";
const ROOM_ID_REGEX = /^[a-z0-9-]{3,50}$/;
const MAX_TAR_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".mp4",
  ".mov",
  ".webm",
]);

type UploadSession = {
  sessionId: string;
  uploadPrefix: string;
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
  expiresAt: number;
};

export default function HostPage() {
  const [roomId, setRoomId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [hostName, setHostName] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quizPack, setQuizPack] = useState<File | null>(null);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState(0);
  const { loading: authLoading, getToken } = useFirebaseAuth();
  const router = useRouter();

  const trimmedRoomId = roomId.trim().toLowerCase();
  const trimmedRoomName = roomName.trim();

  useEffect(() => {
    const controller = new AbortController();

    async function checkAvailability() {
      if (!trimmedRoomId) {
        setSlugStatus("idle");
        setStatusMessage(null);
        return;
      }

      if (trimmedRoomId === "host") {
        setSlugStatus("unavailable");
        setStatusMessage("Room id \"host\" is reserved.");
        return;
      }

      if (!ROOM_ID_REGEX.test(trimmedRoomId)) {
        setSlugStatus("unavailable");
        setStatusMessage(
          "Use 3-50 chars: lowercase letters, numbers, or dashes."
        );
        return;
      }

      setSlugStatus("checking");
      setStatusMessage(null);

      try {
        const db = getClientFirestore();
        const ref = doc(db, "rooms", trimmedRoomId);
        const snap = await getDoc(ref);

        if (controller.signal.aborted) return;

        if (snap.exists()) {
          setSlugStatus("unavailable");
          setStatusMessage("Room id is already taken.");
        } else {
          setSlugStatus("available");
          setStatusMessage("Room id is available.");
        }
      } catch (error) {
        console.error("[host-room-check]", error);
        if (controller.signal.aborted) return;
        setSlugStatus("error");
        setStatusMessage("Unable to check availability right now.");
      }
    }

    const debounce = setTimeout(() => {
      void checkAvailability();
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(debounce);
    };
  }, [trimmedRoomId]);

  const isSubmitDisabled =
    isSubmitting ||
    authLoading ||
    !trimmedRoomId ||
    !trimmedRoomName ||
    !hostName.trim() ||
    !roomPassword.trim() ||
    !quizPack ||
    slugStatus === "unavailable" ||
    slugStatus === "checking";

  const statusTone =
    slugStatus === "available"
      ? "text-emerald-600 dark:text-emerald-400"
      : slugStatus === "unavailable" || slugStatus === "error"
        ? "text-red-600 dark:text-red-400"
        : "text-zinc-500 dark:text-zinc-400";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    setStatusMessage(null);
    setUploadPhase("Preparing upload...");
    setUploadPercent(0);

    try {
      const token = await getToken();
      if (!quizPack) {
        setStatusMessage("Quiz pack is required.");
        setSlugStatus("error");
        return;
      }
      if (quizPack.size > MAX_TAR_SIZE_BYTES) {
        setStatusMessage("Quiz pack is too large to process in the browser.");
        setSlugStatus("error");
        return;
      }

      setUploadPhase("Requesting upload session...");
      setUploadPercent(5);
      const sessionResponse = await fetch("/api/rooms/upload-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId: trimmedRoomId }),
      });
      const sessionPayload = (await sessionResponse.json()) as UploadSession & {
        message?: string;
      };
      if (!sessionResponse.ok) {
        setStatusMessage(sessionPayload.message ?? "Unable to prepare upload.");
        setSlugStatus("error");
        return;
      }

      setUploadPhase("Unpacking quiz pack...");
      setUploadPercent(10);
      const packedBuffer = await quizPack.arrayBuffer();
      const decompressed = gunzipSync(new Uint8Array(packedBuffer));
      const tarBytes = decompressed.slice();
      const { default: untar } = await import("js-untar");
      const files = await untar(tarBytes.buffer);

      let quizJsonText: string | null = null;
      const mediaEntries: Array<{
        relativePath: string;
        blob: Blob;
        size: number;
        contentType: string;
        filename: string;
      }> = [];
      let totalBytes = 0;
      let fileCount = 0;

      for (const file of files) {
        const name = file.name?.replace(/\\/g, "/") ?? "";
        if (!name || name.endsWith("/")) continue;
        if (name.includes("..") || name.startsWith("/")) {
          throw new Error(`Invalid path in quiz pack: ${name}`);
        }
        if (name === "quiz.json") {
          const text = new TextDecoder().decode(new Uint8Array(file.buffer));
          quizJsonText = text;
          continue;
        }
        if (!name.startsWith("media/")) continue;

        const normalizedPath = name.replace(/^media\//, "");
        const ext = normalizedPath.slice(normalizedPath.lastIndexOf(".")).toLowerCase();
        if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
          throw new Error(`Unsupported media extension: ${ext}`);
        }
        const size = file.buffer.byteLength;
        if (size > sessionPayload.maxFileBytes) {
          throw new Error(`Media file "${normalizedPath}" exceeds size limit.`);
        }
        totalBytes += size;
        fileCount += 1;
        if (fileCount > sessionPayload.maxFiles) {
          throw new Error("Quiz pack contains too many media files.");
        }
        if (totalBytes > sessionPayload.maxTotalBytes) {
          throw new Error("Total media size exceeds upload limits.");
        }
        const filename = normalizedPath.split("/").pop() ?? "media";
        const contentType =
          ext === ".png"
            ? "image/png"
            : ext === ".jpg" || ext === ".jpeg"
              ? "image/jpeg"
              : ext === ".gif"
                ? "image/gif"
                : ext === ".webp"
                  ? "image/webp"
                  : ext === ".svg"
                    ? "image/svg+xml"
                    : ext === ".mp3"
                      ? "audio/mpeg"
                      : ext === ".wav"
                        ? "audio/wav"
                        : ext === ".ogg"
                          ? "audio/ogg"
                          : ext === ".m4a"
                            ? "audio/mp4"
                            : ext === ".mp4"
                              ? "video/mp4"
                              : ext === ".mov"
                                ? "video/quicktime"
                                : "video/webm";
        const blob = new Blob([file.buffer], { type: contentType });
        mediaEntries.push({
          relativePath: normalizedPath,
          blob,
          size,
          contentType,
          filename,
        });
      }

      if (!quizJsonText) {
        throw new Error("quiz.json not found in quiz pack.");
      }

      setUploadPhase("Uploading media...");
      setUploadPercent(20);
      const storage = getStorage(getFirebaseClientApp());
      const mediaMap: Record<string, string> = {};
      let uploadedBytes = 0;

      if (totalBytes === 0) {
        setUploadPercent(80);
      } else {
        for (const entry of mediaEntries) {
          const uploadPath = `${sessionPayload.uploadPrefix}/media/${entry.relativePath}`;
          const storageRef = ref(storage, uploadPath);
          await new Promise<void>((resolve, reject) => {
            const task = uploadBytesResumable(storageRef, entry.blob, {
              contentType: entry.contentType,
              cacheControl: "public,max-age=31536000,immutable",
              customMetadata: {
                originalPath: entry.relativePath,
                filename: entry.filename,
              },
            });
            task.on(
              "state_changed",
              (snapshot) => {
                const progress =
                  (uploadedBytes + snapshot.bytesTransferred) / totalBytes;
                setUploadPercent(20 + Math.round(progress * 60));
              },
              (error) => reject(error),
              () => {
                uploadedBytes += entry.size;
                setUploadPercent(20 + Math.round((uploadedBytes / totalBytes) * 60));
                mediaMap[entry.relativePath] = uploadPath;
                resolve();
              }
            );
          });
        }
      }

      setUploadPhase("Finalizing...");
      setUploadPercent(85);
      const createResponse = await fetch("/api/rooms/from-manifest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: trimmedRoomId,
          name: trimmedRoomName,
          hostName: hostName.trim(),
          password: roomPassword.trim(),
          quizJson: quizJsonText,
          mediaMap,
          sessionId: sessionPayload.sessionId,
        }),
      });
      const createPayload = (await createResponse.json()) as { message?: string; id?: string };
      if (!createResponse.ok) {
        setStatusMessage(createPayload.message ?? "Unable to create room.");
        setSlugStatus("error");
        return;
      }

      setUploadPercent(100);
      const createdId = createPayload.id ?? trimmedRoomId;
      setStatusMessage("Room created. Redirecting...");
      setSlugStatus("available");
      setTimeout(() => {
        router.push(`/${createdId}`);
      }, 300);
    } catch (error) {
      console.error("[host-room-create]", error);
      setStatusMessage(
        error instanceof Error ? error.message : "Network error. Please try again."
      );
      setSlugStatus("error");
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        setUploadPhase(null);
        setUploadPercent(0);
      }, 500);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-white via-zinc-50 to-zinc-100 p-6 dark:from-black dark:via-zinc-950 dark:to-zinc-900">
      <div className="w-full max-w-xl space-y-6 rounded-3xl border border-zinc-200 bg-white/90 p-10 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/85">
        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Host
          </p>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">
            Create a room
          </h1>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label
              htmlFor="room-id"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              Room ID
            </label>
            <input
              id="room-id"
              name="roomId"
              value={roomId}
              onChange={(event) => setRoomId(event.target.value.toLowerCase())}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-base text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30"
              placeholder="e.g. friday-night-quiz"
              autoComplete="off"
              disabled={isSubmitting}
              required
            />
            <p className={`text-sm ${statusTone}`}>
              {slugStatus === "checking"
                ? "Checking availability..."
                : statusMessage ?? "Use lowercase letters, numbers, or dashes."}
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="host-name"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              Your name
            </label>
            <input
              id="host-name"
              name="hostName"
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-base text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30"
              placeholder="Quizmaster name"
              autoComplete="name"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="room-name"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              Room name
            </label>
            <input
              id="room-name"
              name="roomName"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-base text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30"
              placeholder="Friday Night Puzzle Hunt"
              autoComplete="off"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="room-password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              Room password
            </label>
            <input
              id="room-password"
              name="roomPassword"
              type="password"
              value={roomPassword}
              onChange={(event) => setRoomPassword(event.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-base text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30"
            placeholder="Secret passphrase"
            autoComplete="new-password"
            disabled={isSubmitting}
            required
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="quiz-pack"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            Quiz pack (.tar.gz)
          </label>
          <input
            id="quiz-pack"
            name="quizPack"
            type="file"
            accept=".tar.gz,.tgz,application/gzip,application/x-gtar,application/x-tgz"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setQuizPack(file ?? null);
            }}
            className="w-full rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm file:mr-4 file:rounded-xl file:border-0 file:bg-emerald-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-emerald-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:file:bg-emerald-400 dark:file:text-zinc-950 dark:hover:border-emerald-300 dark:focus:border-emerald-300 dark:focus:ring-emerald-300/30"
            disabled={isSubmitting}
            required
          />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Upload a .tar.gz containing quiz.json and optional media folder.
            {quizPack ? ` Selected: ${quizPack.name}` : ""}
          </p>
        </div>

        {uploadPhase && (
          <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200">
            <div className="flex items-center justify-between">
              <span>{uploadPhase}</span>
              <span className="tabular-nums">{uploadPercent}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all dark:bg-emerald-400"
                style={{ width: `${Math.min(uploadPercent, 100)}%` }}
              />
            </div>
          </div>
        )}

          <button
            type="submit"
            disabled={isSubmitDisabled}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300 dark:focus:ring-emerald-300 dark:focus:ring-offset-zinc-900"
          >
            {authLoading
              ? "Starting session..."
              : isSubmitting
                ? "Creating..."
                : "Create room"}
          </button>
        </form>
      </div>
    </div>
  );
}
