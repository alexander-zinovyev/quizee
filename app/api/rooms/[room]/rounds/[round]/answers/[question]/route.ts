import { NextResponse, type NextRequest } from "next/server";
import { getServerFirestore } from "@/server/database";
import { parseAnswerSave, saveTeamAnswer, type AnswerSave } from "@/server/rooms/answer-input";
import { RoomOperationError } from "@/server/rooms/operation-error";
import { requestUserId } from "@/server/rooms/request-auth";

export async function POST(request: NextRequest, context: { params: Promise<{ room: string; round: string; question: string }> }) {
  const authStarted = performance.now();
  const uid = await requestUserId(request);
  const authDuration = performance.now() - authStarted;
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
    const saveStarted = performance.now();
    const saved = await saveTeamAnswer(getServerFirestore(), room, round, question, uid, save);
    return NextResponse.json(saved, { headers: {
      "Server-Timing": `auth;dur=${authDuration.toFixed(2)}, save;dur=${(performance.now() - saveStarted).toFixed(2)}`,
    } });
  } catch (error) {
    if (error instanceof RoomOperationError) return NextResponse.json({ message: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    console.error("[answer-save]", error);
    return NextResponse.json({ message: "Unable to save answer." }, { status: 500 });
  }
}
