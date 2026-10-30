import { notFound } from "next/navigation";
import { getStatsFirestore } from "@/server/stats/web-database";
import { getAdminGame } from "@/server/stats/admin-queries";
import { pageStatsAdmin } from "@/server/stats/http";
import { StatsError } from "@/server/stats/error";
import ReviewEditor from "@/lib/components/stats/review-editor";
import { statsPublicEnabled } from "@/server/stats/public-access";

export default async function AdminGamePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await pageStatsAdmin(), { id } = await params;
  const data = await getAdminGame(getStatsFirestore(), actor, id).catch((error) => { if (error instanceof StatsError && error.status === 404) notFound(); throw error; });
  return <ReviewEditor initial={data} publicEnabled={statsPublicEnabled()} />;
}
