import { NextResponse, type NextRequest } from "next/server";
import { getServerFirestore, getServerStorageBucket } from "@/server/database";
import { requestUserId } from "@/server/rooms/request-auth";
import { clueMediaType } from "@/server/rooms/clue-media";
import { readClueMedia } from "@/server/rooms/clues";
import { checkClueDestination, clueResponse } from "@/server/rooms/clue-response";

export async function GET(request: NextRequest, context: { params: Promise<{ room: string; round: string; question: string; clue: string }> }) {
  const uid = await requestUserId(request);
  if (!uid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  return clueResponse(async () => {
    const { room, round, question, clue } = await context.params;
    checkClueDestination([room, round, question, clue]);
    const path = await readClueMedia(getServerFirestore(), room, round, question, clue, uid);
    const [bytes] = await getServerStorageBucket().file(path).download();
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": clueMediaType(path), "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
