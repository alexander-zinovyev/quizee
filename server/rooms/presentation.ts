import { parseRevealedClues } from "@/types/clues";
import { randomInt } from "node:crypto";
import { parseSortingSnapshot } from "@/types/sorting";
import { Timestamp, type Firestore, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { parseTeamAnswer, type TeamAnswer } from "@/lib/answers";
import { captureMultiStepAnswer, snapshotTeamAnswer, parsePointsPerStep } from "./multi-step-submission";
import { sortingQuestionIds } from "./sorting-questions";

export type Presentation = {
  round: string | null;
  question: string | null;
  withAnswer: boolean;
  promptPage: number;
  answerPage: number;
  revealedClueIds?: string[];
};

export function parsePresentation(value: unknown): Presentation {
  if (!value || typeof value !== "object") throw new Error("Presentation is required.");
  const data = value as Record<string, unknown>;
  const validId = (id: unknown) => id === null || (typeof id === "string" && Boolean(id.trim()) && !id.includes("/"));
  if (!validId(data.round) || !validId(data.question) ||
      typeof data.withAnswer !== "boolean") throw new Error("Invalid presentation.");
  const promptPage = data.promptPage ?? 0;
  const answerPage = data.answerPage ?? 0;
  if (!Number.isInteger(promptPage) || (promptPage as number) < 0 ||
      !Number.isInteger(answerPage) || (answerPage as number) < 0 ||
      (!data.round && data.question)) throw new Error("Invalid presentation pages.");
  return { round: data.round as string | null, question: data.question as string | null,
    withAnswer: data.withAnswer, promptPage: promptPage as number, answerPage: answerPage as number,
    ...(data.revealedClueIds === undefined ? {} : { revealedClueIds: parseRevealedClues(data.revealedClueIds) }) };
}

export function samePresentation(a: Presentation, b: Presentation): boolean {
  return a.round === b.round && a.question === b.question && a.withAnswer === b.withAnswer &&
    a.promptPage === b.promptPage && a.answerPage === b.answerPage &&
    JSON.stringify(a.revealedClueIds ?? []) === JSON.stringify(b.revealedClueIds ?? []);
}

export function leavesStep(current: Presentation, next: Presentation): boolean {
  return Boolean(current.round && current.question && !current.withAnswer &&
    (current.round !== next.round || current.question !== next.question ||
      current.promptPage !== next.promptPage || next.withAnswer));
}

export async function transitionPresentation(
  db: Firestore, roomId: string, uid: string, expected: Presentation, next: Presentation,
  options: { closeRound?: string; activateRound?: string } = {}
) {
  const roomRef = db.collection("rooms").doc(roomId);
  return db.runTransaction(async (tx) => {
    if (options.closeRound && options.activateRound) throw new Error("Choose one round action.");
    const room = await tx.get(roomRef);
    const member = await tx.get(roomRef.collection("members").doc(uid));
    if (!room.exists) throw new Error("Room not found.");
    if (member.data()?.role !== "host") throw new Error("Forbidden");
    if (room.data()?.state !== "playing") throw new Error("Room is not playing.");
    const current = parsePresentation(room.data()?.presenting);
    if (!samePresentation(current, expected)) throw new Error("Presentation changed. Try again.");
    const roundIds = [...new Set([current.round, next.round, options.closeRound, options.activateRound].filter((id): id is string => Boolean(id)))];
    const rounds = new Map<string, DocumentData>();
    for (const id of roundIds) {
      const snap = await tx.get(roomRef.collection("rounds").doc(id));
      if (!snap.exists) throw new Error("Round not found.");
      rounds.set(id, snap.data()!);
    }
    if (options.activateRound && ((rounds.get(options.activateRound)?.type === "sorting" ? !samePresentation(current, next) : next.round !== options.activateRound) || rounds.get(options.activateRound)?.state !== "scheduled")) {
      throw new Error("Round cannot be activated.");
    }
    if (options.closeRound && (!["text", "image", "multi-step", "color", "sorting", "clues"].includes(rounds.get(options.closeRound)?.type) || rounds.get(options.closeRound)?.state !== "active")) {
      throw new Error("Round cannot be closed.");
    }
    if (next.round && next.round !== options.activateRound && next.round !== options.closeRound &&
      !["active", "closed"].includes(rounds.get(next.round)?.state)) {
      throw new Error("Round is not active.");
    }
    if (next.round && rounds.get(next.round)?.type === "sorting") {
      if (next.question !== null) throw new Error("Sorting presents the whole round.");
      if (next.withAnswer && rounds.get(next.round)?.state !== "closed") throw new Error("End the sorting round before revealing answers.");
    }
    if ((next.revealedClueIds?.length ?? 0) > 0 && (!next.question || !next.round || rounds.get(next.round)?.type !== "clues" || rounds.get(next.round)?.state !== "closed")) {
      throw new Error("Clues can only be revealed for a presented question in a closed clues round.");
    }
    if (next.question && next.round) {
      if (rounds.get(next.round)?.type === "color" && next.withAnswer && rounds.get(next.round)?.state !== "closed") throw new Error(`End the ${rounds.get(next.round)?.type} round before revealing answers.`);
      const question = await tx.get(roomRef.collection("rounds").doc(next.round).collection("questions").doc(next.question));
      if (!question.exists) throw new Error("Question not found.");
      if (rounds.get(next.round)?.type === "clues") {
        if (next.withAnswer && rounds.get(next.round)?.state !== "closed") throw new Error("End the clues round before revealing answers.");
        const ids = (question.data()?.clues as Array<{ id: string }>).map((clue) => clue.id);
        if (next.revealedClueIds?.some((id) => !ids.includes(id))) throw new Error("Unknown clue reveal.");
        if ((current.round !== next.round || current.question !== next.question) && next.revealedClueIds?.length) throw new Error("Reset clues when changing questions.");
      }
      const stages = question.data()?.stages;
      const stageCount = Array.isArray(stages) && stages.length ? stages.length : 1;
      if (next.promptPage >= stageCount) throw new Error("Invalid step.");
      if (rounds.get(next.round)?.type === "multi-step") {
        const points = parsePointsPerStep(rounds.get(next.round)?.pointsPerStep);
        if (!points.length || stageCount !== points.length) throw new Error("Invalid points per step.");
      }
    }

    const writes: Array<{ ref: DocumentReference; data: DocumentData; merge: boolean }> = [];
    const sourceRound = current.round ? rounds.get(current.round) : undefined;
    const capture = Boolean(sourceRound?.type === "multi-step" && sourceRound.state === "active" &&
      current.question && !current.withAnswer && (leavesStep(current, next) || options.closeRound === current.round));
    if (capture && typeof sourceRound!.allowAnswerChanges !== "boolean") throw new Error("Invalid answer-change policy.");
    const points = capture ? parsePointsPerStep(sourceRound!.pointsPerStep) : [];
    if (capture && (!points.length || current.promptPage >= points.length)) throw new Error("Invalid points per step.");
    let captureQuestion: DocumentReference | null = null;
    let finalizedStep = -1;
    if (capture) {
      captureQuestion = roomRef.collection("rounds").doc(current.round!).collection("questions").doc(current.question!);
      const question = await tx.get(captureQuestion);
      if (!question.exists) throw new Error("Question not found.");
      finalizedStep = question.data()?.finalizedStep ?? -1;
    }
    const initializingSorting = options.activateRound && rounds.get(options.activateRound)?.type === "sorting"
      ? await tx.get(roomRef.collection("rounds").doc(options.activateRound).collection("questions")) : null;
    let startingSortingOrder: string[] | null = null;
    if (initializingSorting) {
      const ids = sortingQuestionIds(initializingSorting.docs);
      const shuffled = [...ids];
      for (let index = shuffled.length - 1; index > 0; index--) {
        const other = randomInt(index + 1);
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
      }
      startingSortingOrder = parseSortingSnapshot({ order: shuffled, revision: 0 }, ids).order;
    }
    const now = Timestamp.now();
    const sortingQuestions = options.closeRound && rounds.get(options.closeRound)?.type === "sorting"
      ? await tx.get(roomRef.collection("rounds").doc(options.closeRound).collection("questions")) : null;
    const colorQuestions = options.closeRound && rounds.get(options.closeRound)?.type === "color"
      ? await tx.get(roomRef.collection("rounds").doc(options.closeRound).collection("questions")) : null;
    if (capture || options.closeRound || initializingSorting) {
      const teams = await tx.get(roomRef.collection("teams"));
      for (const team of teams.docs) {
        const teamRounds = team.ref.collection("rounds");
        if (initializingSorting && startingSortingOrder) {
          const answerRef = teamRounds.doc(options.activateRound!);
          writes.push({ ref: answerRef, data: { order: startingSortingOrder, revision: 0, user: null }, merge: false });
        }
        let captured: TeamAnswer | null = null;
        if (capture && current.promptPage > finalizedStep) {
          const answerRef = teamRounds.doc(current.round!).collection("answers").doc(current.question!);
          const answer = await tx.get(answerRef);
          if (answer.exists) {
            captured = captureMultiStepAnswer(parseTeamAnswer(answer.data()!), current.promptPage, sourceRound!.allowAnswerChanges, now);
            writes.push({ ref: answerRef, data: captured, merge: false });
          }
        }
        if (options.closeRound) {
          const target = roomRef.collection("rounds").doc(options.closeRound).collection("teamAnswers").doc(team.id);
          if (sortingQuestions) {
            const saved = await tx.get(teamRounds.doc(options.closeRound));
            const snapshot = parseSortingSnapshot(saved.data(), sortingQuestionIds(sortingQuestions.docs));
            writes.push({ ref: target, data: { ...snapshot, user: saved.data()?.user ?? null, graded: false, copiedAt: now }, merge: false });
            continue;
          }
          const answers = await tx.get(teamRounds.doc(options.closeRound).collection("answers"));
          writes.push({ ref: target, data: { graded: false, copiedAt: now }, merge: true });
          if (colorQuestions) {
            for (const question of colorQuestions.docs) {
              const saved = answers.docs.find((answer) => answer.id === question.id);
              writes.push({ ref: target.collection("answers").doc(question.id), data: {
                answer: saved?.data().answer ?? question.data().initialColor, user: saved?.data().user ?? null,
              }, merge: false });
            }
            continue;
          }
          for (const answer of answers.docs) {
            const roundType = rounds.get(options.closeRound)!.type;
            // Image packs historically omitted lock/user fields; their grading contract is the image ID.
            const data = roundType === "image" ? { locked: false, user: null, ...answer.data() } : answer.data();
            const input = current.round === options.closeRound && answer.id === current.question && captured
              ? captured : parseTeamAnswer(data);
            const committed = snapshotTeamAnswer(input, rounds.get(options.closeRound)!.type, rounds.get(options.closeRound)!.allowWager === true);
            writes.push({ ref: target.collection("answers").doc(answer.id), data: committed, merge: false });
          }
        }
      }
    }
    if (captureQuestion) {
      const revealsAnswer = next.round === current.round && next.question === current.question && next.withAnswer;
      const nextFinalizedStep = Math.max(finalizedStep, revealsAnswer ? points.length - 1 : current.promptPage);
      if (nextFinalizedStep > finalizedStep) {
        writes.push({ ref: captureQuestion, data: { finalizedStep: nextFinalizedStep }, merge: true });
      }
    }
    if (options.closeRound) writes.push({ ref: roomRef.collection("rounds").doc(options.closeRound),
      data: { state: "closed", activeWindow: { ...rounds.get(options.closeRound)!.activeWindow, endedAt: now }, gradingRequired: true }, merge: true });
    if (options.activateRound) writes.push({ ref: roomRef.collection("rounds").doc(options.activateRound),
      data: { state: "active", activeWindow: { startedAt: now, endedAt: null }, gradingRequired: true,
        ...(startingSortingOrder ? { startingOrder: startingSortingOrder } : {}) }, merge: true });
    for (const write of writes) tx.set(write.ref, write.data, { merge: write.merge });
    tx.update(roomRef, { presenting: next });
  });
}
