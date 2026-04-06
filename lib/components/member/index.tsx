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
  playbackControlsDisabled?: boolean;
  /**
   * Force local mute regardless of controls.
   */
  forcePlaybackMuted?: boolean;
  /**
   * Mute the underlying video element. Useful for the local participant.
   */
  playbackMuted?: boolean;
  /**
   * Whether the local participant is currently publishing audio.
   */
  localAudioEnabled?: boolean;
  /**
   * Whether the local participant is currently publishing video.
   */
  localVideoEnabled?: boolean;
  /**
   * Optional callback to toggle local audio publishing.
   */
  onToggleLocalAudioEnabled?: () => void;
  /**
   * Optional callback to toggle local video publishing.
   */
  onToggleLocalVideoEnabled?: () => void;
};

export default function Member({
  name,
  stream,
  audioTrack,
  videoTrack,
  handRaised = false,
  onHandClick,
  playbackControlsDisabled = false,
  forcePlaybackMuted = false,
  playbackMuted = true,
  localAudioEnabled,
  localVideoEnabled,
  onToggleLocalAudioEnabled,
  onToggleLocalVideoEnabled,
}: MemberProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const speakingFrameRef = useRef<number | null>(null);
  const speakingReleaseTimeoutRef = useRef<number | null>(null);
  const [isPlaybackMuted, setIsPlaybackMuted] = useState(playbackMuted);
  const [volume, setVolume] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const resolvedVideoTrack =
    videoTrack ?? stream?.getVideoTracks?.()[0] ?? undefined;
  const resolvedAudioTrack =
    audioTrack ?? stream?.getAudioTracks?.()[0] ?? undefined;
  const hasVideo = Boolean(resolvedVideoTrack);
  const hasAudio = Boolean(resolvedAudioTrack);
  const effectivePlaybackMuted = forcePlaybackMuted ? true : isPlaybackMuted;
  const showPlaybackControls = hasAudio && !playbackMuted && !playbackControlsDisabled;
  const showLocalMediaControls =
    typeof onToggleLocalAudioEnabled === "function" ||
    typeof onToggleLocalVideoEnabled === "function";
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
      audio.muted = effectivePlaybackMuted;
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
  }, [resolvedAudioTrack, effectivePlaybackMuted, volume]);

  useEffect(() => {
    setIsPlaybackMuted(playbackMuted);
  }, [playbackMuted]);

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
          muted={playbackMuted}
          playsInline
          autoPlay
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            hasVideo ? "opacity-100" : "opacity-0"
          }`}
        />
        <audio ref={audioRef} muted={effectivePlaybackMuted} />

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
            showPlaybackControls ? "" : "hidden"
          }`}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsPlaybackMuted((prev) => !prev);
            }}
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center text-white/90 hover:text-white"
            title={isPlaybackMuted ? "Unmute playback" : "Mute playback"}
            aria-label={isPlaybackMuted ? "Unmute playback" : "Mute playback"}
          >
            {isPlaybackMuted ? (
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

        {showLocalMediaControls ? (
          <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 opacity-0 transition duration-200 group-hover:opacity-100">
            {typeof onToggleLocalAudioEnabled === "function" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLocalAudioEnabled();
                }}
                className={[
                  "pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border bg-black/50 transition hover:bg-black/70",
                  localAudioEnabled
                    ? "border-white/20 text-white"
                    : "border-red-400/60 text-red-400",
                ].join(" ")}
                title={localAudioEnabled ? "Turn microphone off" : "Turn microphone on"}
                aria-label={localAudioEnabled ? "Turn microphone off" : "Turn microphone on"}
              >
                {localAudioEnabled ? (
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
                    <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <path d="M12 19v3" />
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
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
                    <path d="M15 9V6a3 3 0 0 0-5.77-1.2" />
                    <path d="M17 17a7 7 0 0 1-10-5v-2" />
                    <path d="M19 10v2a7 7 0 0 1-.65 2.95" />
                    <path d="M12 19v3" />
                    <path d="M4 4l16 16" />
                  </svg>
                )}
              </button>
            ) : null}
            {typeof onToggleLocalVideoEnabled === "function" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLocalVideoEnabled();
                }}
                className={[
                  "pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border bg-black/50 transition hover:bg-black/70",
                  localVideoEnabled
                    ? "border-white/20 text-white"
                    : "border-red-400/60 text-red-400",
                ].join(" ")}
                title={localVideoEnabled ? "Turn camera off" : "Turn camera on"}
                aria-label={localVideoEnabled ? "Turn camera off" : "Turn camera on"}
              >
                {localVideoEnabled ? (
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
                    <path d="M15 10l4.55-2.28A1 1 0 0 1 21 8.62v6.76a1 1 0 0 1-1.45.9L15 14" />
                    <rect x="3" y="6" width="12" height="12" rx="2" ry="2" />
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
                    <path d="M10.66 6H13a2 2 0 0 1 2 2v2.34" />
                    <path d="M15 14l4.55 2.28A1 1 0 0 0 21 15.38V10" />
                    <path d="M3 3l18 18" />
                    <path d="M3 8a2 2 0 0 1 2-2h5" />
                    <path d="M3 8v8a2 2 0 0 0 2 2h10" />
                  </svg>
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <figcaption className="flex items-center justify-center text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
        <span className="truncate">{name}</span>
      </figcaption>
    </figure>
  );
}
