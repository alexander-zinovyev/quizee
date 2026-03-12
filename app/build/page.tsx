"use client";

import { useEffect, useState } from "react";
import {
  clearBuildSnapshot,
  loadBuildSnapshot,
  saveBuildSnapshot,
} from "@/lib/build/build-page-storage";
import MediaTreePanel, {
  type MediaTreePanelState,
} from "@/lib/components/build/media-tree-panel";
import type { MediaTreeFile } from "@/lib/components/build/media-tree-shared";
import RoundBuilderPanel, {
  type BuildRound,
} from "@/lib/components/build/round-builder-panel";

export default function BuildPage() {
  const [mediaFiles, setMediaFiles] = useState<MediaTreeFile[]>([]);
  const [ready, setReady] = useState(false);
  const [initialRounds, setInitialRounds] = useState<BuildRound[] | undefined>(undefined);
  const [initialMediaTreeState, setInitialMediaTreeState] = useState<MediaTreePanelState | undefined>(
    undefined
  );
  const [roundsState, setRoundsState] = useState<BuildRound[] | null>(null);
  const [mediaTreeState, setMediaTreeState] = useState<MediaTreePanelState | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const snapshot = await loadBuildSnapshot();
        if (cancelled) return;

        if (snapshot) {
          const rounds = Array.isArray(snapshot.rounds) ? (snapshot.rounds as BuildRound[]) : [];
          const mediaState = (snapshot.mediaTreeState ?? undefined) as
            | MediaTreePanelState
            | undefined;

          setInitialRounds(rounds);
          setRoundsState(rounds);

          if (mediaState) {
            setInitialMediaTreeState(mediaState);
            setMediaTreeState(mediaState);
          }
        }
      } catch {
        await clearBuildSnapshot().catch(() => undefined);
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !roundsState || !mediaTreeState) return;

    const timer = window.setTimeout(() => {
      saveBuildSnapshot({
        rounds: roundsState,
        mediaTreeState,
      }).catch(() => undefined);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [mediaTreeState, ready, roundsState]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-zinc-100 p-4 dark:bg-zinc-950">
        <main className="grid min-h-[calc(100vh-2rem)] place-items-center rounded-2xl border border-zinc-200 bg-white text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Loading builder...
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 p-4 dark:bg-zinc-950">
      <main className="grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        <MediaTreePanel
          initialState={initialMediaTreeState}
          onMediaFilesChange={setMediaFiles}
          onStateChange={setMediaTreeState}
        />
        <RoundBuilderPanel
          mediaFiles={mediaFiles}
          initialRounds={initialRounds}
          onRoundsChange={setRoundsState}
        />
      </main>
    </div>
  );
}
