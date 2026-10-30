import { getStatsFirestore } from "@/server/stats/web-database";
import { statsListOptions, statsResponse } from "@/server/stats/http";
import { listPublicGames } from "@/server/stats/public-queries";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return statsResponse(async () => Response.json(await listPublicGames(getStatsFirestore(), statsListOptions(request)))); }
