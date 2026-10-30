import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <main className="w-full max-w-2xl rounded-3xl border border-zinc-200 bg-white/95 p-10 text-center shadow-xl dark:border-zinc-800 dark:bg-zinc-900/80">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
          Quizee
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
          Host your own quiz room
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
          Upload your quiz package, start a room, and run the game live.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/host"
            className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Host quiz
          </Link>
          <Link href="/stats" className="rounded-xl border border-zinc-300 px-5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800">
            Game statistics
          </Link>
        </div>
      </main>
    </div>
  );
}
