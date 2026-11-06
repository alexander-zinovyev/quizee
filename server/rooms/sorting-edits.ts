import type { Firestore } from "firebase-admin/firestore";
import { applySortingEdit, parseSortingEdit, parseSortingSnapshot, type SortingEdit } from "@/types/sorting";
import { RoomOperationError } from "./operation-error";

export async function saveSortingEdit(
  db: Firestore, roomId: string, roundId: string, questionId: string, uid: string,
  save: { teamId: string; edit: SortingEdit },
): Promise<{ editId: string; revision: number }> {
  const edit = parseSortingEdit(save.edit);
  const roomRef = db.collection("rooms").doc(roomId);
  const teamRef = roomRef.collection("teams").doc(save.teamId);
  const roundRef = roomRef.collection("rounds").doc(roundId);
  const answerRef = teamRef.collection("rounds").doc(roundId).collection("answers").doc(questionId);
  const receiptRef = answerRef.collection("edits").doc(edit.id);
  return db.runTransaction(async (tx) => {
    // One batch avoids adding a network round trip for each validation dependency.
    const [room, member, team, round, question, answer, receipt] = await tx.getAll(
      roomRef, roomRef.collection("members").doc(uid), teamRef, roundRef,
      roundRef.collection("questions").doc(questionId), answerRef, receiptRef,
    );
    if (!room.exists) throw new RoomOperationError("Room not found.", 404);
    if (!member.exists || !member.data()?.team) throw new RoomOperationError("Join a team before answering.", 403);
    if (member.data()?.team !== save.teamId) throw new RoomOperationError("Team changed. Reload your answers.");
    if (!team.exists || !round.exists || !question.exists) throw new RoomOperationError("Answer destination not found.", 404);
    if (round.data()?.type !== "sorting") throw new RoomOperationError("Sorting edits require a sorting round.", 400);
    if (!receipt.exists && (room.data()?.state !== "playing" || round.data()?.state !== "active")) {
      throw new RoomOperationError("Round is not accepting answers.", 409, "round-closed");
    }
    const items: unknown = question.data()?.items;
    if (!Array.isArray(items)) throw new Error("Missing sorting items.");
    const snapshot = parseSortingSnapshot(answer.data(), items.map((item: { id: string }) => item.id));
    if (receipt.exists) {
      const previous = receipt.data()!;
      const previousEdit = parseSortingEdit(previous.edit);
      if (JSON.stringify(previousEdit) !== JSON.stringify(edit)) throw new RoomOperationError("Sorting edit ID has already been used for another edit.");
      if (!Number.isSafeInteger(previous.revision) || previous.revision < 1 || previous.revision > snapshot.revision) throw new Error("Invalid sorting edit receipt.");
      // A lost response can be recovered after closing without applying the edit twice.
      return { editId: edit.id, revision: previous.revision as number };
    }
    let order: string[];
    try { order = applySortingEdit(snapshot.order, edit); }
    catch { throw new RoomOperationError("Sorting edit references an unknown item.", 400); }
    const revision = snapshot.revision + 1;
    if (!Number.isSafeInteger(revision)) throw new Error("Sorting revision limit exceeded.");
    tx.set(answerRef, { order, revision, user: uid });
    tx.set(receiptRef, { edit, revision });
    return { editId: edit.id, revision };
  });
}
