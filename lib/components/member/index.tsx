"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type MemberProps = {
  /**
   * Display name rendered underneath the placeholder/video.
   */
  name: string;
  /**
   * Future-facing hook for piping in a MediaStream when A/V is available.
   */
  stream?: MediaStream | null;
  /**
   * Optional audio track to render in the member tile.
   */
  audioTrack?: MediaStreamTrack;
  /**
   * Optional video track to render in the member tile.
   */
  videoTrack?: MediaStreamTrack;
  /**
   * Whether this member has raised their hand.
   */
  handRaised?: boolean;
  /**
   * Optional click handler to lower the hand.
   */
  onHandClick?: () => void;
  /**
   * Disable audio controls for this member.
   */
  controlsDisabled?: boolean;
  /**
   * Force local mute regardless of controls.
   */
  forceMuted?: boolean;
  /**
   * Mute the underlying video element. Useful for the local participant.
   */
  muted?: boolean;
};

export default function Member({
  name,
  stream,
  audioTrack,
  videoTrack,
  handRaised = false,
  onHandClick,
  controlsDisabled = false,
  forceMuted = false,
  muted = true,
}: MemberProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const speakingFrameRef = useRef<number | null>(null);
  const speakingReleaseTimeoutRef = useRef<number | null>(null);
  const [isMuted, setIsMuted] = useState(muted);
  const [volume, setVolume] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const resolvedVideoTrack =
    videoTrack ?? stream?.getVideoTracks?.()[0] ?? undefined;
  const resolvedAudioTrack =
    audioTrack ?? stream?.getAudioTracks?.()[0] ?? undefined;
  const hasVideo = Boolean(resolvedVideoTrack);
  const hasAudio = Boolean(resolvedAudioTrack);
  const effectiveMuted = forceMuted ? true : isMuted;
  const showAudioControls = hasAudio && !muted && !controlsDisabled;
  const showHand = handRaised;
  const canLowerHand = Boolean(onHandClick);
  const initials = name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (resolvedVideoTrack) {
      video.srcObject = new MediaStream([resolvedVideoTrack]);
      const playPromise = video.play();
      if (playPromise) {
        playPromise.catch(() => {
          // Autoplay restrictions might block play; swallow to avoid noise.
        });
      }
    } else {
      video.pause();
      video.srcObject = null;
    }

    return () => {
      if (video.srcObject) {
        video.pause();
        video.srcObject = null;
      }
    };
  }, [resolvedVideoTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (resolvedAudioTrack) {
      audio.srcObject = new MediaStream([resolvedAudioTrack]);
      audio.muted = effectiveMuted;
      audio.volume = volume;
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          // Autoplay restrictions might block play; swallow to avoid noise.
        });
      }
    } else {
      audio.pause();
      audio.srcObject = null;
    }

    return () => {
      if (audio.srcObject) {
        audio.pause();
        audio.srcObject = null;
      }
    };
  }, [resolvedAudioTrack, effectiveMuted, volume]);

  useEffect(() => {
    setIsMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (!resolvedAudioTrack || !resolvedAudioTrack.enabled || resolvedAudioTrack.readyState !== "live") {
      setIsSpeaking(false);
      return;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.85;

    const sourceStream = new MediaStream([resolvedAudioTrack]);
    const source = audioContext.createMediaStreamSource(sourceStream);
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let activeFrames = 0;

    const updateSpeakingState = () => {
      analyser.getByteTimeDomainData(samples);

      let sumSquares = 0;

      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sumSquares += centered * centered;
      }

      const rms = Math.sqrt(sumSquares / samples.length);
      if (rms > 0.02) {
        activeFrames = Math.min(activeFrames + 1, 3);

        if (speakingReleaseTimeoutRef.current !== null) {
          window.clearTimeout(speakingReleaseTimeoutRef.current);
          speakingReleaseTimeoutRef.current = null;
        }

        if (activeFrames >= 2) {
          setIsSpeaking((prev) => (prev ? prev : true));
        }
      } else {
        activeFrames = 0;

        if (speakingReleaseTimeoutRef.current === null) {
          speakingReleaseTimeoutRef.current = window.setTimeout(() => {
            setIsSpeaking(false);
            speakingReleaseTimeoutRef.current = null;
          }, 300);
        }
      }

      speakingFrameRef.current = window.requestAnimationFrame(updateSpeakingState);
    };

    if (audioContext.state === "suspended") {
      void audioContext.resume().catch(() => {
        // Resume can fail until user interaction; detection will stay inactive.
      });
    }

    speakingFrameRef.current = window.requestAnimationFrame(updateSpeakingState);

    return () => {
      if (speakingFrameRef.current !== null) {
        window.cancelAnimationFrame(speakingFrameRef.current);
        speakingFrameRef.current = null;
      }

      if (speakingReleaseTimeoutRef.current !== null) {
        window.clearTimeout(speakingReleaseTimeoutRef.current);
        speakingReleaseTimeoutRef.current = null;
      }

      setIsSpeaking(false);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close().catch(() => {
        // Ignore teardown errors from already-closed contexts.
      });
    };
  }, [resolvedAudioTrack]);

  return (
    <figure className="group flex w-full flex-col items-center gap-2 text-center">
      <div
        className={`relative aspect-video w-full overflow-hidden rounded-2xl border border-black/40 bg-zinc-900/80 shadow-xl transition-shadow ${
          isSpeaking
            ? "ring-2 ring-emerald-200-80 dark:ring-emerald-400/80"
            : "ring-0 ring-transparent"
        } dark:border-black/60 dark:bg-zinc-950/80`}
      >
        <video
          ref={videoRef}
          muted={muted}
          playsInline
          autoPlay
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            hasVideo ? "opacity-100" : "opacity-0"
          }`}
        />
        <audio ref={audioRef} muted={effectiveMuted} />

        {showHand ? (
          <div className="absolute left-3 top-3 z-20">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onHandClick?.();
              }}
              disabled={!canLowerHand}
              className={[
                "inline-flex h-7 w-7 items-center justify-center rounded-full transition",
                canLowerHand
                  ? "cursor-pointer bg-transparent text-white hover:bg-black/20 hover:text-white/20"
                  : "cursor-default text-white",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label="Lower hand"
              title="Lower hand"
            >
              <Image src="/hand.svg" alt="" width={16} height={16} className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {!hasVideo ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-800 via-zinc-900 to-black text-white/80">
            <span className="text-3xl font-semibold tracking-widest text-white">
              {initials || "?"}
            </span>
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.5em] text-white/50">
              Offline
            </span>
          </div>
        ) : null}

        <div
          className={`pointer-events-none absolute inset-x-3 bottom-3 flex items-center gap-3 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/90 opacity-0 transition duration-200 group-hover:opacity-100 ${
            showAudioControls ? "" : "hidden"
          }`}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsMuted((prev) => !prev);
            }}
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center text-white/90 hover:text-white"
            title={isMuted ? "Unmute" : "Mute"}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M12 6v12a1 1 0 0 1-1.7.7L6 14H3a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3l4.3-4.7A1 1 0 0 1 12 6z" />
                <path d="M16 10l6 6" />
                <path d="M22 10l-6 6" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M12 6v12a1 1 0 0 1-1.7.7L6 14H3a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3l4.3-4.7A1 1 0 0 1 12 6z" />
                <path d="M16 9a4 4 0 0 1 0 6" />
                <path d="M19 6a7 7 0 0 1 0 12" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            className="pointer-events-auto h-1 w-full accent-emerald-400"
            aria-label="Volume"
          />
        </div>
      </div>

      <figcaption className="flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
        <span className="truncate">{name}</span>
      </figcaption>
    </figure>
  );
}
