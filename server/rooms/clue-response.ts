import { NextResponse } from "next/server";
import { RoomOperationError } from "./operation-error";

export async function clueResponse(work: () => Promise<Response>): Promise<Response> {
  try { return await work(); }
  catch (error) {
    if (error instanceof RoomOperationError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    console.error("[clues]", error);
    return NextResponse.json({ message: "Unable to load or purchase this clue." }, { status: 500 });
  }
}
export function checkClueDestination(ids: string[]) {
  if (ids.some((id) => !id || id.includes("/"))) throw new RoomOperationError("Invalid clue destination.", 400);
}
