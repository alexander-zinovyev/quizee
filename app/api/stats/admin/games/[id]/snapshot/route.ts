import { getStatsFirestore } from "@/server/stats/web-database";
import { requestStatsAdmin, statsJson, statsParam, statsResponse, statsVersion } from "@/server/stats/http";
import { assertSameOrigin } from "@/server/stats/sessions";
import { prepareSnapshot } from "@/server/stats/snapshots";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return statsResponse(async () => {
  assertSameOrigin(request);
  const actor = await requestStatsAdmin(request), body = await statsJson(request, ["expectedVersion"]);
  return Response.json(await prepareSnapshot(getStatsFirestore(), statsParam((await context.params).id), actor, statsVersion(body.expectedVersion)));
}); }
