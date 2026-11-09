import { randomUUID } from "node:crypto";
import type { Bucket } from "@google-cloud/storage";
import type { DocumentReference, WriteBatch } from "firebase-admin/firestore";
import type { CluesPackRound } from "@/types/clues";

export async function writeCluesRound(batch: WriteBatch, roundRef: DocumentReference, roomId: string, round: CluesPackRound, clueImages: Map<string, Buffer>, bucket: Bucket) {
  for (const [index, question] of round.questions.entries()) {
    const questionId = `question-${index + 1}`;
    const questionRef = roundRef.collection("questions").doc(questionId);
    batch.set(questionRef, { order: index, stages: [{ text: question.prompt }],
      clues: question.clues.map(({ id, category, price }) => ({ id, category, price })) });
    batch.set(roundRef.collection("answers").doc(questionId), { hint: question.answer, stages: [{ text: question.answer }] });
    for (const clue of question.clues) {
      let media = null;
      if (clue.image) {
        const image = clueImages.get(clue.image)!;
        const storagePath = `rooms/${roomId}/clue-media/${randomUUID()}.png`;
        await bucket.file(storagePath).save(image, { metadata: { contentType: "image/png", cacheControl: "no-store", metadata: {} } });
        media = { storagePath };
      }
      batch.set(questionRef.collection("clues").doc(clue.id), { price: clue.price, text: clue.text, media });
    }
  }
}
