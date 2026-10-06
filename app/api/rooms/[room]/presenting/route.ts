import { NextResponse, type NextRequest } from "next/server";
import { getServerFirestore } from "@/server/database";
import { parsePresentation, transitionPresentation } from "@/server/rooms/presentation";
import { requestUserId } from "@/server/rooms/request-auth";

export async function POST(request: NextRequest, context: { params: Promise<{ room: string }> }) {
  const uid = await requestUserId(request);
  if (!uid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    if ([payload.closeRound, payload.activateRound].some((id) => id !== undefined && (typeof id !== "string" || !id || id.includes("/")))) throw new Error();
    parsePresentation(payload.expected);
    parsePresentation(payload.next);
  } catch {
    return NextResponse.json({ message: "Invalid presentation request." }, { status: 400 });
  }
  try {
    const { room } = await context.params;
    await transitionPresentation(getServerFirestore(), room, uid,
      parsePresentation(payload.expected), parsePresentation(payload.next),
      { closeRound: payload.closeRound as string | undefined, activateRound: payload.activateRound as string | undefined });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update presentation.";
    const status = message === "Forbidden" ? 403 : 409;
    return NextResponse.json({ message }, { status });
  }
}
