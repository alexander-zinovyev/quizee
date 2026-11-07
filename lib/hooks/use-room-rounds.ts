import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";

import { parseHostRoundAnswers } from "@/lib/room-round-answers";
import { closeSortingRound } from "./use-sorting-order";
import { getClientFirestore } from "@/lib/firebase/client";
import type { SortingQuestion } from "@/types/quiz";
import { parseRegionIds } from "@/types/color";

export type RoundMeta = {
  id: string;
  title: string;
  order: number;
  type: "text" | "image" | "multi-step" | "color" | "sorting";
  state: "scheduled" | "active" | "closed";
  gradingRequired?: boolean;
  criterion?: string;
  startingOrder?: string[];
  pointsPerStep?: number[];
  allowAnswerChanges?: boolean;
  allowWager?: boolean;
};

export type RoundQuestionMedia = {
  storagePath: string;
  contentType?: string | null;
  size?: number | null;
  filename?: string | null;
  originalPath?: string | null;
};

export type RoundQuestionStage = {
  text?: string | null;
  media?: RoundQuestionMedia | null;
};

export type RoundQuestion = {
  regionIds?: string[];
  mask?: RoundQuestionMedia | null;
  initialColor?: string;
  id: string;
  finalizedStep?: number;
  prompt: string | null;
  displayPrompt: string;
  order: number;
  correctAnswer?: string | null;
  media?: RoundQuestionMedia | null;
  promptStages?: RoundQuestionStage[];
  answerStages?: RoundQuestionStage[];
  answerHint?: string | null;
};

export type RoundQuestions = Record<string, Array<RoundQuestion>>;

export type RoundImage = {
  id: string;
  media: RoundQuestionMedia | null | undefined;
};

export type RoundImages = Record<string, Array<RoundImage>>;

export type RoundAnswers = Record<string, Record<string, string>>;
export type RoundAnswerHints = Record<string, Record<string, string>>;

export function parseMedia(mediaRaw: unknown): RoundQuestionMedia | null {
  if (
    !mediaRaw ||
    typeof mediaRaw !== "object" ||
    typeof (mediaRaw as { storagePath?: unknown }).storagePath !== "string" ||
    !(mediaRaw as { storagePath?: string }).storagePath?.length
  ) {
    return null;
  }
  const mediaObj = mediaRaw as Record<string, unknown>;
  return {
    storagePath: mediaObj.storagePath as string,
    contentType: typeof mediaObj.contentType === "string" ? mediaObj.contentType : null,
    size: typeof mediaObj.size === "number" ? mediaObj.size : Number(mediaObj.size) || null,
    filename: typeof mediaObj.filename === "string" ? mediaObj.filename : null,
    originalPath: typeof mediaObj.originalPath === "string" ? mediaObj.originalPath : null,
  };
}

export function parseStages(stagesRaw: unknown): RoundQuestionStage[] {
  if (!Array.isArray(stagesRaw)) return [];
  const parsed: RoundQuestionStage[] = [];
  stagesRaw.forEach((stageRaw) => {
    if (!stageRaw || typeof stageRaw !== "object") return;
    const stage = stageRaw as Record<string, unknown>;
    const text =
      typeof stage.text === "string" && stage.text.trim().length
        ? stage.text.trim()
        : null;
    const media = parseMedia(stage.media);
    if (!text && !media) return;
    const normalized: RoundQuestionStage = {};
    if (text) normalized.text = text;
    if (media) normalized.media = media;
    parsed.push(normalized);
  });
  return parsed;
}

export function getActiveRounds(rounds: RoundMeta[]): RoundMeta[] {
  return rounds.filter((round) => round.state === "active");
}

export function getSortingQuestions(questions: RoundQuestion[]): SortingQuestion[] {
  return questions.map((question) => ({ id: question.id, ...(question.prompt ? { text: question.prompt } : {}),
    ...(question.media ? { media: question.media } : {}) }));
}

function parsePointsPerStep(pointsRaw: unknown): number[] | undefined {
  if (!Array.isArray(pointsRaw)) return undefined;
  const points = pointsRaw.filter(
    (point): point is number => typeof point === "number" && Number.isFinite(point)
  );
  return points.length === pointsRaw.length && points.length > 0 ? points : undefined;
}

export function parseRoundMeta(id: string, data: Record<string, unknown>, index: number): RoundMeta | null {
  const type = (data.type as string | undefined)?.toLowerCase();
  if (type !== "text" && type !== "image" && type !== "multi-step" && type !== "color" && type !== "sorting") {
    return null;
  }

  const rawState = (data.state as string | undefined)?.toLowerCase() ?? "scheduled";
  const state =
    rawState === "active" || rawState === "closed"
      ? (rawState as RoundMeta["state"])
      : "scheduled";
  const title =
    typeof data.title === "string" && data.title.trim().length
      ? data.title.trim()
      : `Round ${index + 1}`;
  const order =
    typeof data.order === "number"
      ? data.order
      : Number(data.order) || index;

  const meta: RoundMeta = {
    id,
    title,
    order,
    type,
    state,
    gradingRequired: data.gradingRequired as boolean | undefined,
  };

  if (data.allowWager !== undefined && (type !== "text" || typeof data.allowWager !== "boolean")) {
    throw new Error("Invalid wager configuration.");
  }
  if (type === "sorting") {
    if (typeof data.criterion !== "string" || !data.criterion.trim()) throw new Error("Missing sorting criterion.");
    meta.criterion = data.criterion;
  }
  if (type === "sorting" && data.startingOrder !== undefined) {
    if (!Array.isArray(data.startingOrder) || !data.startingOrder.every((id) => typeof id === "string") || new Set(data.startingOrder).size !== data.startingOrder.length) throw new Error("Invalid starting order.");
    meta.startingOrder = data.startingOrder;
  }
  if (type === "text") meta.allowWager = data.allowWager === true;

  if (type === "multi-step") {
    meta.pointsPerStep = parsePointsPerStep(data.pointsPerStep);
    meta.allowAnswerChanges =
      typeof data.allowAnswerChanges === "boolean" ? data.allowAnswerChanges : undefined;
  }

  return meta;
}

export function useRoomRounds(roomSlug: string, isHost?: boolean) {
  const [roundsMeta, setRoundsMeta] = useState<RoundMeta[]>([]);
  const [roundQuestions, setRoundQuestions] = useState<RoundQuestions>({});
  const [roundAnswers, setRoundAnswers] = useState<RoundAnswers>({});
  const [roundCorrectOrders, setRoundCorrectOrders] = useState<Record<string, string[]>>({});
  const [roundAnswerHints, setRoundAnswerHints] = useState<RoundAnswerHints>({});
  const [roundImages, setRoundImages] = useState<RoundImages>({});
  const [gradingRequiredRounds, setGradingRequiredRounds] = useState<Record<string, boolean>>({});
  const [answerLoadErrors, setAnswerLoadErrors] = useState<Record<string, string>>({});
  const [roundsError, setRoundsError] = useState<string | null>(null);
  const [roundLoadState, setRoundLoadState] = useState({
    hasLoaded: false,
    roomSlug,
  });
  const questionUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const imageUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const answerUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const db = getClientFirestore();
    const questionUnsubs = questionUnsubsRef.current;
    const imageUnsubs = imageUnsubsRef.current;
    const answerUnsubs = answerUnsubsRef.current;
    const roundsQuery = query(
      collection(db, "rooms", roomSlug, "rounds"),
      orderBy("order", "asc")
    );

    const unsubscribeRounds = onSnapshot(
      roundsQuery,
      (roundsSnapshot) => {
        if (cancelled) return;

        const metaList: RoundMeta[] = roundsSnapshot.docs
          .flatMap((docSnap, index) => {
            const parsed = parseRoundMeta(docSnap.id, docSnap.data(), index);
            return parsed ? [parsed] : [];
          })
          .sort((a, b) => a.order - b.order);

        for (const meta of metaList) {
          if (meta.type === "sorting" && meta.state === "closed") closeSortingRound(roomSlug, meta.id);
        }
        const currentRoundIds = new Set(metaList.map((meta) => meta.id));

        questionUnsubs.forEach((unsubscribe, roundId) => {
          if (!currentRoundIds.has(roundId)) {
            unsubscribe();
            questionUnsubs.delete(roundId);
            setRoundQuestions((prev) => {
              const next = { ...prev };
              delete next[roundId];
              return next;
            });
          }
        });

        imageUnsubs.forEach((unsubscribe, roundId) => {
          if (!currentRoundIds.has(roundId)) {
            unsubscribe();
            imageUnsubs.delete(roundId);
            setRoundImages((prev) => {
              const next = { ...prev };
              delete next[roundId];
              return next;
            });
          }
        });

        answerUnsubs.forEach((unsubscribe, roundId) => {
          if (!currentRoundIds.has(roundId)) {
            unsubscribe();
            answerUnsubs.delete(roundId);
            setRoundAnswers((prev) => {
              const next = { ...prev };
              delete next[roundId];
              return next;
            });
            setRoundAnswerHints((prev) => {
              const next = { ...prev };
              delete next[roundId];
              return next;
            });
          }
        });

        metaList.forEach((meta) => {
          const canReadQuestions = isHost || meta.state !== "scheduled";

          if (!canReadQuestions) {
            const existing = questionUnsubs.get(meta.id);
            if (existing) {
              existing();
              questionUnsubs.delete(meta.id);
              setRoundQuestions((prev) => {
                const next = { ...prev };
                delete next[meta.id];
                return next;
              });
            }
          } else if (!questionUnsubs.has(meta.id)) {
            const questionsQuery = query(
              collection(db, "rooms", roomSlug, "rounds", meta.id, "questions"),
              ...(meta.type === "sorting" ? [] : [orderBy("order", "asc")])
            );

            const unsubscribeQuestions = onSnapshot(
              questionsQuery,
              { includeMetadataChanges: true },
              (questionsSnapshot) => {
                if (cancelled || (meta.type === "sorting" && questionsSnapshot.metadata.fromCache)) return;
                const questions = questionsSnapshot.docs
                  .map((questionSnap, qIndex) => {
                    const data = questionSnap.data();
                    const order =
                      typeof data.order === "number"
                        ? data.order
                        : Number(data.order) || qIndex;
                    const promptStages = parseStages(data.stages);
                    const stageText =
                      promptStages.find((stage) => stage.text)?.text ?? null;
                    const stageMedia =
                      promptStages.find((stage) => stage.media)?.media ?? null;
                    const promptRaw =
                      typeof data.text === "string" && data.text.trim().length
                        ? data.text.trim()
                        : stageText;
                    const media = parseMedia(data.media) ?? stageMedia;
                    const displayPrompt = promptRaw ?? `Question ${qIndex + 1}`;
                    const correctAnswer =
                      typeof data.correctAnswer === "string" && data.correctAnswer.trim().length
                        ? data.correctAnswer.trim()
                        : typeof data.answer === "string" && data.answer.trim().length
                          ? data.answer.trim()
                          : null;

                    const answerStages = parseStages(data.answerStages);
                    const answerHint =
                      typeof data.answerHint === "string" && data.answerHint.trim().length
                        ? data.answerHint.trim()
                        : null;

                    return {
                      id: questionSnap.id,
                      finalizedStep: typeof data.finalizedStep === "number" ? data.finalizedStep : -1,
                      prompt: promptRaw,
                      displayPrompt,
                      order,
                      correctAnswer,
                      media,
                      mask: parseMedia(data.mask),
                      regionIds: data.regionIds === undefined ? undefined : parseRegionIds(data.regionIds),
                      initialColor: typeof data.initialColor === "string" ? data.initialColor : undefined,
                      promptStages:
                        promptStages.length > 0
                          ? promptStages
                          : promptRaw || media
                            ? [{ text: promptRaw, media }]
                            : [],
                      answerStages: answerStages.length ? answerStages : undefined,
                      answerHint,
                    };
                  })
                  .sort((a, b) => a.order - b.order);

                setRoundQuestions((prev) => ({
                  ...prev,
                  [meta.id]: questions,
                }));
              },
              (questionsError) => {
                console.error("[room-content] questions snapshot error", questionsError);
                if (!cancelled) {
                  setRoundsError("Unable to load round questions right now.");
                }
              }
            );

            questionUnsubs.set(meta.id, unsubscribeQuestions);
          }

          if (meta.type === "image") {
            if (!canReadQuestions) {
              const existing = imageUnsubs.get(meta.id);
              if (existing) {
                existing();
                imageUnsubs.delete(meta.id);
                setRoundImages((prev) => {
                  const next = { ...prev };
                  delete next[meta.id];
                  return next;
                });
              }
            } else if (!imageUnsubs.has(meta.id)) {
              const imagesQuery = query(
                collection(db, "rooms", roomSlug, "rounds", meta.id, "images")
              );

              const unsubscribeImages = onSnapshot(
                imagesQuery,
                (imagesSnapshot) => {
                  if (cancelled) return;
                  const images = imagesSnapshot.docs
                    .map((imageSnap) => {
                      const data = imageSnap.data();
                      const media = parseMedia(data.media);

                      return {
                        id: imageSnap.id,
                        media,
                      };
                    })
                    .sort(() => Math.random() - 0.5);

                  setRoundImages((prev) => ({
                    ...prev,
                    [meta.id]: images,
                  }));
                },
                (imagesError) => {
                  console.error("[room-content] images snapshot error", imagesError);
                }
              );

              imageUnsubs.set(meta.id, unsubscribeImages);
            }
          }

          const canReadAnswers = Boolean(isHost);

          if (!canReadAnswers) {
            const existing = answerUnsubs.get(meta.id);
            if (existing) {
              existing();
              answerUnsubs.delete(meta.id);
              setRoundAnswers((prev) => {
                const next = { ...prev };
                delete next[meta.id];
                return next;
              });
              setRoundAnswerHints((prev) => {
                const next = { ...prev };
                delete next[meta.id];
                return next;
              });
            }
          } else if (!answerUnsubs.has(meta.id)) {
            const answersQuery = collection(
              db,
              "rooms",
              roomSlug,
              "rounds",
              meta.id,
              "answers"
            );

            const unsubscribeAnswers = onSnapshot(
              answersQuery,
              { includeMetadataChanges: true },
              (answersSnapshot) => {
                if (cancelled || (meta.type === "sorting" && answersSnapshot.metadata.fromCache)) return;

                try {
                  const parsed = parseHostRoundAnswers(meta.type, answersSnapshot.docs.map((answer) => ({ id: answer.id, data: answer.data() })));
                  setRoundAnswers((prev) => ({ ...prev, [meta.id]: parsed.answers }));
                  setRoundAnswerHints((prev) => ({ ...prev, [meta.id]: parsed.hints }));
                  const correctOrder = parsed.correctOrder;
                  if (correctOrder) setRoundCorrectOrders((prev) => ({ ...prev, [meta.id]: correctOrder }));
                  setAnswerLoadErrors((prev) => {
                    if (!(meta.id in prev)) return prev;
                    const next = { ...prev }; delete next[meta.id]; return next;
                  });
                } catch (error) {
                  setAnswerLoadErrors((prev) => ({ ...prev, [meta.id]: error instanceof Error ? error.message : "Unable to load round answers." }));
                  setRoundCorrectOrders((prev) => { const next = { ...prev }; delete next[meta.id]; return next; });
                }
              },
              (answersError) => {
                console.error("[room-content] answers snapshot error", answersError);
                if (!cancelled) setAnswerLoadErrors((prev) => ({ ...prev, [meta.id]: "Unable to load round answers." }));
              }
            );

            answerUnsubs.set(meta.id, unsubscribeAnswers);
          }
        });

        setRoundsMeta(metaList);
        const gradingFlags: Record<string, boolean> = {};
        metaList.forEach((meta) => {
          if (typeof meta.gradingRequired === "boolean") {
            gradingFlags[meta.id] = meta.gradingRequired;
          }
        });
        setGradingRequiredRounds(gradingFlags);
        setRoundLoadState({ hasLoaded: true, roomSlug });
      },
      (error) => {
        console.error("[room-content] rounds snapshot error", error);
        if (!cancelled) {
          setRoundsError("Unable to load rounds right now.");
          setRoundLoadState({ hasLoaded: true, roomSlug });
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribeRounds();
      questionUnsubs.forEach((unsubscribe) => unsubscribe());
      questionUnsubs.clear();
      imageUnsubs.forEach((unsubscribe) => unsubscribe());
      imageUnsubs.clear();
      answerUnsubs.forEach((unsubscribe) => unsubscribe());
      answerUnsubs.clear();
    };
  }, [isHost, roomSlug]);

  const updateRoundsError = useCallback((error: string | null) => {
    setRoundsError(error);
    if (error === null) setAnswerLoadErrors({});
  }, []);
  const isCurrentRoom = roundLoadState.roomSlug === roomSlug;
  const isLoadingRounds = !isCurrentRoom || !roundLoadState.hasLoaded;

  return {
    gradingRequiredRounds,
    isLoadingRounds,
    roundAnswers: isCurrentRoom && isHost ? roundAnswers : {},
    roundCorrectOrders: isCurrentRoom && isHost ? roundCorrectOrders : {},
    roundAnswerHints: isCurrentRoom && isHost ? roundAnswerHints : {},
    roundImages: isCurrentRoom ? roundImages : {},
    roundQuestions: isCurrentRoom ? roundQuestions : {},
    roundsError: isCurrentRoom ? roundsError ?? (isHost ? roundsMeta.map((round) => answerLoadErrors[round.id]).find(Boolean) ?? null : null) : null,
    roundsMeta: isCurrentRoom ? roundsMeta : [],
    setRoundsError: updateRoundsError,
  };
}
