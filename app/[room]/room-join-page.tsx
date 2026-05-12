"use client";

import { FormEvent, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import Member from "@/lib/components/member";

type JoinResponse = {
  message?: string;
};

type RoomJoinPageProps = {
  roomSlug: string;
  onJoined?: () => void;
};

export default function RoomJoinPage({ roomSlug, onJoined }: RoomJoinPageProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [roomTitle, setRoomTitle] = useState<string | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(true);
  const [roomMissing, setRoomMissing] = useState(false);
  const [previewAudioTrack, setPreviewAudioTrack] = useState<MediaStreamTrack | undefined>();
  const [previewVideoTrack, setPreviewVideoTrack] = useState<MediaStreamTrack | undefined>();
  const [localAudioEnabled, setLocalAudioEnabled] = useState(true);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
  const { loading: authLoading, getToken } = useFirebaseAuth();

  useEffect(() => {
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    async function loadPreview() {
      if (!navigator.mediaDevices?.getUserMedia) {
        return;
      }

      try {
        activeStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
      } catch (preferredError) {
        const fallbacks: MediaStreamConstraints[] = [{ video: true }, { audio: true }];

        for (const constraints of fallbacks) {
          try {
            activeStream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch {
            // Try the next fallback constraint before giving up.
          }
        }

        if (!activeStream) {
          console.warn("[room-join-preview]", preferredError);
          return;
        }
      }

      if (cancelled) {
        activeStream.getTracks().forEach((track) => track.stop());
        return;
      }

      const audioTrack = activeStream.getAudioTracks()[0];
      const videoTrack = activeStream.getVideoTracks()[0];

      setPreviewAudioTrack(audioTrack);
      setPreviewVideoTrack(videoTrack);
      setLocalAudioEnabled(audioTrack?.enabled ?? false);
      setLocalVideoEnabled(videoTrack?.enabled ?? false);
    }

    void loadPreview();

    return () => {
      cancelled = true;
      setPreviewAudioTrack(undefined);
      setPreviewVideoTrack(undefined);
      setLocalAudioEnabled(true);
      setLocalVideoEnabled(true);
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function toggleLocalAudioEnabled() {
    if (!previewAudioTrack) return;
    const nextEnabled = !previewAudioTrack.enabled;
    previewAudioTrack.enabled = nextEnabled;
    setLocalAudioEnabled(nextEnabled);
  }

  function toggleLocalVideoEnabled() {
    if (!previewVideoTrack) return;
    const nextEnabled = !previewVideoTrack.enabled;
    previewVideoTrack.enabled = nextEnabled;
    setLocalVideoEnabled(nextEnabled);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRoom() {
      setIsLoadingRoom(true);
      setRoomMissing(false);
      setError(null);

      try {
        const db = getClientFirestore();
        const roomRef = doc(db, "rooms", roomSlug);
        const snap = await getDoc(roomRef);

        if (!snap.exists()) {
          if (!cancelled) {
            setRoomMissing(true);
            setRoomTitle(null);
          }
          return;
        }

        const data = snap.data() as { title?: string };
        if (!cancelled) {
          setRoomTitle(data.title ?? roomSlug);
        }
      } catch (loadError) {
        console.error("[room-load]", loadError);
        if (!cancelled) {
          setError("Unable to load room. Please try again.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRoom(false);
        }
      }
    }

    loadRoom();

    return () => {
      cancelled = true;
    };
  }, [roomSlug]);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

  if (!name.trim() || !password.trim()) {
    setError("Both name and password are required.");
    return;
  }

    if (authLoading) {
      setError("Initializing session. Please wait a moment.");
      return;
    }

    setError(null);
    setConfirmation(null);
    setIsJoining(true);

    try {
      const token = await getToken();
      const response = await fetch(`/api/rooms/${roomSlug}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          room: roomSlug,
          name: name.trim(),
          password: password.trim(),
        }),
      });

      const payload: JoinResponse | undefined = await response
        .json()
        .catch(() => undefined);

      if (!response.ok) {
        setError(payload?.message ?? "Unable to join the room. Try again.");
        return;
      }

      setConfirmation(payload?.message ?? "Joined the room. Loading…");
      onJoined?.();
    } catch (err) {
      console.error("[room-join]", err);
      setError("Network error. Please try again.");
    } finally {
      setIsJoining(false);
    }
  }

  if (roomMissing && !isLoadingRoom) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-white via-zinc-50 to-zinc-100 p-4 text-center dark:from-black dark:via-zinc-950 dark:to-zinc-900">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Room not found
          </p>
          <p className="text-lg text-zinc-800 dark:text-zinc-100">
            We couldn&apos;t find a room with the slug &ldquo;{roomSlug}&rdquo;.
          </p>
        </div>
      </div>
    );
  }

  const roomName = roomTitle ?? roomSlug;
  const isFormDisabled = isJoining || isLoadingRoom || authLoading;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-b from-white via-zinc-50 to-zinc-100 p-4 dark:from-black dark:via-zinc-950 dark:to-zinc-900">
      <main className="grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-center">
        <section className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
            <div className="text-center lg:text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
                Local Preview
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Check your camera, microphone, and display name before joining.
              </p>
            </div>
            <Member
              name={name.trim() || "Your name"}
              audioTrack={previewAudioTrack}
              videoTrack={previewVideoTrack}
              playbackMuted
              localAudioEnabled={localAudioEnabled}
              localVideoEnabled={localVideoEnabled}
              onToggleLocalAudioEnabled={previewAudioTrack ? toggleLocalAudioEnabled : undefined}
              onToggleLocalVideoEnabled={previewVideoTrack ? toggleLocalVideoEnabled : undefined}
            />
          </div>
        </section>

        <section className="space-y-5 text-center lg:text-left">
          <p className="text-center text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
            Room {roomName}
          </p>
          <form
            onSubmit={handleJoin}
            className="space-y-5 rounded-3xl border border-zinc-200 bg-white/90 p-8 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/85"
          >
            <div>
              <label
                htmlFor="room-join-name"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
              >
                Name
              </label>
              <input
                id="room-join-name"
                name="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-base text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30"
                placeholder="Jess Patel"
                disabled={isFormDisabled}
                required
              />
            </div>

            <div>
              <label
                htmlFor="room-join-password"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
              >
                Room password
              </label>
              <input
                id="room-join-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-base text-zinc-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-500 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/30"
                placeholder="••••••"
                disabled={isFormDisabled}
                required
              />
            </div>

            {error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            {confirmation ? (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                {confirmation}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isFormDisabled}
              className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300 dark:focus:ring-emerald-300 dark:focus:ring-offset-zinc-900"
            >
              {isLoadingRoom
                ? "Loading..."
                : authLoading
                  ? "Starting session..."
                  : isJoining
                    ? "Joining..."
                    : "Join"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
