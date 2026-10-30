import { getServerFirestore } from "@/server/database";
import { statsListOptions, statsParam, statsResponse } from "@/server/stats/http";
import { listPublicHistory } from "@/server/stats/public-queries";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: { params: Promise<{ id: string }> }) { return statsResponse(async () => Response.json(await listPublicHistory(getServerFirestore(), statsParam((await context.params).id), "host", statsListOptions(request)))); }
