import type { Firestore } from "firebase-admin/firestore";
import { isAnswerCommitted, MAX_ANSWER_LENGTH, parseTeamAnswer, type AnswerMutation, type TeamAnswer } from "@/lib/answers";
import { RoomOperationError } from "./operation-error";
import { parsePresentation } from "./presentation";
import { parsePointsPerStep } from "./multi-step-submission";
import { HEX_COLOR } from "@/types/color";

export type AnswerSave = { teamId: string; expectedStep?: number; mutation: AnswerMutation };

export function parseAnswerSave(raw: unknown): AnswerSave {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid answer request.");
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["teamId", "expectedStep", "answer", "locked", "wagered"].includes(key)) ||
      typeof data.teamId !== "string" || !data.teamId || data.teamId.includes("/") ||
      (data.expectedStep !== undefined && (!Number.isInteger(data.expectedStep) || (data.expectedStep as number) < 0))) {
    throw new Error("Invalid answer request.");
  }
  const changesAnswer = "answer" in data;
  const changesLock = "locked" in data;
  const changesWager = "wagered" in data;
  if (Number(changesAnswer) + Number(changesLock) + Number(changesWager) !== 1 ||
      (changesWager && typeof data.wagered !== "boolean") ||
      (changesAnswer && (typeof data.answer !== "string" || data.answer.length > MAX_ANSWER_LENGTH)) ||
      (changesLock && typeof data.locked !== "boolean")) throw new Error("Invalid answer request.");
  return { teamId: data.teamId, expectedStep: data.expectedStep as number | undefined,
    mutation: changesAnswer ? { answer: data.answer as string }
      : changesWager ? { wagered: data.wagered as boolean } : { locked: data.locked as boolean } };
}

export async function saveTeamAnswer(
  db: Firestore, roomId: string, roundId: string, questionId: string, uid: string, save: AnswerSave
) {
  const roomRef = db.collection("rooms").doc(roomId);
  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef);
    const member = await tx.get(roomRef.collection("members").doc(uid));
    if (!room.exists) throw new RoomOperationError("Room not found.", 404);
    const teamId = member.data()?.team;
    if (!member.exists || !teamId) throw new RoomOperationError("Join a team before answering.", 403);
    if (teamId !== save.teamId) throw new RoomOperationError("Team changed. Reload your answers.");
    const team = await tx.get(roomRef.collection("teams").doc(teamId));
    const roundRef = roomRef.collection("rounds").doc(roundId);
    const round = await tx.get(roundRef);
    const question = await tx.get(roundRef.collection("questions").doc(questionId));
    if (!team.exists || !round.exists || !question.exists) throw new RoomOperationError("Answer destination not found.", 404);
    const roundData = round.data()!;
    if (room.data()?.state !== "playing" || roundData.state !== "active") throw new RoomOperationError("Round is not accepting answers.");
    if (roundData.type !== "text" && roundData.type !== "clues" && roundData.type !== "multi-step" && roundData.type !== "color" && roundData.type !== "sorting") throw new RoomOperationError("Unsupported answer type.", 400);
    if ("wagered" in save.mutation && (roundData.type !== "text" || roundData.allowWager !== true)) {
      throw new RoomOperationError("Wagers are not enabled for this round.", 400);
    }
    if (roundData.type === "sorting") throw new RoomOperationError("Sorting accepts round-level relative edits only.", 400);
    if (roundData.type === "color") {
      const current = parsePresentation(room.data()?.presenting);
      if (current.round !== roundId || current.question !== questionId || current.withAnswer) throw new RoomOperationError("Question is not accepting colors.");
      if ("answer" in save.mutation && (typeof save.mutation.answer !== "string" || !HEX_COLOR.test(save.mutation.answer))) throw new RoomOperationError("Expected a six-digit HEX color.", 400);
      if (save.expectedStep !== undefined) throw new RoomOperationError("Color answers do not have steps.", 400);
    }
    if (roundData.type === "multi-step") {
      if (typeof roundData.allowAnswerChanges !== "boolean") throw new Error("Invalid answer-change policy.");
      const current = parsePresentation(room.data()?.presenting);
      const points = parsePointsPerStep(roundData.pointsPerStep);
      if (current.round !== roundId || current.question !== questionId || current.withAnswer ||
          save.expectedStep !== current.promptPage || current.promptPage >= points.length ||
          current.promptPage <= (question.data()?.finalizedStep ?? -1)) {
        throw new RoomOperationError("Step is not accepting answers.");
      }
    } else if (save.expectedStep !== undefined) {
      throw new RoomOperationError("Text answers do not have submission steps.", 400);
    }
    const answerRef = team.ref.collection("rounds").doc(roundId).collection("answers").doc(questionId);
    const answer = await tx.get(answerRef);
    const input: TeamAnswer = answer.exists ? parseTeamAnswer(answer.data()!)
      : { answer: roundData.type === "color" ? question.data()?.initialColor : "", locked: false, user: null, attempts: [] };
    if (roundData.type === "color" && (typeof input.answer !== "string" || !HEX_COLOR.test(input.answer))) throw new Error("Invalid stored color answer.");
    if (roundData.type === "multi-step" && isAnswerCommitted(roundData.allowAnswerChanges, input.attempts)) {
      throw new RoomOperationError("Answer is permanently locked.");
    }
    if ("answer" in save.mutation && input.locked) throw new RoomOperationError("Unlock the answer before editing.");
    const mutation = roundData.type === "color" && typeof save.mutation.answer === "string"
      ? { answer: save.mutation.answer.toUpperCase() } : save.mutation;
    const updated = { ...input, ...mutation, user: uid };
    tx.set(answerRef, { answer: updated.answer, locked: updated.locked, user: uid,
      ...(updated.wagered === undefined ? {} : { wagered: updated.wagered }),
      ...(roundData.type === "multi-step" ? { attempts: input.attempts } : {}) });
    return { answer: updated.answer, locked: updated.locked, user: uid,
      ...(updated.wagered === undefined ? {} : { wagered: updated.wagered }) };
  });
}
