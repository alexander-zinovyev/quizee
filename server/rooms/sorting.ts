import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { parseSortingOrder } from "@/types/sorting";

export function scoreSortingOrder(submitted: readonly string[], correct: readonly string[]): number {
  const order = parseSortingOrder(submitted, correct);
  return order.reduce((points, id, index) => points + Number(id === correct[index]), 0);
}

/** Frozen submissions and score deltas are read and written in one transaction. */
export async function gradeSortingRound(db: Firestore, roomId: string, roundId: string, uid: string) {
  const room = db.collection("rooms").doc(roomId);
  const round = room.collection("rounds").doc(roundId);
  await db.runTransaction(async (tx) => {
    const member = await tx.get(room.collection("members").doc(uid));
    if (member.data()?.role !== "host") throw new Error("Forbidden");
    const metadata = await tx.get(round);
    if (metadata.data()?.type !== "sorting" || metadata.data()?.state !== "closed") throw new Error("Sorting round must be closed before grading.");
    if (metadata.data()?.gradingRequired === false) return;
    const questions = await tx.get(round.collection("questions"));
    if (questions.docs.length !== 1) throw new Error("Sorting requires one item list.");
    const question = questions.docs[0];
    const items = question.data().items;
    if (!Array.isArray(items)) throw new Error("Missing sorting items.");
    const correct = await tx.get(round.collection("answers").doc(question.id));
    const correctOrder = parseSortingOrder(correct.data()?.correctOrder, items.map((item: { id: string }) => item.id));
    const teams = await tx.get(room.collection("teams"));
    const results = [];
    for (const team of teams.docs) {
      const frozen = round.collection("teamAnswers").doc(team.id);
      const saved = await tx.get(frozen.collection("answers").doc(question.id));
      if (!saved.exists || typeof saved.data()?.answer !== "string") throw new Error("Missing frozen sorting submission.");
      const answer = saved.data()!.answer as string;
      const awardedPoints = answer === "" ? 0 : scoreSortingOrder(JSON.parse(answer), correctOrder);
      const scoreRef = team.ref.collection("scores").doc(roundId);
      const previous = await tx.get(scoreRef);
      const previousScore = previous.data()?.score ?? 0;
      const total = team.data().scoreTotal ?? 0;
      if (typeof previousScore !== "number" || !Number.isFinite(previousScore) || typeof total !== "number" || !Number.isFinite(total)) throw new Error("Invalid stored score.");
      results.push({ team, frozen, scoreRef, awardedPoints, total: total + awardedPoints - previousScore });
    }
    const now = Timestamp.now();
    for (const { team, frozen, scoreRef, awardedPoints, total } of results) {
      tx.set(frozen.collection("answers").doc(question.id), { awardedPoints, gradedAt: now, gradedBy: uid }, { merge: true });
      tx.set(frozen, { graded: true, gradedAt: now, gradedBy: uid }, { merge: true });
      tx.set(scoreRef, { score: awardedPoints }, { merge: true });
      tx.set(team.ref, { scoreTotal: total }, { merge: true });
    }
    tx.set(round, { gradingRequired: false, gradedAt: now }, { merge: true });
  });
}
