import { NextResponse, type NextRequest } from "next/server";
import { getServerFirestore } from "@/server/database";
import { requestUserId } from "@/server/rooms/request-auth";
import { parseCluePurchase, purchaseClue } from "@/server/rooms/clues";
import { checkClueDestination, clueResponse } from "@/server/rooms/clue-response";

export async function POST(request: NextRequest, context: { params: Promise<{ room: string; round: string; question: string; clue: string }> }) {
  const uid = await requestUserId(request);
  if (!uid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  let purchase;
  try { purchase = parseCluePurchase(await request.json()); }
  catch { return NextResponse.json({ message: "Invalid clue purchase." }, { status: 400 }); }
  return clueResponse(async () => {
    const { room, round, question, clue } = await context.params;
    checkClueDestination([room, round, question, clue]);
    return NextResponse.json(await purchaseClue(getServerFirestore(), room, round, question, clue, uid, purchase.teamId), { headers: { "Cache-Control": "no-store" } });
  });
}
