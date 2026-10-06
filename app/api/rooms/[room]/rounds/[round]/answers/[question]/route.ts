import { NextResponse, type NextRequest } from "next/server";
import { getServerFirestore } from "@/server/database";
import { parseAnswerSave, saveTeamAnswer, type AnswerSave } from "@/server/rooms/answer-input";
import { RoomOperationError } from "@/server/rooms/operation-error";
import { requestUserId } from "@/server/rooms/request-auth";

export async function POST(request: NextRequest, context: { params: Promise<{ room: string; round: string; question: string }> }) {
  const uid = await requestUserId(request);
  if (!uid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  let save: AnswerSave;
  try {
    save = parseAnswerSave(await request.json());
  } catch {
    return NextResponse.json({ message: "Invalid answer request." }, { status: 400 });
  }
  try {
    const { room, round, question } = await context.params;
    if ([room, round, question].some((id) => !id || id.includes("/"))) {
      return NextResponse.json({ message: "Invalid answer destination." }, { status: 400 });
    }
    const saved = await saveTeamAnswer(getServerFirestore(), room, round, question, uid, save);
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof RoomOperationError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error("[answer-save]", error);
    return NextResponse.json({ message: "Unable to save answer." }, { status: 500 });
  }
}
