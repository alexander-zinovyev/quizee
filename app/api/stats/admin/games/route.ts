import { getStatsFirestore } from "@/server/stats/web-database";
import { listAdminGames } from "@/server/stats/admin-queries";
import { StatsError } from "@/server/stats/error";
import { requestStatsAdmin, statsResponse } from "@/server/stats/http";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return statsResponse(async () => {
  const actor = await requestStatsAdmin(request), p = new URL(request.url).searchParams;
  if ([...p.keys()].some((key) => !["tab", "roomCursor", "reviewCursor"].includes(key))) throw new StatsError("invalid-query", "Unsupported review query.", 400);
  return Response.json(await listAdminGames(getStatsFirestore(), actor, { tab: p.get("tab") ?? undefined, roomCursor: p.get("roomCursor"), reviewCursor: p.get("reviewCursor") }));
}); }
