"use client";

import { useEffect, useMemo, useState } from "react";
import Team, { type TeamMember } from "@/components/team";

type Scenario = "trio" | "full" | "empty";

const rosterOptions: Array<{
  id: Scenario;
  label: string;
  helper: string;
  count: number;
}> = [
  {
    id: "trio",
    label: "Scrimmage trio",
    helper: "Shows the tight three-up layout with placeholders.",
    count: 3,
  },
  {
    id: "full",
    label: "Tournament roster",
    helper: "Fills all four columns so you can inspect spacing.",
    count: 7,
  },
  {
    id: "empty",
    label: "Empty lobby",
    helper: "Demonstrates the emptyLabel copy.",
    count: 0,
  },
];

const remoteRoster: TeamMember[] = [
  { id: "captain", name: "Anika I." },
  { id: "strategist", name: "Malik P." },
  { id: "decoder", name: "Ivy T." },
  { id: "lookup", name: "Noor F." },
  { id: "scribe", name: "Sasha L." },
  { id: "researcher", name: "Pia W." },
];

export default function TeamShowcase() {
  const [scenario, setScenario] = useState<Scenario>("full");
  const [selfStream, setSelfStream] = useState<MediaStream | null>(null);
  const [isRequestingStream, setIsRequestingStream] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (!selfStream) {
        return;
      }
      selfStream.getTracks().forEach((track) => track.stop());
    };
  }, [selfStream]);

  async function toggleCameraPreview() {
    if (selfStream) {
      selfStream.getTracks().forEach((track) => track.stop());
      setSelfStream(null);
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera APIs are not available in this environment.");
      return;
    }

    try {
      setIsRequestingStream(true);
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: false,
      });
      setSelfStream(stream);
    } catch (err) {
      setError("Camera permission was denied or no camera is available.");
    } finally {
      setIsRequestingStream(false);
    }
  }

  const activeScenario = rosterOptions.find((option) => option.id === scenario) ?? rosterOptions[0];

  const members = useMemo<TeamMember[]>(() => {
    if (!activeScenario.count) {
      return [];
    }

    const remoteCount = Math.max(activeScenario.count - 1, 0);
    const remoteMembers = remoteRoster.slice(0, remoteCount);
    const localMember: TeamMember = {
      id: "self",
      name: "You",
      stream: selfStream ?? undefined,
      muted: true,
    };

    return [...remoteMembers, localMember];
  }, [activeScenario.count, selfStream]);

  return (
    <div className="flex w-full flex-col gap-6">
      <section className="rounded-3xl border border-dashed border-zinc-200 bg-white/80 p-8 shadow-inner dark:border-zinc-800 dark:bg-zinc-900/70">
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-white">What to explore</h2>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Switch between roster sizes to watch the grid reflow, and optionally start a local video feed so the
          Member component renders a live stream instead of the placeholder avatar.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {rosterOptions.map((option) => {
            const isActive = option.id === scenario;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setScenario(option.id)}
                className={`rounded-2xl border px-4 py-3 text-left text-sm shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  isActive
                    ? "border-emerald-500 bg-emerald-50/70 text-emerald-900 dark:border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-200"
                    : "border-zinc-200 bg-white/60 text-zinc-700 hover:border-emerald-300 hover:text-emerald-900 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300"
                }`}
                aria-pressed={isActive}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                  {option.helper}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          {activeScenario.id === "empty"
            ? "No one has joined the room yet, so the component falls back to the provided emptyLabel."
            : "The final slot always represents the local participant so you can preview self video next to teammates."}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={toggleCameraPreview}
            disabled={isRequestingStream}
            className={`rounded-full px-5 py-2 text-sm font-semibold text-white transition ${
              selfStream
                ? "bg-emerald-600 hover:bg-emerald-500"
                : "bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"
            } ${isRequestingStream ? "opacity-70" : ""}`}
          >
            {selfStream ? "Stop camera preview" : "Start camera preview"}
          </button>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {error
              ? error
              : "Live video never leaves the browser; it simply feeds the Member component."}
          </p>
        </div>
      </section>

      <Team
        name="Trivia Titans"
        description="The Team component automatically adapts column count and swaps from placeholder avatars to live video streams."
        members={members}
        emptyLabel="No teammates have joined this lobby yet. Invite your crew to populate the grid."
      />
    </div>
  );
}
