import { NextResponse, type NextRequest } from "next/server";
import { getServerFirestore } from "@/server/database";
import { requestUserId } from "@/server/rooms/request-auth";
import { readClues } from "@/server/rooms/clues";
import { checkClueDestination, clueResponse } from "@/server/rooms/clue-response";

export async function GET(request: NextRequest, context: { params: Promise<{ room: string; round: string; question: string }> }) {
  const uid = await requestUserId(request);
  if (!uid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  return clueResponse(async () => {
    const { room, round, question } = await context.params;
    checkClueDestination([room, round, question]);
    const view = await readClues(getServerFirestore(), room, round, question, uid);
    return NextResponse.json({ teamId: view.teamId, remainingCoins: view.remainingCoins, clues: view.clues }, { headers: { "Cache-Control": "no-store" } });
  });
}
