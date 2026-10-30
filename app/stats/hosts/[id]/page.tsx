import PersonProfile from "@/lib/components/stats/person-profile";
import type { StatsPageSearch } from "@/server/stats/page-options";
export const dynamic = "force-dynamic";
export default async function HostPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<StatsPageSearch> }) {
  return <PersonProfile id={(await params).id} role="host" searchParams={await searchParams} />;
}
