import { getServerFirestore } from "@/server/database";
import { requestStatsAdmin, statsJson, statsParam, statsResponse, statsVersion } from "@/server/stats/http";
import { editStatsPerson, type EditStatsPerson } from "@/server/stats/people";
import { assertSameOrigin } from "@/server/stats/sessions";
export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return statsResponse(async () => {
  assertSameOrigin(request);
  const actor = await requestStatsAdmin(request), body = await statsJson(request, ["expectedVersion", "displayName", "helperAliases", "notes", "archived"]);
  return Response.json(await editStatsPerson(getServerFirestore(), actor, statsParam((await context.params).id), { ...body, expectedVersion: statsVersion(body.expectedVersion) } as EditStatsPerson));
}); }
