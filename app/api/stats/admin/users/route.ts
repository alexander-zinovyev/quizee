import { getStatsFirestore } from "@/server/stats/web-database";
import { requestStatsAdmin, statsResponse } from "@/server/stats/http";
import { lookupAdminUsers } from "@/server/stats/roles";

export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return statsResponse(async () => {
    const actor = await requestStatsAdmin(request);
    return Response.json({ items: await lookupAdminUsers(getStatsFirestore(), actor, new URL(request.url).searchParams.get("search") ?? "") });
  });
}
