"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { AudioPlayback, formatAudioTime } from "@/lib/media/audio-playback";

type AudioPlayerProps = {
  url: string;
  durationSeconds?: number;
  volume: number;
  playbackActive?: boolean;
  playbackKey?: string;
  label: string;
  className?: string;
};

/** Changing attachments resets playback even when the downloaded URL is shared. */
export default function AudioPlayer(props: AudioPlayerProps) {
  return <AudioPlayerSession key={`${props.url}:${props.playbackKey ?? ""}:${props.durationSeconds ?? "full"}`} {...props} />;
}

function AudioPlayerSession({ url, durationSeconds, volume, playbackActive = true, label, className }: AudioPlayerProps) {
  const playbackRef = useRef<AudioPlayback | null>(null);
  const activeRef = useRef(playbackActive);
  const gainRef = useRef(volume);
  const [playback, setPlayback] = useState<AudioPlayback | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(volume);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let disposed = false;
    const abort = new AbortController();
    const context = new AudioContext();
    let player: AudioPlayback | null = null;
    const update = () => {
      if (disposed || !player) return;
      setPosition(player.position);
      setPlaying(player.playing);
    };
    void (async () => {
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error("Unable to download audio.");
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (disposed) return;
        player = new AudioPlayback(context, buffer, durationSeconds, update);
        player.gain.gain.value = gainRef.current;
        playbackRef.current = player;
        setPlayback(player);
        // Autoplay can be blocked by the browser; manual playback stays available.
        if (activeRef.current) void player.play().catch(() => undefined);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Unable to load audio.");
      }
    })();
    return () => {
      disposed = true;
      abort.abort();
      player?.dispose();
      playbackRef.current = null;
      void context.close();
    };
  }, [url, durationSeconds]);

  useEffect(() => {
    const wasActive = activeRef.current;
    activeRef.current = playbackActive;
    if (!playbackActive) {
      playbackRef.current?.pause();
      playbackRef.current?.seek(0);
    } else if (!wasActive) {
      void playbackRef.current?.play().catch(() => undefined);
    }
  }, [playbackActive]);

  useEffect(() => { setLevel(volume); }, [volume]);

  useEffect(() => {
    gainRef.current = muted ? 0 : level;
    if (playback) playback.gain.gain.value = gainRef.current;
  }, [playback, muted, level]);

  useEffect(() => {
    if (!playing || !playback) return;
    let frame: number;
    const update = () => {
      setPosition(playback.position);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, playback]);

  const total = durationSeconds ?? playback?.duration ?? 0;
  const displayedTotal = durationSeconds ?? Number(total.toFixed(3));
  const displayedPosition = position >= total ? displayedTotal : Math.floor(position * 100) / 100;
  const disabled = !playback || !playbackActive || !!error;
  const buttonClass = "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:opacity-40";

  return (
    <div role="group" aria-label={label} className={`rounded-xl bg-zinc-900 p-4 text-white ${className ?? "w-full"}`}>
      <input type="range" aria-label="Audio position" min={0} max={total || 1} step="any" value={position}
        disabled={disabled} onChange={(event) => playback?.seek(Number(event.target.value))}
        aria-valuetext={`${formatAudioTime(displayedPosition)} of ${formatAudioTime(displayedTotal)}`}
        className="w-full accent-emerald-400" />
      <p className="mt-1 text-center text-sm font-normal tabular-nums" aria-label="Audio time">
        {formatAudioTime(displayedPosition)} / {formatAudioTime(displayedTotal)}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" aria-label={playing ? "Pause audio" : "Play audio"} disabled={disabled} className={buttonClass}
          onClick={() => {
            if (playing) playback?.pause();
            else void playback?.play().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to play audio."));
          }}>{playing ? <Pause size={20} /> : <Play size={20} />}</button>
        <button type="button" aria-label="Rewind audio" disabled={disabled} className={buttonClass}
          onClick={() => playback?.seek(0)}><RotateCcw size={20} /></button>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <button type="button" aria-label={muted ? "Unmute audio" : "Mute audio"} aria-pressed={muted}
            className={buttonClass} onClick={() => setMuted(!muted)}>{muted || level === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
          <input type="range" aria-label="Audio volume" min={0} max={1} step={0.01} value={muted ? 0 : level}
            onChange={(event) => { setLevel(Number(event.target.value)); setMuted(false); }} className="w-24 max-w-full accent-emerald-400" />
        </div>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm font-normal text-red-300">{error}</p> : !playback ? <p role="status" className="mt-2 text-sm font-normal">Loading audio…</p> : null}
    </div>
  );
}
