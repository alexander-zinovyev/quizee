import { getStatsFirestore } from "@/server/stats/web-database";
import { getAdminGame } from "@/server/stats/admin-queries";
import { requestStatsAdmin, statsParam, statsResponse } from "@/server/stats/http";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: { params: Promise<{ id: string }> }) { return statsResponse(async () => {
  const actor = await requestStatsAdmin(request);
  return Response.json(await getAdminGame(getStatsFirestore(), actor, statsParam((await context.params).id)));
}); }
