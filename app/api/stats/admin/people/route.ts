import { getServerFirestore } from "@/server/database";
import { requestStatsAdmin, statsJson, statsResponse } from "@/server/stats/http";
import { createStatsPerson, searchStatsPeople, type CreateStatsPerson } from "@/server/stats/people";
import { assertSameOrigin } from "@/server/stats/sessions";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return statsResponse(async () => {
  const actor = await requestStatsAdmin(request);
  return Response.json({ items: await searchStatsPeople(getServerFirestore(), actor, new URL(request.url).searchParams.get("search") ?? "") });
}); }
export function POST(request: Request) { return statsResponse(async () => {
  assertSameOrigin(request);
  const actor = await requestStatsAdmin(request), body = await statsJson(request, ["id", "displayName", "helperAliases", "notes"]);
  return Response.json(await createStatsPerson(getServerFirestore(), actor, body as CreateStatsPerson));
}); }
