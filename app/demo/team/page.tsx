import type { Metadata } from "next";
import TeamShowcase from "./team-showcase";

export const metadata: Metadata = {
  title: "Team demo",
  description: "Interactive playground for the Team component that renders members as avatars or live video.",
};

export default function TeamDemoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-zinc-50 to-zinc-100 py-16 dark:from-black dark:via-zinc-900 dark:to-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6">
        <header className="space-y-4 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
            Component demo
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold text-zinc-900 dark:text-white">Team component playground</h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Preview how the Team panel scales from small groups to a full roster, and optionally start a local
              camera feed so Member tiles swap from the placeholder avatar to a live MediaStream. Nothing leaves your
              browser—this page only demonstrates the UI behaviors.
            </p>
          </div>
        </header>

        <TeamShowcase />
      </main>
    </div>
  );
}
