import type { Firestore } from "firebase-admin/firestore";
import { CLUE_ID, clueKey, positiveCoins, type ClueMetadata, type CluesView } from "@/types/clues";
import { RoomOperationError } from "./operation-error";
import { parsePresentation } from "./presentation";

export function clueLedgerPath(roomId: string, teamId: string, roundId: string) {
  return `rooms/${roomId}/cluePurchases/${teamId}/rounds/${roundId}`;
}
export function remainingCoins(raw: unknown, startingCoins: number): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) > positiveCoins(startingCoins)) throw new Error("Invalid stored coin balance.");
  return raw as number;
}
export function parseCluePurchase(raw: unknown): { teamId: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => key !== "teamId")) throw new Error("Invalid clue purchase.");
  const data = raw as Record<string, unknown>;
  if (typeof data.teamId !== "string" || !data.teamId || data.teamId.includes("/")) throw new Error("Invalid clue purchase.");
  return { teamId: data.teamId };
}

/** One shared balance document serializes purchases across all questions for a team. */
export async function purchaseClue(db: Firestore, roomId: string, roundId: string, questionId: string, clueId: string, uid: string, expectedTeam: string) {
  if (!CLUE_ID.test(clueId)) throw new RoomOperationError("Invalid clue ID.", 400);
  const roomRef = db.collection("rooms").doc(roomId);
  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef);
    const member = await tx.get(roomRef.collection("members").doc(uid));
    const teamId = member.data()?.team;
    if (!room.exists) throw new RoomOperationError("Room not found.", 404);
    if (!member.exists || member.data()?.role === "host" || !teamId) throw new RoomOperationError("Join a team before buying clues.", 403);
    if (teamId !== expectedTeam) throw new RoomOperationError("Team changed. Reload your clues.");
    const team = await tx.get(roomRef.collection("teams").doc(teamId));
    const roundRef = roomRef.collection("rounds").doc(roundId);
    const round = await tx.get(roundRef);
    const questionRef = roundRef.collection("questions").doc(questionId);
    const question = await tx.get(questionRef);
    const clue = await tx.get(questionRef.collection("clues").doc(clueId));
    if (!team.exists || !round.exists || !question.exists || !clue.exists) throw new RoomOperationError("Clue not found.", 404);
    if (round.data()?.type !== "clues") throw new RoomOperationError("Not a clues round.", 400);
    const ledgerRef = db.doc(clueLedgerPath(roomId, teamId, roundId));
    const ledger = await tx.get(ledgerRef);
    const openedRef = ledgerRef.collection("openedClues").doc(clueKey(questionId, clueId));
    const opened = await tx.get(openedRef);
    const balance = remainingCoins(ledger.exists ? ledger.data()!.remainingCoins : round.data()!.startingCoins, round.data()!.startingCoins);
    // Acknowledging an existing purchase never charges again, including after navigation/closure.
    if (opened.exists) return { remainingCoins: balance };
    const presentation = parsePresentation(room.data()?.presenting);
    if (room.data()?.state !== "playing" || round.data()?.state !== "active" || presentation.round !== roundId ||
        presentation.question !== questionId || presentation.withAnswer) throw new RoomOperationError("Question is not accepting clue purchases.");
    const metadata = (question.data()!.clues as ClueMetadata[]).find((item) => item.id === clueId);
    if (!metadata || metadata.price !== clue.data()?.price) throw new Error("Invalid clue configuration.");
    const price = positiveCoins(metadata.price);
    if (price > balance) throw new RoomOperationError("Not enough coins.", 409, "insufficient-coins");
    const next = balance - price;
    tx.set(ledgerRef, { remainingCoins: next });
    tx.set(openedRef, { questionId, clueId, text: clue.data()!.text, image: Boolean(clue.data()!.media) });
    return { remainingCoins: next };
  });
}

/** Read definitions only after checking either team purchase or the host's current reveal. */
export async function readClues(db: Firestore, roomId: string, roundId: string, questionId: string, uid: string): Promise<CluesView & { images: Record<string, string> }> {
  const roomRef = db.collection("rooms").doc(roomId);
  return db.runTransaction(async (tx) => {
    const room = await tx.get(roomRef);
    const member = await tx.get(roomRef.collection("members").doc(uid));
    if (!room.exists) throw new RoomOperationError("Room not found.", 404);
    if (!member.exists) throw new RoomOperationError("Join the room before reading clues.", 403);
    const host = member.data()?.role === "host";
    const teamId = member.data()?.team ?? null;
    const roundRef = roomRef.collection("rounds").doc(roundId);
    const round = await tx.get(roundRef);
    const questionRef = roundRef.collection("questions").doc(questionId);
    const question = await tx.get(questionRef);
    if (!round.exists || !question.exists || round.data()?.type !== "clues") throw new RoomOperationError("Clues question not found.", 404);
    if (!host && round.data()?.state === "scheduled") throw new RoomOperationError("Round has not started.", 403);
    const ledgerRef = teamId ? db.doc(clueLedgerPath(roomId, teamId, roundId)) : null;
    const ledger = ledgerRef ? await tx.get(ledgerRef) : null;
    const presentation = parsePresentation(room.data()?.presenting);
    const shown = round.data()?.state === "closed" && presentation.round === roundId && presentation.question === questionId
      ? presentation.revealedClueIds ?? [] : [];
    const images: Record<string, string> = {};
    const clues = [];
    for (const metadata of question.data()!.clues as ClueMetadata[]) {
      const opened = ledgerRef ? await tx.get(ledgerRef.collection("openedClues").doc(clueKey(questionId, metadata.id))) : null;
      const purchased = opened?.exists === true;
      if (!host && !purchased && !shown.includes(metadata.id)) { clues.push({ ...metadata, purchased }); continue; }
      const definition = await tx.get(questionRef.collection("clues").doc(metadata.id));
      if (!definition.exists || typeof definition.data()?.text !== "string") throw new Error("Missing clue definition.");
      const media = definition.data()?.media;
      if (media) {
        if (typeof media.storagePath !== "string" || !media.storagePath.startsWith(`rooms/${roomId}/clue-media/`)) throw new Error("Invalid private clue image.");
        images[metadata.id] = media.storagePath;
      }
      clues.push({ ...metadata, purchased, text: definition.data()!.text as string, image: Boolean(media) });
    }
    return { teamId: host ? null : teamId, remainingCoins: remainingCoins(ledger?.exists ? ledger.data()!.remainingCoins : round.data()!.startingCoins, round.data()!.startingCoins), clues, images };
  });
}
