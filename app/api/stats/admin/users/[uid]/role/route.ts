import { getServerFirestore } from "@/server/database";
import { requestStatsAdmin, statsJson, statsResponse, statsVersion } from "@/server/stats/http";
import { setAdminRole } from "@/server/stats/roles";
import { assertSameOrigin } from "@/server/stats/sessions";

type Context = { params: Promise<{ uid: string }> };
function change(request: Request, context: Context, enabled: boolean) {
  return statsResponse(async () => {
    assertSameOrigin(request);
    const actor = await requestStatsAdmin(request), { uid } = await context.params;
    const body = await statsJson(request, ["expectedVersion"]);
    return Response.json(await setAdminRole(getServerFirestore(), actor, uid, enabled, statsVersion(body.expectedVersion)));
  });
}
export function PUT(request: Request, context: Context) { return change(request, context, true); }
export function DELETE(request: Request, context: Context) { return change(request, context, false); }
