import { doc, runTransaction, type Firestore } from "firebase/firestore";
import { editImageMatches, parseImageMatch, type ImageMatchEdit, type ImageMatches } from "./image-matching";

/** Read every affected assignment in one transaction so concurrent teammates retain one-to-one matching. */
export async function saveImageMatch({ db, roomSlug, teamId, roundId, questionIds, imageIds, uid }: {
  db: Firestore; roomSlug: string; teamId: string; roundId: string;
  questionIds: readonly string[]; imageIds: readonly string[]; uid?: string | null;
}, change: ImageMatchEdit): Promise<ImageMatches> {
  return runTransaction(db, async (transaction) => {
    const round = await transaction.get(doc(db, "rooms", roomSlug, "rounds", roundId));
    if (round.data()?.state !== "active") throw new Error("The image round is closed.");
    const refs = questionIds.map((id) => doc(db, "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers", id));
    const saved = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const current = Object.fromEntries(saved.map((answer, index) => [questionIds[index], parseImageMatch(answer.data(), imageIds)]));
    const next = editImageMatches(current, change, questionIds, imageIds);
    refs.forEach((ref, index) => {
      const id = questionIds[index];
      if (next[id].answer !== current[id].answer || next[id].locked !== current[id].locked) {
        transaction.set(ref, { ...next[id], user: uid ?? null }, { merge: true });
      }
    });
    return next;
  });
}
