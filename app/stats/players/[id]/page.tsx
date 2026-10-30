import PersonProfile from "@/lib/components/stats/person-profile";
import type { StatsPageSearch } from "@/server/stats/page-options";
export const dynamic = "force-dynamic";
export default async function PlayerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<StatsPageSearch> }) {
  return <PersonProfile id={(await params).id} role="player" searchParams={await searchParams} />;
}
