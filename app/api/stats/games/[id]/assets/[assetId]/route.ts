import { getServerStorageBucket } from "@/server/database";
import { getStatsFirestore } from "@/server/stats/web-database";
import { statsParam, statsResponse } from "@/server/stats/http";
import { getPublishedAsset } from "@/server/stats/public-queries";
import { serveStatsAsset } from "@/server/stats/media";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) { return statsResponse(async () => {
  const { id, assetId } = await context.params, asset = await getPublishedAsset(getStatsFirestore(), statsParam(id), assetId);
  return serveStatsAsset(request, getServerStorageBucket(), asset);
}); }
