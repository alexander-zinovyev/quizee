import { NextResponse, type NextRequest } from "next/server";
import { getServerFirestore, getServerStorageBucket } from "@/server/database";
import { requestUserId } from "@/server/rooms/request-auth";
import { clueMediaType } from "@/server/rooms/clue-media";
import { readClues } from "@/server/rooms/clues";
import { checkClueDestination, clueResponse } from "@/server/rooms/clue-response";
import { RoomOperationError } from "@/server/rooms/operation-error";

export async function GET(request: NextRequest, context: { params: Promise<{ room: string; round: string; question: string; clue: string }> }) {
  const uid = await requestUserId(request);
  if (!uid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  return clueResponse(async () => {
    const { room, round, question, clue } = await context.params;
    checkClueDestination([room, round, question, clue]);
    const view = await readClues(getServerFirestore(), room, round, question, uid);
    const path = view.media[clue];
    if (!path) throw new RoomOperationError("Clue media is unavailable.", 403);
    const [bytes] = await getServerStorageBucket().file(path).download();
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": clueMediaType(path), "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
