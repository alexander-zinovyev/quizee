import { getServerFirestore } from "@/server/database";
import { statsListOptions, statsResponse } from "@/server/stats/http";
import { listPublicPlayers } from "@/server/stats/public-queries";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return statsResponse(async () => Response.json(await listPublicPlayers(getServerFirestore(), statsListOptions(request)))); }
