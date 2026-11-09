import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { parseAttempts, recordedAnswer } from "@/lib/answers";
import { HEX_COLOR, parseColorScoring, parseRegionIds } from "@/types/color";
import { parseSortingOrder, SORTING_ITEM_ID } from "@/types/sorting";
import type { StatsRecordedAnswer, StatsRoundScoring, StatsSnapshot, StatsStage } from "@/types/stats";
import { StatsError } from "./error";
import { completionTime, statsId } from "./model";
import { inferQuestionMaximum } from "./metrics";
import { ALLOWED_MEDIA_EXTENSIONS } from "@/server/rooms/validation";
import { stableJson } from "@/lib/stats/value";
import { legacyOnePointAwards, sourceQuestions } from "./source-layouts";

export type SourceDocument = { id: string; data: Record<string, unknown> };
export type SourceRound = SourceDocument & {
  questions: SourceDocument[];
  prompts?: SourceDocument[];
  answers: SourceDocument[];
  images: SourceDocument[];
  teamAnswers: Record<string, { metadata: Record<string, unknown> | null; answers: SourceDocument[] }>;
};
export type RoomSource = {
  room: SourceDocument;
  readAt: string;
  members: SourceDocument[];
  teams: Array<SourceDocument & { scores: SourceDocument[] }>;
  rounds: SourceRound[];
};

function malformed(label: string): never { throw new StatsError("malformed-source", `Malformed historical data: ${label}.`, 422); }
function text(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return malformed(label);
  return value;
}
function numeric(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return malformed(label);
  return value;
}
function bool(value: unknown, label: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") return malformed(label);
  return value;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return malformed(label);
  return value as Record<string, unknown>;
}
function ordered(documents: SourceDocument[]): SourceDocument[] {
  return [...documents].sort((left, right) => {
    const a = numeric(left.data.order, `${left.id} order`), b = numeric(right.data.order, `${right.id} order`);
    if (a !== b) return a === null ? 1 : b === null ? -1 : a - b;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function parseScoring(data: Record<string, unknown>, questions: SourceDocument[]): StatsRoundScoring {
  let scoring: StatsRoundScoring;
  switch (data.type) {
    case "text":
      // Text packs explicitly make wagers optional; an omitted flag is ordinary text.
      scoring = { type: "text", allowWager: data.allowWager === undefined ? false : bool(data.allowWager, "wager policy") };
      break;
    case "clues": scoring = { type: "clues" }; break;
    case "image": scoring = { type: "image" }; break;
    case "sorting": {
      if (questions.length < 2) malformed("sorting questions");
      scoring = { type: "sorting" };
      break;
    }
    case "multi-step": {
      const points = data.pointsPerStep;
      if (points !== null && points !== undefined && (!Array.isArray(points) || !points.length ||
        !points.every((point) => typeof point === "number" && Number.isFinite(point)))) malformed("step points");
      scoring = { type: "multi-step", pointsPerStep: points === undefined || points === null ? null : points as number[] };
      break;
    }
    case "color": scoring = { type: "color", scoring: data.scoring === undefined || data.scoring === null ? null : parseColorScoring(data.scoring) }; break;
    default: throw new StatsError("unsupported-round", "Unsupported historical round type.", 422);
  }
  inferQuestionMaximum(scoring);
  return scoring;
}

/** Only this read-only adapter consults live room collections. Published reads never call it. */
export async function readEndedRoom(db: Firestore, gameId: string): Promise<RoomSource> {
  const room = db.collection("rooms").doc(statsId(gameId));
  return db.runTransaction(async (tx: Transaction) => {
    const metadata = await tx.get(room);
    if (!metadata.exists) throw new StatsError("room-not-found", "Room not found.", 404);
    if (metadata.data()?.state !== "ended") throw new StatsError("room-not-ended", "Only ended rooms can be snapshotted.", 422);
    const [members, teams, rounds] = await Promise.all([tx.get(room.collection("members")), tx.get(room.collection("teams")), tx.get(room.collection("rounds"))]);
    const sourceTeams = await Promise.all(teams.docs.map(async (team) => ({ id: team.id, data: team.data(),
      scores: (await tx.get(team.ref.collection("scores"))).docs.map((score) => ({ id: score.id, data: score.data() })),
    })));
    const sourceRounds = await Promise.all(rounds.docs.map(async (round) => {
      const [questions, answers, images, prompts] = await Promise.all([tx.get(round.ref.collection("questions")), tx.get(round.ref.collection("answers")), tx.get(round.ref.collection("images")),
        round.data().type === "image" ? tx.get(round.ref.collection("prompts")) : null]);
      const teamAnswers = await Promise.all(teams.docs.map(async (team) => {
        const ref = round.ref.collection("teamAnswers").doc(team.id);
        const [metadata, answers] = await Promise.all([tx.get(ref), round.data().type === "sorting" ? null : tx.get(ref.collection("answers"))]);
        return [team.id, { metadata: metadata.data() ?? null, answers: answers?.docs.map((answer) => ({ id: answer.id, data: answer.data() })) ?? [] }] as const;
      }));
      return { id: round.id, data: round.data(), questions: questions.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
        prompts: prompts?.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
        answers: answers.docs.map((doc) => ({ id: doc.id, data: doc.data() })), images: images.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
        teamAnswers: Object.fromEntries(teamAnswers) };
    }));
    return { room: { id: metadata.id, data: metadata.data()! }, readAt: metadata.readTime.toDate().toISOString(),
      members: members.docs.map((member) => ({ id: member.id, data: member.data() })), teams: sourceTeams, rounds: sourceRounds };
  }, { readOnly: true });
}

/** Normalize supported storage layouts; missing evidence stays null, malformed evidence fails. */
function normalizeSource(source: RoomSource, snapshotId: string): StatsSnapshot {
  if (source.room.data.state !== "ended") throw new StatsError("room-not-ended", "Only ended rooms can be snapshotted.", 422);
  const assets: StatsSnapshot["assets"] = {};
  const asset = (raw: unknown): string | null => {
    if (raw === null || raw === undefined) return null;
    const media = object(raw, "media"), path = text(media.storagePath, "media storage path");
    if (!path || !path.startsWith(`rooms/${source.room.id}/media/`) || path.split("/").some((part) => part === "." || part === "..") || /[\\\x00-\x1f]/.test(path)) malformed("media path");
    if (!ALLOWED_MEDIA_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase())) malformed("unsupported media extension");
    const id = createHash("sha256").update(path).digest("hex");
    assets[id] = { storagePath: path, contentType: text(media.contentType, "media content type") };
    return id;
  };
  const stages = (data: Record<string, unknown> | undefined, field: "prompt" | "answer" = "answer"): StatsStage[] => {
    if (!data) return [];
    if (data.stages !== null && data.stages !== undefined) {
      if (!Array.isArray(data.stages)) malformed("stages");
      return data.stages.map((raw) => {
        const stage = object(raw, "stage");
        return { text: text(stage.text, "stage text"), assetId: asset(stage.media) };
      });
    }
    const stage = { text: text(data.text ?? data[field], "answer/prompt text"), assetId: asset(data.media) };
    return stage.text !== null || stage.assetId !== null ? [stage] : [];
  };
  const appearanceId = (uid: string) => createHash("sha256").update(JSON.stringify([source.room.id, uid])).digest("hex");
  const sourceMembers: Record<string, string> = {};
  const appearances = [...source.members].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((member) => {
    const id = appearanceId(member.id);
    sourceMembers[id] = member.id;
    const teamId = text(member.data.team, "member team");
    if (teamId !== null && !source.teams.some((team) => team.id === teamId)) malformed("member references missing team");
    return { id, alias: text(member.data.name, "member name"), teamId };
  }).filter((appearance) => appearance.teamId !== null || source.members.find((member) => member.id === sourceMembers[appearance.id])?.data.role !== "host")
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const hosts = source.members.filter((member) => member.data.role === "host");
  if (hosts.length > 1) malformed("multiple hosts");
  const host = hosts[0] ? { appearanceId: appearanceId(hosts[0].id), alias: text(hosts[0].data.name, "host name") } : null;
  const teams = [...source.teams].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((team) => ({
    id: team.id, name: text(team.data.name, "team name"), score: numeric(team.data.scoreTotal, "final score"),
  }));
  const rounds = ordered(source.rounds).map((document, roundOrder) => {
    const round = document as SourceRound, scoring = parseScoring(round.data, round.questions);
    if (round.data.state !== "closed") malformed("ended room contains an unclosed round");
    const required = bool(round.data.gradingRequired, "round grading status");
    const teamGrading = teams.map((team) => bool(round.teamAnswers[team.id]?.metadata?.graded, "team grading status"));
    const gradingIncomplete = required === true || teamGrading.includes(false) ? true
      : required === false && teamGrading.every((graded) => graded === true) ? false : null;
    const imageIds = new Map(round.images.map((image) => [image.id, asset(image.data.media)]));
    const questionCount = numeric(round.data.questionCount, "question count");
    if (questionCount !== null && (!Number.isSafeInteger(questionCount) || questionCount < 0)) malformed("question count");
    const teamScores = Object.fromEntries(source.teams.map((team) => [team.id, numeric(team.scores.find((score) => score.id === round.id)?.data.score, "round score")]));
    const criterion = scoring.type === "sorting" ? text(round.data.criterion, "sorting criterion") : null;
    if (scoring.type === "sorting" && !criterion?.trim()) malformed("missing sorting criterion");
    const sortingIds = scoring.type === "sorting" ? round.questions.map((question) => question.id) : null;
    if (sortingIds && (new Set(sortingIds).size !== sortingIds.length || sortingIds.some((id) => !SORTING_ITEM_ID.test(id)))) malformed("sorting question IDs");
    const correctOrder = sortingIds ? parseSortingOrder(round.answers.find((answer) => answer.id === "order")?.data.correctOrder, sortingIds) : null;
    const questionDocuments = correctOrder ? correctOrder.map((id) => round.questions.find((question) => question.id === id)!) : ordered(sourceQuestions(round));
    const sortingOrders = correctOrder ? Object.fromEntries(teams.map((team) => {
      const frozen = round.teamAnswers[team.id]?.metadata;
      const submitted = frozen === null || frozen === undefined ? null : parseSortingOrder(frozen.order, correctOrder);
      if (frozen?.pointsByQuestion !== undefined) {
        const points = object(frozen.pointsByQuestion, "sorting question awards");
        if (Object.keys(points).some((id) => !correctOrder.includes(id))) malformed("sorting award references an unknown question");
        for (const value of Object.values(points)) if (numeric(value, "sorting question points") === null || (value as number) < 0) malformed("sorting question points");
      }
      return [team.id, submitted];
    })) : null;
    const legacyAwards = Object.fromEntries(teams.map((team) => [team.id,
      legacyOnePointAwards(round, questionDocuments, scoring, team.id, teamScores[team.id], questionCount)]));
    const questions = questionDocuments.map((question, order) => {
      const accepted = round.answers.find((answer) => answer.id === question.id)?.data;
      if (correctOrder && (Object.keys(question.data).some((key) => key !== "text" && key !== "media") ||
          !stages(question.data).some((stage) => stage.text?.trim() || stage.assetId))) malformed("sorting question stage");
      const imageId = scoring.type === "image" ? text(accepted?.answer, "accepted image ID") : null;
      const answerStages = correctOrder ? [{ text: `Position ${order + 1}`, assetId: null }] : scoring.type === "image" ? imageId && imageIds.get(imageId) ? [{ text: null, assetId: imageIds.get(imageId)! }] : [] : stages(accepted);
      const answers: Record<string, StatsRecordedAnswer> = {};
      for (const team of teams) {
        const frozen = round.teamAnswers[team.id]?.metadata;
        const submittedOrder = sortingOrders?.[team.id] ?? null;
        const raw = correctOrder ? frozen ?? undefined : round.teamAnswers[team.id]?.answers.find((answer) => answer.id === question.id)?.data;
        let answer: string | null = null;
        const attempts = raw && scoring.type === "multi-step" ? parseAttempts(raw.attempts).map(({ answer, step }) => ({ answer, step })) : [];
        if (raw) {
          if (correctOrder) answer = submittedOrder === null ? null : `Position ${submittedOrder.indexOf(question.id) + 1}`;
          else if (scoring.type === "multi-step") answer = raw.attempts === undefined ? null : recordedAnswer(raw, scoring.type).answer;
          else answer = text(raw.answer, "submitted answer");
        }
        const legacyAward = legacyAwards[team.id].get(question.id);
        const awardedPoints = numeric(correctOrder ? (raw?.pointsByQuestion as Record<string, unknown> | undefined)?.[question.id] : raw?.awardedPoints, "awarded points") ?? legacyAward ?? null;
        const perceptionScore = numeric(raw?.perceptionScore, "perception score");
        if (perceptionScore !== null && (perceptionScore < 0 || perceptionScore > 10)) malformed("perception score");
        if (scoring.type === "color" && answer !== null && answer !== "" && !HEX_COLOR.test(answer)) malformed("submitted color");
        let correctness = bool(raw?.correct, "recorded correctness");
        if (scoring.type === "image" && imageId && imageIds.has(imageId) && answer !== null) correctness = answer === imageId;
        if (scoring.type === "color" && scoring.scoring?.mode === "threshold" && perceptionScore !== null) correctness = perceptionScore >= scoring.scoring.threshold;
        if (scoring.type === "color" && scoring.scoring?.mode === "closest") correctness = null;
        if (correctOrder && submittedOrder !== null) correctness = submittedOrder.indexOf(question.id) === order;
        answers[team.id] = { answer, attempts, correctness, awardedPoints, perceptionScore,
          ...(legacyAward !== undefined ? { awardedPointsProvenance: "legacy-correctness" as const } : {}),
          assetId: scoring.type === "image" && answer !== null ? imageIds.get(answer) ?? null : null };
      }
      const colorValue = (value: unknown, label: string) => {
        const color = text(value, label);
        if (color !== null && !HEX_COLOR.test(color)) malformed(label);
        return color;
      };
      return { id: question.id, order, prompt: stages(question.data, "prompt"), acceptedAnswer: answerStages, answerHint: text(accepted?.hint, "accepted answer hint"), answers,
        color: scoring.type === "color" ? { initialColor: colorValue(question.data.initialColor, "initial color"),
          targetColor: colorValue(accepted?.answer, "target color"), maskAssetId: asset(question.data.mask),
          regionIds: question.data.regionIds === undefined ? null : parseRegionIds(question.data.regionIds) } : null };
    });
    return { id: round.id, order: roundOrder, title: text(round.data.title, "round title") ?? "", scoring, gradingIncomplete, questionCount, questions,
      teamScores, ...(criterion !== null ? { criterion } : {}) };
  });
  const completed = source.room.data.completedAt;
  const completedAt = completed === null || completed === undefined ? null : typeof completed === "string" ? completed
    : typeof (completed as { toDate?: unknown }).toDate === "function" ? (completed as { toDate: () => Date }).toDate().toISOString() : malformed("completion date");
  completionTime(completedAt);
  const content = { schemaVersion: 1 as const, gameId: source.room.id, state: "ended" as const, completedAt,
    packLabel: text(source.room.data.packLabel, "pack label"), title: text(source.room.data.title, "room title") ?? "",
    host, appearances, sourceMembers, teams, rounds, assets };
  const digest = createHash("sha256").update(stableJson(content)).digest("hex");
  return { ...content, id: statsId(snapshotId), snapshotAt: source.readAt, digest };
}

export function normalizeRoomSource(source: RoomSource, snapshotId: string): StatsSnapshot {
  try { return normalizeSource(source, snapshotId); }
  catch (error) {
    if (error instanceof StatsError) throw error;
    throw new StatsError("malformed-source", error instanceof Error ? error.message : "Malformed historical data.", 422);
  }
}
