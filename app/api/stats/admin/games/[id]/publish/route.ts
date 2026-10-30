import { getStatsFirestore } from "@/server/stats/web-database";
import { publishStatsGame } from "@/server/stats/commands";
import { StatsError } from "@/server/stats/error";
import { requestStatsAdmin, statsJson, statsParam, statsResponse, statsVersion } from "@/server/stats/http";
import { assertSameOrigin } from "@/server/stats/sessions";
export function POST(request: Request, context: { params: Promise<{ id: string }> }) { return statsResponse(async () => {
  assertSameOrigin(request);
  const actor = await requestStatsAdmin(request), body = await statsJson(request, ["expectedVersion", "approvedDigest", "acknowledgeIncompleteGrading"]);
  if (typeof body.approvedDigest !== "string" || !/^[0-9a-f]{64}$/.test(body.approvedDigest) || (body.acknowledgeIncompleteGrading !== undefined && typeof body.acknowledgeIncompleteGrading !== "boolean")) throw new StatsError("malformed-input", "A snapshot digest and boolean warning acknowledgement are required.", 400);
  return Response.json(await publishStatsGame(getStatsFirestore(), actor, statsParam((await context.params).id), { expectedVersion: statsVersion(body.expectedVersion), approvedDigest: body.approvedDigest, acknowledgeIncompleteGrading: body.acknowledgeIncompleteGrading === true }));
}); }
