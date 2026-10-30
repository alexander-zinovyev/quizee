import { getServerStorageBucket } from "@/server/database";
import { getStatsFirestore } from "@/server/stats/web-database";
import { getAdminAsset } from "@/server/stats/admin-queries";
import { requestStatsAdmin, statsParam, statsResponse } from "@/server/stats/http";
import { serveStatsAsset } from "@/server/stats/media";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) { return statsResponse(async () => {
  const actor = await requestStatsAdmin(request), { id, assetId } = await context.params;
  const asset = await getAdminAsset(getStatsFirestore(), actor, statsParam(id), assetId);
  return serveStatsAsset(request, getServerStorageBucket(), asset);
}); }
