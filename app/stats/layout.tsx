import Link from "next/link";
import StatsRefresh from "@/lib/components/stats/refresh";
import { statsPublicEnabled } from "@/server/stats/public-access";

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"><header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"><nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-6 py-4" aria-label="Statistics"><Link className="font-bold text-emerald-700 dark:text-emerald-400" href="/">Quizee</Link>{statsPublicEnabled() && <Link href="/stats">Statistics</Link>}<Link className="ml-auto text-sm" href="/stats/admin">Administration</Link></nav></header><StatsRefresh />{children}</div>;
}
