import type { Metadata } from "next";
import ChatShowcase from "./chat-showcase";

export const metadata: Metadata = {
  title: "Chat demo",
  description: "Playground for the in-room Chat component with formatting and emoji controls.",
};

export default function ChatDemoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-zinc-50 to-zinc-100 py-16 dark:from-black dark:via-zinc-900 dark:to-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6">
        <header className="space-y-4 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
            Component demo
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold text-zinc-900 dark:text-white">
              Chat component playground
            </h1>
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Try the formatting buttons, emoji picker, and responsive layout of the shared chat panel.
              Messages are stored locally, so you can experiment with multiple posts without leaving the page.
            </p>
          </div>
        </header>

        <ChatShowcase />
      </main>
    </div>
  );
}
