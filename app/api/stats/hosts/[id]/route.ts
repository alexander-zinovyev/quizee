import { getServerFirestore } from "@/server/database";
import { statsParam, statsResponse } from "@/server/stats/http";
import { getPublicHost } from "@/server/stats/public-queries";
export const dynamic = "force-dynamic";
export function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return statsResponse(async () => Response.json(await getPublicHost(getServerFirestore(), statsParam((await context.params).id)))); }
