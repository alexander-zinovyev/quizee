import Link from "next/link";
import { redirect } from "next/navigation";
import { pageStatsAdmin } from "@/server/stats/http";
import { StatsError } from "@/server/stats/error";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try { await pageStatsAdmin(); }
  catch (error) { if (error instanceof StatsError && [401, 403].includes(error.status)) redirect("/login"); throw error; }
  return <main className="mx-auto max-w-6xl space-y-6 p-6 text-zinc-900 dark:text-zinc-100">
    <nav aria-label="Administration" className="flex flex-wrap gap-5 border-b pb-4">
      <Link href="/stats/admin">Game review</Link><Link href="/stats/admin/people">People</Link><Link href="/stats/admin/users">Administrators</Link><Link href="/stats/admin/history">Change history</Link><Link href="/login">Account</Link>
    </nav>{children}
  </main>;
}
