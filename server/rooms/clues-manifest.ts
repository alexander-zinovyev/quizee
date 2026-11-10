import type { DocumentReference, WriteBatch } from "firebase-admin/firestore";
import type { CluesPackRound, StoredClueStage } from "@/types/clues";
import type { QuizStage } from "@/types/quiz-stage";

type ResolveStage = (stage: QuizStage) => Promise<StoredClueStage>;
export async function writeCluesRound(batch: WriteBatch, roundRef: DocumentReference, round: CluesPackRound, resolveStage: ResolveStage) {
  for (const [index, question] of round.questions.entries()) {
    const questionRef = roundRef.collection("questions").doc(`question-${index + 1}`);
    batch.set(questionRef, { order: index, stages: [await resolveStage(question.generalClue)],
      clues: question.clues.map(({ id, category, price }) => ({ id, category, price })) });
    batch.set(roundRef.collection("answers").doc(questionRef.id), { hint: question.answer.hint, stages: await Promise.all(question.answer.stages.map(resolveStage)) });
    for (const clue of question.clues) {
      batch.set(questionRef.collection("clues").doc(clue.id), { price: clue.price, content: await resolveStage(clue.content) });
    }
  }
}
