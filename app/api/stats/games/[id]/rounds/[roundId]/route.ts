import { getServerFirestore } from "@/server/database";
import { StatsError } from "@/server/stats/error";
import { statsParam, statsResponse, statsVersion } from "@/server/stats/http";
import { getPublicRound } from "@/server/stats/public-queries";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: { params: Promise<{ id: string; roundId: string }> }) { return statsResponse(async () => {
  const { id, roundId } = await context.params, params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !["version", "limit", "cursor"].includes(key))) throw new StatsError("invalid-query", "Unsupported question query.", 400);
  return Response.json(await getPublicRound(getServerFirestore(), statsParam(id), statsParam(roundId), statsVersion(params.has("version") ? Number(params.get("version")) : undefined), { limit: params.has("limit") ? Number(params.get("limit")) : undefined, cursor: params.get("cursor") }));
} ); }
