import { useEffect, useRef, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";

import { getClientFirestore } from "@/lib/firebase/client";

export type RoundMeta = {
  id: string;
  title: string;
  order: number;
  type: "text" | "image";
  state: "scheduled" | "active" | "closed";
  gradingRequired?: boolean;
};

export type RoundQuestionMedia = {
  storagePath: string;
  contentType?: string | null;
  size?: number | null;
  autoplay?: boolean;
  filename?: string | null;
  originalPath?: string | null;
};

export type RoundQuestion = {
  id: string;
  prompt: string | null;
  displayPrompt: string;
  order: number;
  correctAnswer?: string | null;
  media?: RoundQuestionMedia | null;
};

export type RoundQuestions = Record<string, Array<RoundQuestion>>;

export type RoundImage = {
  id: string;
  media: RoundQuestionMedia | null | undefined;
};

export type RoundImages = Record<string, Array<RoundImage>>;

export type RoundAnswers = Record<string, Record<string, string>>;

export function useRoomRounds(roomSlug: string, isHost?: boolean) {
  const [roundsMeta, setRoundsMeta] = useState<RoundMeta[]>([]);
  const [roundQuestions, setRoundQuestions] = useState<RoundQuestions>({});
  const [roundAnswers, setRoundAnswers] = useState<RoundAnswers>({});
  const [roundImages, setRoundImages] = useState<RoundImages>({});
  const [gradingRequiredRounds, setGradingRequiredRounds] = useState<Record<string, boolean>>({});
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
            const data = docSnap.data();
            const type = (data.type as string | undefined)?.toLowerCase();
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

            if (type !== "text" && type !== "image") {
              return [];
            }
            const roundType: RoundMeta["type"] = type;

            return [
              {
                id: docSnap.id,
                title,
                order,
                type: roundType,
                state,
                gradingRequired: data.gradingRequired as boolean | undefined,
              },
            ];
          })
          .sort((a, b) => a.order - b.order);

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
            const collectionName = meta.type === "image" ? "prompts" : "questions";
            const questionsQuery = query(
              collection(db, "rooms", roomSlug, "rounds", meta.id, collectionName),
              orderBy("order", "asc")
            );

            const unsubscribeQuestions = onSnapshot(
              questionsQuery,
              (questionsSnapshot) => {
                if (cancelled) return;
                const questions = questionsSnapshot.docs
                  .map((questionSnap, qIndex) => {
                    const data = questionSnap.data();
                    const mediaRaw = data.media;
                    const order =
                      typeof data.order === "number"
                        ? data.order
                        : Number(data.order) || qIndex;
                    const promptRaw =
                      typeof data.prompt === "string" && data.prompt.trim().length
                        ? data.prompt.trim()
                        : null;
                    const displayPrompt = promptRaw ?? `Question ${qIndex + 1}`;
                    const media =
                      mediaRaw &&
                      typeof mediaRaw === "object" &&
                      typeof mediaRaw.storagePath === "string" &&
                      mediaRaw.storagePath.length
                        ? {
                            storagePath: mediaRaw.storagePath as string,
                            contentType:
                              typeof mediaRaw.contentType === "string"
                                ? mediaRaw.contentType
                                : null,
                            size:
                              typeof mediaRaw.size === "number"
                                ? mediaRaw.size
                                : Number(mediaRaw.size) || null,
                            autoplay:
                              typeof mediaRaw.autoplay === "boolean"
                                ? mediaRaw.autoplay
                                : false,
                            filename:
                              typeof mediaRaw.filename === "string"
                                ? mediaRaw.filename
                                : null,
                            originalPath:
                              typeof mediaRaw.originalPath === "string"
                                ? mediaRaw.originalPath
                                : null,
                          }
                        : null;
                    const correctAnswer =
                      typeof data.correctAnswer === "string" && data.correctAnswer.trim().length
                        ? data.correctAnswer.trim()
                        : typeof data.answer === "string" && data.answer.trim().length
                          ? data.answer.trim()
                          : null;

                    return {
                      id: questionSnap.id,
                      prompt: promptRaw,
                      displayPrompt,
                      order,
                      correctAnswer,
                      media,
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
                      const mediaRaw = data.media;
                      const media =
                        mediaRaw &&
                        typeof mediaRaw === "object" &&
                        typeof mediaRaw.storagePath === "string" &&
                        mediaRaw.storagePath.length
                          ? {
                              storagePath: mediaRaw.storagePath as string,
                              contentType:
                                typeof mediaRaw.contentType === "string"
                                  ? mediaRaw.contentType
                                  : null,
                              size:
                                typeof mediaRaw.size === "number"
                                  ? mediaRaw.size
                                  : Number(mediaRaw.size) || null,
                              autoplay:
                                typeof mediaRaw.autoplay === "boolean"
                                  ? mediaRaw.autoplay
                                  : false,
                              filename:
                                typeof mediaRaw.filename === "string"
                                  ? mediaRaw.filename
                                  : null,
                              originalPath:
                                typeof mediaRaw.originalPath === "string"
                                  ? mediaRaw.originalPath
                                  : null,
                            }
                          : null;

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

          const canReadAnswers = meta.type !== "image" && isHost;

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
              (answersSnapshot) => {
                if (cancelled) return;

                const answersForRound: Record<string, string> = {};
                answersSnapshot.docs.forEach((answerSnap) => {
                  const data = answerSnap.data();
                  const raw =
                    (typeof data.answer === "string" && data.answer) ||
                    (typeof data.value === "string" && data.value) ||
                    (typeof data.correctAnswer === "string" && data.correctAnswer) ||
                    "";
                  const trimmed = raw.trim();
                  answersForRound[answerSnap.id] = trimmed;
                });

                setRoundAnswers((prev) => ({
                  ...prev,
                  [meta.id]: answersForRound,
                }));
              },
              (answersError) => {
                console.error("[room-content] answers snapshot error", answersError);
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

  const isCurrentRoom = roundLoadState.roomSlug === roomSlug;
  const isLoadingRounds = !isCurrentRoom || !roundLoadState.hasLoaded;

  return {
    gradingRequiredRounds,
    isLoadingRounds,
    roundAnswers: isCurrentRoom ? roundAnswers : {},
    roundImages: isCurrentRoom ? roundImages : {},
    roundQuestions: isCurrentRoom ? roundQuestions : {},
    roundsError: isCurrentRoom ? roundsError : null,
    roundsMeta: isCurrentRoom ? roundsMeta : [],
    setRoundsError,
  };
}
