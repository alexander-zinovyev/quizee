import { getServerFirestore } from "@/server/database";
import { changeGameReview } from "@/server/stats/commands";
import { StatsError } from "@/server/stats/error";
import { requestStatsAdmin, statsJson, statsParam, statsResponse, statsVersion } from "@/server/stats/http";
import type { ReviewPatch } from "@/server/stats/reviews";
import { assertSameOrigin } from "@/server/stats/sessions";
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return statsResponse(async () => {
  assertSameOrigin(request);
  const actor = await requestStatsAdmin(request), body = await statsJson(request, ["expectedVersion", "mappings", "hostPersonId", "maxima", "completedAt", "packLabel", "createPeople", "confirmedImpact"]);
  if (body.confirmedImpact !== undefined && typeof body.confirmedImpact !== "boolean") throw new StatsError("malformed-input", "confirmedImpact must be boolean.", 400);
  const result = await changeGameReview(getServerFirestore(), actor, statsParam((await context.params).id), { ...body, expectedVersion: statsVersion(body.expectedVersion) } as ReviewPatch);
  return Response.json({ version: result.version, changed: result.changed, summary: result.summary, impact: result.impact });
}); }
