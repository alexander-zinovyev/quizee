import Link from "next/link";

import Team, { type TeamMember } from "@/lib/components/team";

type TeamDemoPageProps = {
  searchParams?: Promise<{
    members?: string | string[];
  }>;
};

const PRESET_MEMBER_COUNTS = [0, 1, 2, 3, 4, 5, 8, 10, 16, 50, 100];

function parseMembersParam(value: string | string[] | undefined) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(rawValue ?? "3", 10);

  if (!Number.isFinite(parsed)) return 3;

  return Math.max(0, Math.min(200, parsed));
}

function buildMembers(count: number): TeamMember[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `member-${index + 1}`,
    name: `Member ${index + 1}`,
  }));
}

export default async function TeamDemoPage({ searchParams }: TeamDemoPageProps) {
  const resolvedSearchParams = await searchParams;
  const membersCount = parseMembersParam(resolvedSearchParams?.members);
  const members = buildMembers(membersCount);

  return (
    <div className="min-h-screen bg-zinc-100 px-6 py-10 text-zinc-950">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3 rounded-3xl border border-zinc-300 bg-white/95 p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-600">
              Team Demo
            </p>
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
            >
              Back home
            </Link>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Isolated Team preview</h1>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                Use <code>?members=</code> to control the roster size and inspect how the{" "}
                <code>Team</code> component arranges 16:9 <code>Member</code> tiles inside a
                fixed panel.
              </p>
            </div>
            <p className="text-sm text-zinc-500">
              Current query: <code>?members={membersCount}</code>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESET_MEMBER_COUNTS.map((count) => (
              <Link
                key={count}
                href={`/team-demo?members=${count}`}
                className={[
                  "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition",
                  count === membersCount
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-950",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {count} members
              </Link>
            ))}
          </div>
        </header>

        <section className="rounded-[2rem] border border-zinc-300 bg-zinc-200/70 p-4 shadow-inner sm:p-6">
          <div className="mx-auto aspect-[16/9] w-full max-w-6xl rounded-[1.75rem] border border-zinc-400/60 bg-zinc-100 p-4 sm:p-6">
            <Team
              name="Demo Team"
              color="#10b981"
              members={members}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
