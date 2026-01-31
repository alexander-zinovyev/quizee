"use client";

import { FormEvent, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";

import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type SlugStatus = "idle" | "checking" | "available" | "unavailable" | "error";
const ROOM_ID_REGEX = /^[a-z0-9-]{3,50}$/;

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
      const formData = new FormData();

      formData.append("id", trimmedRoomId);
      formData.append("name", trimmedRoomName);
      formData.append("hostName", hostName.trim());
      formData.append("password", roomPassword.trim());
      if (quizPack) {
        formData.append("quizPack", quizPack);
      }

      const payload = await new Promise<{
        status: number;
        body?: { message?: string; id?: string };
      }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/rooms");
        xhr.responseType = "json";
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.min(
            80,
            Math.round((event.loaded / event.total) * 80)
          );
          setUploadPhase("Uploading quiz pack...");
          setUploadPercent(percent);
        };

        xhr.onreadystatechange = () => {
          if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED) {
            setUploadPhase("Processing quiz pack...");
            setUploadPercent((prev) => Math.max(prev, 85));
          }
        };

        xhr.onload = () => {
          setUploadPhase("Finalizing...");
          setUploadPercent(100);
          resolve({ status: xhr.status, body: xhr.response ?? undefined });
        };

        xhr.onerror = () => {
          reject(new Error("Network error during upload."));
        };

        xhr.send(formData);
      });

      if (payload.status < 200 || payload.status >= 300) {
        setStatusMessage(payload.body?.message ?? "Unable to create room.");
        setSlugStatus("error");
        return;
      }

      const createdId = payload.body?.id ?? trimmedRoomId;
      setStatusMessage("Room created. Redirecting...");
      setSlugStatus("available");
      setTimeout(() => {
        router.push(`/${createdId}`);
      }, 300);
    } catch (error) {
      console.error("[host-room-create]", error);
      setStatusMessage("Network error. Please try again.");
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
