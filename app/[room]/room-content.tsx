"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  updateDoc,
  type Unsubscribe,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";

import Member from "@/components/member";
import Team from "@/components/team";
import type { ChatMessage } from "@/components/chat";
import RoomChatPanel from "./room-chat-panel";
import RoomRoundsPanel from "./room-rounds-panel";
import RoomHostRoundsPanel from "./room-host-rounds-panel";
import type { RoomRosterTeam } from "./room-layout-types";
import type { TeamMember } from "@/components/team";
import type { SubscriptionPolicy } from "@/lib/media/transport";

import type { QuizRoundData } from "@/types/quiz";
import { getClientFirestore, getFirebaseClientApp } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type RoomContentProps = {
  roomSlug: string;
  isHost?: boolean;
  presenting: {
    round?: string | null;
    question?: string | null;
    withAnswer?: boolean;
    playMedia?: boolean;
  } | null;
  viewerTeamId?: string | null;
  viewerName?: string | null;
  memberNames?: Record<string, string>;
  teams?: RoomRosterTeam[];
  hostMember?: TeamMember | null;
  onMediaPolicyChange?: (policy: SubscriptionPolicy, options?: { isHost?: boolean }) => void;
};

type RoundMeta = {
  id: string;
  title: string;
  order: number;
  type: "text" | "image";
  state: "scheduled" | "active" | "closed";
  gradingRequired?: boolean;
};

type RoundQuestion = {
  id: string;
  prompt: string | null;
  displayPrompt: string;
  order: number;
  correctAnswer?: string | null;
  media?: {
    storagePath: string;
    contentType?: string | null;
    size?: number | null;
    autoplay?: boolean;
    filename?: string | null;
    originalPath?: string | null;
  } | null;
};

type RoundQuestions = Record<string, Array<RoundQuestion>>;

type RoundImage = {
  id: string;
  media: RoundQuestion["media"];
};

type RoundImages = Record<string, Array<RoundImage>>;

const DEFAULT_MEDIA_VOLUME = 0.2;
const MEDIA_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

function getMediaKind(media: RoundQuestion["media"] | null | undefined) {
  const contentType = (media?.contentType ?? "").toLowerCase();
  const name =
    (media?.filename ?? media?.originalPath ?? "").toString().toLowerCase();
  const isImage =
    contentType.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|svg)$/.test(name);
  const isAudio =
    contentType.startsWith("audio/") ||
    /\.(mp3|m4a|aac|wav|ogg)$/.test(name);
  const isVideo =
    contentType.startsWith("video/") ||
    /\.(mp4|mov|webm)$/.test(name);
  return { isImage, isAudio, isVideo };
}

function shouldAutoStartMedia(question: RoundQuestion | null): boolean {
  if (!question?.media) return false;
  const kind = getMediaKind(question.media);
  if (!question.prompt && (kind.isImage || question.media.autoplay)) {
    return true;
  }
  return false;
}

function cacheMediaUrl(
  cache: Map<string, { url: string; isBlob: boolean }>,
  storagePath: string,
  url: string,
  isBlob: boolean,
  notify: () => void
) {
  const existing = cache.get(storagePath);
  if (existing?.url === url && existing?.isBlob === isBlob) {
    return;
  }
  cache.set(storagePath, { url, isBlob });
  notify();
}

type RoundAnswers = Record<
  string,
  {
    [questionId: string]: string;
  }
>;

export default function RoomContent({
  roomSlug,
  teams,
  hostMember,
  isHost,
  presenting,
  viewerTeamId,
  viewerName,
  memberNames,
  onMediaPolicyChange,
}: RoomContentProps) {
  const { user, getToken } = useFirebaseAuth();
  const [memberSize, setMemberSize] = useState<number | undefined>(undefined);
  const [roundsMeta, setRoundsMeta] = useState<RoundMeta[]>([]);
  const [roundQuestions, setRoundQuestions] = useState<RoundQuestions>({});
  const [roundAnswers, setRoundAnswers] = useState<RoundAnswers>({});
  const [teamAnswers, setTeamAnswers] = useState<
    Record<string, Record<string, Record<string, { answer: string; correct?: boolean }>>>
  >({});
  const [gradingRequiredRounds, setGradingRequiredRounds] = useState<Record<string, boolean>>({});
  const [roundsError, setRoundsError] = useState<string | null>(null);
  const [isLoadingRounds, setIsLoadingRounds] = useState(true);
  const [isActivatingNext, setIsActivatingNext] = useState(false);
  const [isPresentingUpdatePending, setIsPresentingUpdatePending] = useState(false);
  const [isEndingRound, setIsEndingRound] = useState(false);
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [presentingMediaUrl, setPresentingMediaUrl] = useState<string | null>(null);
  const mediaUrlCacheRef = useRef<Map<string, { url: string; isBlob: boolean }>>(new Map());
  const [mediaCacheVersion, setMediaCacheVersion] = useState(0);
  const mediaPreloadInFlightRef = useRef<Set<string>>(new Set());
  const questionUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const imageUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const answerUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const presentingAnswerUnsubRef = useRef<Unsubscribe | null>(null);
  const teamAnswerRoundUnsubRef = useRef<Unsubscribe | null>(null);
  const teamAnswerUnsubsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const [gradingTeamIndex, setGradingTeamIndex] = useState(0);
  const [roundImages, setRoundImages] = useState<RoundImages>({});
  const [presentingImageAnswerId, setPresentingImageAnswerId] = useState<string | null>(null);
  const [presentingAnswerImageUrl, setPresentingAnswerImageUrl] = useState<string | null>(null);
  const [presentingTextAnswer, setPresentingTextAnswer] = useState<string | null>(null);
  const [isAnswerImageLoading, setIsAnswerImageLoading] = useState(false);
  const [answerImageError, setAnswerImageError] = useState<string | null>(null);
  const [activeEavesdropTeamId, setActiveEavesdropTeamId] = useState<string | null>(null);
  const activeTextRoundIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const db = getClientFirestore();
    const questionUnsubs = questionUnsubsRef.current;
    const imageUnsubs = imageUnsubsRef.current;
    const answerUnsubs = answerUnsubsRef.current;
    setIsLoadingRounds(true);
    setRoundsError(null);
    setRoundsMeta([]);
    setRoundQuestions({});
    setRoundAnswers({});
    setRoundImages({});

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
              rawState === "active" || rawState === "closed" ? (rawState as RoundMeta["state"]) : "scheduled";
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

        // Clean up question listeners for removed rounds.
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

        // Clean up image listeners for removed rounds.
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

        // Clean up answer listeners for removed rounds.
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

        // Attach listeners for new rounds.
        metaList.forEach((meta) => {
          if (questionUnsubs.has(meta.id)) return;

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
                    .map((imageSnap, imgIndex) => {
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
        setIsLoadingRounds(false);
      },
      (error) => {
        console.error("[room-content] rounds snapshot error", error);
        if (!cancelled) {
          setRoundsError("Unable to load rounds right now.");
          setIsLoadingRounds(false);
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

  const rounds: QuizRoundData[] = useMemo(() => {
    const mapped = roundsMeta
      .filter((meta) => meta.state === "active")
      .map<QuizRoundData | null>((meta, index) => {
        const questions = roundQuestions[meta.id] ?? [];

        if (meta.type === "text") {
          return {
            id: meta.id,
            type: "text",
            title: meta.title,
            roundNumber: meta.order + 1 || index + 1,
            questions: questions.map((q) => ({
              ...q,
              prompt: q.displayPrompt,
              media: q.media,
            })),
          };
        }

        if (meta.type === "image") {
          const imagesForRound = roundImages[meta.id] ?? [];
          const images = imagesForRound
            .filter((img) => img.media?.storagePath)
            .map((img, imgIdx) => {
              const storagePath = img.media?.storagePath as string;
              const cached = mediaUrlCacheRef.current.get(storagePath);
              const src = cached?.url ?? MEDIA_PLACEHOLDER;
              return {
                id: img.id ?? `image-${imgIdx}`,
                src,
                alt: img.media?.filename ?? img.media?.originalPath ?? "Quiz image",
              };
            });

          const descriptionQuestions = questions
            .filter((q) => {
              const promptText = q.prompt ?? "";
              return promptText.trim().length > 0;
            })
            .map((q, qIdx) => ({
              ...q,
              prompt: q.displayPrompt || q.prompt || `Item ${qIdx + 1}`,
            }));

          return {
            id: meta.id,
            type: "image",
            title: meta.title,
            roundNumber: meta.order + 1 || index + 1,
            questions: descriptionQuestions,
            images,
          };
        }

        return null;
      });

    return mapped.filter((round): round is QuizRoundData => Boolean(round));
  }, [mediaCacheVersion, roundImages, roundQuestions, roundsMeta]);

  const presentingRoundMeta = useMemo(() => {
    if (!presenting?.round) return null;
    return roundsMeta.find((meta) => meta.id === presenting.round) ?? null;
  }, [presenting?.round, roundsMeta]);

  const activeTextRoundMeta = useMemo(() => {
    return roundsMeta.find((meta) => meta.state === "active" && meta.type === "text") ?? null;
  }, [roundsMeta]);

  const isActiveTextRound = Boolean(activeTextRoundMeta);

  const displayRoundMeta = useMemo(() => {
    if (presentingRoundMeta) return presentingRoundMeta;
    return roundsMeta.find((meta) => meta.state === "active") ?? null;
  }, [presentingRoundMeta, roundsMeta]);

  const activeRoundForControls = useMemo(() => {
    return presentingRoundMeta ?? roundsMeta.find((meta) => meta.state === "active") ?? null;
  }, [presentingRoundMeta, roundsMeta]);

  const controlQuestions = useMemo(() => {
    if (!activeRoundForControls) return [];
    return roundQuestions[activeRoundForControls.id] ?? [];
  }, [activeRoundForControls, roundQuestions]);

  const hostRounds = useMemo(() => {
    return roundsMeta
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((meta, index) => {
        const questions = roundQuestions[meta.id] ?? [];
        const answersForRound = roundAnswers[meta.id] ?? {};

        return {
          id: meta.id,
          title: meta.title,
          order: meta.order,
          roundNumber: meta.order + 1 || index + 1,
          state: meta.state,
          type: meta.type,
          questions: questions.map((q, qIndex) => {
            const answer =
              meta.type === "image"
                ? ""
                : answersForRound[q.id] ??
                  q.correctAnswer ??
                  "";
            return {
              id: q.id,
              prompt: q.prompt ?? q.displayPrompt,
              answer,
              order: q.order ?? qIndex,
            };
          }),
          roomSlug,
        };
      });
  }, [roundAnswers, roundQuestions, roundsMeta]);

  const presentingQuestion = useMemo(() => {
    if (!presenting?.round || !presenting?.question) return null;
    const questions = roundQuestions[presenting.round] ?? [];
    return questions.find((q) => q.id === presenting.question) ?? null;
  }, [presenting?.question, presenting?.round, roundQuestions]);

  const presentingMedia = useMemo(
    () => presentingQuestion?.media ?? null,
    [presentingQuestion]
  );

  const presentingImageAnswer = useMemo(() => {
    if (!presentingRoundMeta?.id || !presentingImageAnswerId) return null;
    return (
      (roundImages[presentingRoundMeta.id] ?? []).find(
        (img) => img.id === presentingImageAnswerId
      ) ?? null
    );
  }, [presentingImageAnswerId, presentingRoundMeta?.id, roundImages]);

  const presentingAnswer = useMemo(() => {
    if (!presenting?.round || !presenting?.question || !presenting?.withAnswer) return null;
    const answerFromCollection =
      roundAnswers[presenting.round]?.[presenting.question] ?? null;
    const fallbackAnswer = presentingQuestion?.correctAnswer ?? null;
    const resolved =
      (presentingTextAnswer && presentingTextAnswer.trim().length
        ? presentingTextAnswer
        : answerFromCollection) ?? fallbackAnswer;
    return resolved?.trim().length ? resolved : null;
  }, [
    presenting?.question,
    presenting?.round,
    presenting?.withAnswer,
    presentingQuestion,
    presentingTextAnswer,
    roundAnswers,
  ]);

  const shouldShowMedia =
    !!presentingQuestion?.media &&
    (typeof presenting?.playMedia === "boolean"
      ? presenting.playMedia
      : shouldAutoStartMedia(presentingQuestion));

  const isPresentingImageRound = presentingRoundMeta?.type === "image";

  const mediaKind = useMemo(() => getMediaKind(presentingMedia), [presentingMedia]);

  useEffect(() => {
    setMediaError(null);
    setPresentingMediaUrl(null);
    setIsMediaLoading(false);
  }, [presentingQuestion?.id]);

  useEffect(() => {
    presentingAnswerUnsubRef.current?.();
    presentingAnswerUnsubRef.current = null;
    setPresentingImageAnswerId(null);
    setAnswerImageError(null);
    setPresentingAnswerImageUrl(null);
    setIsAnswerImageLoading(false);
    setPresentingTextAnswer(null);

    if (
      !presentingRoundMeta?.id ||
      presentingRoundMeta.type !== "image" ||
      !presenting?.withAnswer ||
      !presenting?.question
    ) {
      return;
    }

    const db = getClientFirestore();
    const answerRef = doc(
      db,
      "rooms",
      roomSlug,
      "rounds",
      presentingRoundMeta.id,
      "answers",
      presenting.question
    );
    const unsubscribe = onSnapshot(
      answerRef,
      (answerSnap) => {
        const data = answerSnap.data();
        const answerId =
          data && typeof data.answer === "string" && data.answer.trim().length
            ? data.answer.trim()
            : null;
        setPresentingImageAnswerId(answerId);
      },
      (error) => {
        console.error("[room-content] answer reveal error", error);
        setAnswerImageError("Unable to load the answer right now.");
      }
    );
    presentingAnswerUnsubRef.current = unsubscribe;

    return () => {
      unsubscribe();
      presentingAnswerUnsubRef.current = null;
    };
  }, [
    presenting?.question,
    presenting?.withAnswer,
    presentingRoundMeta?.id,
    presentingRoundMeta?.type,
    roomSlug,
  ]);

  useEffect(() => {
    if (
      !presentingRoundMeta?.id ||
      presentingRoundMeta.type !== "text" ||
      !presenting?.withAnswer ||
      !presenting?.question
    ) {
      setPresentingTextAnswer(null);
      return;
    }

    const db = getClientFirestore();
    const answerRef = doc(
      db,
      "rooms",
      roomSlug,
      "rounds",
      presentingRoundMeta.id,
      "answers",
      presenting.question
    );

    const unsubscribe = onSnapshot(
      answerRef,
      (answerSnap) => {
        const data = answerSnap.data();
        const answer =
          data && typeof data.answer === "string" && data.answer.trim().length
            ? data.answer.trim()
            : null;
        setPresentingTextAnswer(answer);
      },
      (error) => {
        console.error("[room-content] text answer reveal error", error);
        setPresentingTextAnswer(null);
      }
    );

    return () => unsubscribe();
  }, [
    presenting?.question,
    presenting?.withAnswer,
    presentingRoundMeta?.id,
    presentingRoundMeta?.type,
    roomSlug,
  ]);

  useEffect(() => {
    setAnswerImageError(null);
    setPresentingAnswerImageUrl(null);
    setIsAnswerImageLoading(false);

    if (!presentingImageAnswer?.media?.storagePath) return;
    const storagePath = presentingImageAnswer.media.storagePath;
    const cached = mediaUrlCacheRef.current.get(storagePath);
    if (cached) {
      setPresentingAnswerImageUrl(cached.url);
      return;
    }

    let cancelled = false;
    setIsAnswerImageLoading(true);
    const storage = getStorage(getFirebaseClientApp());
    getDownloadURL(ref(storage, storagePath))
      .then(async (url) => {
        if (cancelled) return;
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          cacheMediaUrl(
            mediaUrlCacheRef.current,
            storagePath,
            objectUrl,
            true,
            () => setMediaCacheVersion((v) => v + 1)
          );
          setPresentingAnswerImageUrl(objectUrl);
        } catch (fetchError) {
          console.error("[room-content] answer media fetch error", fetchError);
          cacheMediaUrl(
            mediaUrlCacheRef.current,
            storagePath,
            url,
            false,
            () => setMediaCacheVersion((v) => v + 1)
          );
          setPresentingAnswerImageUrl(url);
        } finally {
          setIsAnswerImageLoading(false);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[room-content] answer media load error", error);
        setAnswerImageError("Unable to load the answer media.");
        setIsAnswerImageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [presentingImageAnswer?.media?.storagePath]);

  useEffect(() => {
    if (!presentingMedia?.storagePath || !shouldShowMedia) return;
    const cached = mediaUrlCacheRef.current.get(presentingMedia.storagePath);
    if (cached) {
      setPresentingMediaUrl(cached.url);
      return;
    }
    let cancelled = false;
    setIsMediaLoading(true);
    const storage = getStorage(getFirebaseClientApp());
    getDownloadURL(ref(storage, presentingMedia.storagePath))
      .then(async (url) => {
        if (cancelled) return;
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          cacheMediaUrl(
            mediaUrlCacheRef.current,
            presentingMedia.storagePath,
            objectUrl,
            true,
            () => setMediaCacheVersion((v) => v + 1)
          );
          setPresentingMediaUrl(objectUrl);
        } catch (fetchError) {
          console.error("[room-content] media blob fetch error", fetchError);
          cacheMediaUrl(
            mediaUrlCacheRef.current,
            presentingMedia.storagePath,
            url,
            false,
            () => setMediaCacheVersion((v) => v + 1)
          );
          setPresentingMediaUrl(url);
        } finally {
          setIsMediaLoading(false);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[room-content] media load error", error);
        setMediaError("Unable to load media.");
        setIsMediaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [presentingMedia?.storagePath, shouldShowMedia]);

  useEffect(() => {
    // Preload media for active rounds as soon as the round is active.
    const activeRoundIds = roundsMeta.filter((r) => r.state === "active").map((r) => r.id);
    if (!activeRoundIds.length) return;
    const storage = getStorage(getFirebaseClientApp());

    activeRoundIds.forEach((roundId) => {
      const meta = roundsMeta.find((r) => r.id === roundId);
      const mediaItems =
        meta?.type === "image"
          ? (roundImages[roundId] ?? []).map((img) => img.media)
          : (roundQuestions[roundId] ?? []).map((q) => q.media);
      mediaItems.forEach((media) => {
        if (!media?.storagePath) return;
        if (mediaUrlCacheRef.current.has(media.storagePath)) return;
        if (mediaPreloadInFlightRef.current.has(media.storagePath)) return;
        mediaPreloadInFlightRef.current.add(media.storagePath);
        getDownloadURL(ref(storage, media.storagePath))
          .then(async (url) => {
            try {
              const response = await fetch(url);
              const blob = await response.blob();
              const objectUrl = URL.createObjectURL(blob);
              cacheMediaUrl(
                mediaUrlCacheRef.current,
                media.storagePath,
                objectUrl,
                true,
                () => setMediaCacheVersion((v) => v + 1)
              );
            } catch {
              cacheMediaUrl(
                mediaUrlCacheRef.current,
                media.storagePath,
                url,
                false,
                () => setMediaCacheVersion((v) => v + 1)
              );
            }
            // Warm cache for images to avoid flicker.
            const kind = getMediaKind(media);
            if (kind.isImage) {
              const img = new Image();
              const src =
                mediaUrlCacheRef.current.get(media.storagePath)?.url ?? url;
              img.src = src;
            } else {
              // Kick off a fetch to warm cache for audio/video.
              const src =
                mediaUrlCacheRef.current.get(media.storagePath)?.url ?? url;
              void fetch(src).catch(() => undefined);
            }
          })
          .catch((error) => {
            console.error("[room-content] media preload error", error);
          })
          .finally(() => {
            mediaPreloadInFlightRef.current.delete(media.storagePath);
          });
      });
    });
  }, [roundImages, roundQuestions, roundsMeta]);

  const gradingAnswers = useMemo(() => {
    if (
      !isHost ||
      !presentingRoundMeta ||
      presentingRoundMeta.type === "image" ||
      presentingRoundMeta.state !== "closed" ||
      !presentingQuestion
    ) {
      return [];
    }

    const roundEntry = teamAnswers[presentingRoundMeta.id] ?? {};
    return teams?.map((team) => {
      const answer =
        roundEntry[team.id]?.[presentingQuestion.id as string] ?? undefined;
      return {
        teamId: team.id,
        teamName: team.name,
        answer: answer?.answer ?? "",
        correct: answer?.correct,
      };
    }) ?? [];
  }, [isHost, presentingQuestion, presentingRoundMeta, teamAnswers, teams]);

  const gradingMatrix = useMemo(() => {
    if (
      !isHost ||
      !presentingRoundMeta ||
      presentingRoundMeta.type === "image" ||
      presentingRoundMeta.state !== "closed" ||
      presenting?.question ||
      gradingRequiredRounds[presentingRoundMeta.id] === false
    ) {
      return [];
    }
    const roundEntry = teamAnswers[presentingRoundMeta.id] ?? {};
    const questions = roundQuestions[presentingRoundMeta.id] ?? [];

    return (
      teams?.map((team) => {
        const answers = questions.map((q, idx) => {
          const teamAnswer = roundEntry[team.id]?.[q.id as string];
          return {
            questionId: q.id as string,
            order: idx,
            answer: teamAnswer?.answer ?? "",
            correct: teamAnswer?.correct,
          };
        });
        return {
          teamId: team.id,
          teamName: team.name,
          answers,
        };
      }) ?? []
    );
  }, [isHost, presenting?.question, presentingRoundMeta, roundQuestions, teamAnswers, teams]);

  useEffect(() => {
    setGradingTeamIndex(0);
  }, [presentingRoundMeta?.id, gradingMatrix.length]);

  useEffect(() => {
    if (!isHost) return;
    const currentTextRoundId = activeTextRoundMeta?.id ?? null;
    if (activeTextRoundIdRef.current !== currentTextRoundId) {
      activeTextRoundIdRef.current = currentTextRoundId;
      setActiveEavesdropTeamId(null);
    }
    if (!currentTextRoundId) {
      setActiveEavesdropTeamId(null);
    }
  }, [activeTextRoundMeta?.id, isHost]);

  useEffect(() => {
    if (!onMediaPolicyChange) return;
    if (!isHost) {
      const audioPolicy: SubscriptionPolicy = isActiveTextRound
        ? { audio: "team-only", video: "all" }
        : { audio: "all", video: "all" };
      onMediaPolicyChange(audioPolicy, { isHost: false });
      return;
    }
    onMediaPolicyChange({ audio: "all", video: "all" }, { isHost: true });
  }, [isActiveTextRound, isHost, onMediaPolicyChange]);

  const currentQuestionIndex = useMemo(() => {
    if (!activeRoundForControls || !presentingQuestion) return -1;
    if (presenting?.round !== activeRoundForControls.id) return -1;
    return controlQuestions.findIndex((q) => q.id === presentingQuestion.id);
  }, [activeRoundForControls, controlQuestions, presenting?.round, presentingQuestion]);

  async function updatePresenting(next: {
    round: string | null;
    question: string | null;
    withAnswer: boolean;
    playMedia?: boolean;
  }) {
    if (!isHost) return;
    setIsPresentingUpdatePending(true);
    try {
      const db = getClientFirestore();
      await updateDoc(doc(db, "rooms", roomSlug), {
        presenting: {
          round: next.round,
          question: next.question,
          withAnswer: next.withAnswer,
          playMedia:
            typeof next.playMedia === "boolean"
              ? next.playMedia
              : presenting?.playMedia ?? false,
        },
      });
    } catch (error) {
      console.error("[room-content] update presenting failed", error);
      setRoundsError("Unable to update current question right now.");
    } finally {
      setIsPresentingUpdatePending(false);
    }
  }

  const presentQuestionFromPanel = async (roundId: string, questionId: string) => {
    const question =
      roundQuestions[roundId]?.find((q) => q.id === questionId) ?? null;
    const autoPlay = shouldAutoStartMedia(question);
    await updatePresenting({
      round: roundId,
      question: questionId,
      withAnswer: false,
      playMedia: autoPlay,
    });
  };

  const hideQuestionFromPanel = async () => {
    await updatePresenting({
      round: activeRoundForControls?.id ?? null,
      question: null,
      withAnswer: false,
      playMedia: false,
    });
  };

  async function handleShowFirstQuestion() {
    if (!isHost || !activeRoundForControls) return;
    const firstQuestion = controlQuestions[0];
    if (!firstQuestion) return;
    const autoPlay = shouldAutoStartMedia(firstQuestion);
    await updatePresenting({
      round: activeRoundForControls.id,
      question: firstQuestion.id,
      withAnswer: false,
      playMedia: autoPlay,
    });
  }

  async function handleShowNextQuestion() {
    if (!isHost || !activeRoundForControls) return;
    if (currentQuestionIndex < 0) return;
    const nextQuestion = controlQuestions[currentQuestionIndex + 1];
    if (!nextQuestion) return;
    const autoPlay = shouldAutoStartMedia(nextQuestion);
    await updatePresenting({
      round: activeRoundForControls.id,
      question: nextQuestion.id,
      withAnswer: false,
      playMedia: autoPlay,
    });
  }

  async function handleHideQuestion() {
    if (!isHost || !activeRoundForControls) return;
    await updatePresenting({
      round: activeRoundForControls.id,
      question: null,
      withAnswer: false,
      playMedia: false,
    });
  }

  async function handleActivateSpecificRound(roundId: string) {
    if (!isHost) return;
    setRoundsError(null);
    try {
      const db = getClientFirestore();
      await Promise.all([
        updateDoc(doc(db, "rooms", roomSlug, "rounds", roundId), {
          state: "active",
          activeWindow: { startedAt: serverTimestamp(), endedAt: null },
          gradingRequired: true,
        }),
        updateDoc(doc(db, "rooms", roomSlug), {
          presenting: {
            round: roundId,
            question: null,
            withAnswer: false,
            playMedia: false,
          },
        }),
      ]);
    } catch (error) {
      console.error("[room-content] activate round failed", error);
      setRoundsError("Unable to activate that round right now.");
    }
  }

  async function handleEndSpecificRound(roundId: string) {
    if (!isHost) return;
    setRoundsError(null);
    try {
      const db = getClientFirestore();
      const roundRef = doc(db, "rooms", roomSlug, "rounds", roundId);
      await copyTeamAnswersToRound(roundId);
      await updateDoc(roundRef, {
        state: "closed",
        activeWindow: { endedAt: serverTimestamp() },
        gradingRequired: true,
      });
      const meta = roundsMeta.find((round) => round.id === roundId);
      if (meta?.type === "image") {
        await autoGradeImageRound(roundId);
      }
    } catch (error) {
      console.error("[room-content] end round failed", error);
      setRoundsError("Unable to end that round right now.");
    }
  }

  async function handleToggleAnswer() {
    if (!isHost || !presentingQuestion || !presentingRoundMeta) return;
    const currentPlayMedia =
      presenting?.playMedia ?? shouldAutoStartMedia(presentingQuestion);
    await updatePresenting({
      round: presentingRoundMeta.id,
      question: presentingQuestion.id,
      withAnswer: !presenting?.withAnswer,
      playMedia: currentPlayMedia,
    });
  }

  async function handlePlayMedia() {
    if (!isHost || !presentingQuestion || !presentingRoundMeta) return;
    await updatePresenting({
      round: presentingRoundMeta.id,
      question: presentingQuestion.id,
      withAnswer: presenting?.withAnswer ?? false,
      playMedia: true,
    });
  }

  async function handleHideMedia() {
    if (!isHost || !presentingQuestion || !presentingRoundMeta) return;
    await updatePresenting({
      round: presentingRoundMeta.id,
      question: presentingQuestion.id,
      withAnswer: presenting?.withAnswer ?? false,
      playMedia: false,
    });
  }

  async function copyTeamAnswersToRound(roundId: string) {
    if (!teams || !teams.length) return;
    const db = getClientFirestore();
    const teamIds = teams.map((team) => team.id).filter(Boolean);

    for (const teamId of teamIds) {
      const src = collection(
        db,
        "rooms",
        roomSlug,
        "teams",
        teamId,
        "rounds",
        roundId,
        "answers"
      );
      const snapshot = await getDocs(src);
      const batch = writeBatch(db);
      const teamAnswerDoc = doc(
        db,
        "rooms",
        roomSlug,
        "rounds",
        roundId,
        "teamAnswers",
        teamId
      );

      batch.set(
        teamAnswerDoc,
        { graded: false, copiedAt: serverTimestamp() },
        { merge: true }
      );

      snapshot.forEach((answerSnap) => {
        const targetRef = doc(teamAnswerDoc, "answers", answerSnap.id);
        batch.set(targetRef, answerSnap.data());
      });

      await batch.commit();
    }
  }

  async function autoGradeImageRound(roundId: string) {
    try {
      const token = await getToken();
      const response = await fetch(`/api/rooms/${roomSlug}/rounds/${roundId}/grade`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.error("[room-content] auto-grade failed", payload);
        setRoundsError(payload.message ?? "Unable to auto-grade image round right now.");
      }
    } catch (error) {
      console.error("[room-content] auto-grade failed", error);
      setRoundsError("Unable to auto-grade image round right now.");
    }
  }

  async function handleEndRound() {
    if (!isHost || !activeRoundForControls || activeRoundForControls.state !== "active") return;
    setIsEndingRound(true);
    try {
      const db = getClientFirestore();
      const roundRef = doc(db, "rooms", roomSlug, "rounds", activeRoundForControls.id);
      await copyTeamAnswersToRound(activeRoundForControls.id);
      await Promise.all([
        updateDoc(roundRef, {
          state: "closed",
          activeWindow: { endedAt: serverTimestamp() },
          gradingRequired: true,
        }),
        updateDoc(doc(db, "rooms", roomSlug), {
          presenting: {
            round: activeRoundForControls.id,
            question: null,
            withAnswer: false,
            playMedia: false,
          },
        }),
      ]);
      if (activeRoundForControls.type === "image") {
        await autoGradeImageRound(activeRoundForControls.id);
      }
    } catch (error) {
      console.error("[room-content] end round failed", error);
      setRoundsError("Unable to end the round right now.");
      } finally {
        setIsEndingRound(false);
      }
    }

  async function handleEndGame() {
    if (!isHost || !allRoundsClosed) return;
    try {
      const db = getClientFirestore();
      await updateDoc(doc(db, "rooms", roomSlug), {
        state: "ended",
        presenting: { round: null, question: null, withAnswer: false, playMedia: false },
      });
      // Clear any remaining media cache to free memory.
      mediaUrlCacheRef.current.forEach((cached) => {
        if (cached.isBlob) {
          URL.revokeObjectURL(cached.url);
        }
      });
      mediaUrlCacheRef.current.clear();
    } catch (error) {
      console.error("[room-content] end game failed", error);
      setRoundsError("Unable to end the game right now.");
    }
  }

  async function gradeAnswer(teamId: string, questionId: string, correct: boolean) {
    if (!isHost || !presentingRoundMeta || presentingRoundMeta.state !== "closed") return;
    const db = getClientFirestore();
    const answerRef = doc(
      db,
      "rooms",
      roomSlug,
      "rounds",
      presentingRoundMeta.id,
      "teamAnswers",
      teamId,
      "answers",
      questionId
    );
    await setDoc(
      answerRef,
      {
        correct,
        gradedAt: serverTimestamp(),
        gradedBy: user?.uid ?? null,
      },
      { merge: true }
    );
  }

  async function finalizeScores() {
    if (!isHost || !presentingRoundMeta || presentingRoundMeta.state !== "closed") return;
    const roundId = presentingRoundMeta.id;
    const answersForRound = teamAnswers[roundId] ?? {};
    const db = getClientFirestore();
    const batch = writeBatch(db);

    const teamUpdates = await Promise.all(
      Object.entries(answersForRound).map(async ([teamId, answers]) => {
        const correctCount = Object.values(answers).filter((ans) => ans.correct === true).length;
        const scoreRef = doc(db, "rooms", roomSlug, "teams", teamId, "scores", roundId);
        const teamRef = doc(db, "rooms", roomSlug, "teams", teamId);
        const [scoreSnap, teamSnap] = await Promise.all([
          getDoc(scoreRef),
          getDoc(teamRef),
        ]);
        const previousScore =
          scoreSnap.exists() && typeof scoreSnap.data().score === "number"
            ? (scoreSnap.data().score as number)
            : 0;
        const currentTotal =
          teamSnap.exists() && typeof teamSnap.data().scoreTotal === "number"
            ? (teamSnap.data().scoreTotal as number)
            : 0;
        const nextTotal = Math.max(0, currentTotal - previousScore + correctCount);

        return { teamId, correctCount, scoreRef, teamRef, nextTotal };
      })
    );

    teamUpdates.forEach(({ teamId, correctCount, scoreRef, teamRef, nextTotal }) => {
      batch.set(scoreRef, { score: correctCount }, { merge: true });
      batch.set(teamRef, { scoreTotal: nextTotal }, { merge: true });
      const teamAnswersRef = doc(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", teamId);
      batch.set(teamAnswersRef, { graded: true }, { merge: true });
      const roundMetaRef = doc(db, "rooms", roomSlug, "rounds", roundId);
      batch.set(roundMetaRef, { gradingRequired: false }, { merge: true });
    });

    await batch.commit();
    setGradingTeamIndex(0);
  }

  const nextScheduledRound = useMemo(() => {
    return (
      roundsMeta
        .filter((meta) => meta.state === "scheduled")
        .sort((a, b) => a.order - b.order)[0] ?? null
    );
  }, [roundsMeta]);

  const teamsForDisplay = useMemo(() => {
    if (!teams) return [];
    const hostId = hostMember?.id?.toString() ?? null;
    return teams.map((team) => {
      const isEavesdropTeam = activeEavesdropTeamId === team.id;
      const members = team.members.map((member) => {
        const memberId = member.id?.toString() ?? "";
        const isHostMember = hostId && memberId === hostId;
        let controlsDisabled = false;
        let forceMuted = false;

        if (isActiveTextRound) {
          if (isHost) {
            const allowAudio = isEavesdropTeam;
            controlsDisabled = !allowAudio;
            forceMuted = !allowAudio;
          } else if (!isHostMember) {
            const isViewerTeam = viewerTeamId && team.id === viewerTeamId;
            controlsDisabled = !isViewerTeam;
            forceMuted = !isViewerTeam;
          }
        }

        return {
          ...member,
          controlsDisabled,
          forceMuted,
        };
      });

      return {
        ...team,
        members,
      };
    });
  }, [activeEavesdropTeamId, hostMember?.id, isActiveTextRound, isHost, teams, viewerTeamId]);

  const allRoundsClosed = useMemo(() => {
    if (!roundsMeta.length) return false;
    return roundsMeta.every((meta) => meta.state === "closed");
  }, [roundsMeta]);

  useEffect(() => {
    if (!isHost || !presentingRoundMeta?.id || presentingRoundMeta.state !== "closed") {
      // Clean up team answer listeners when not grading.
      teamAnswerRoundUnsubRef.current?.();
      teamAnswerRoundUnsubRef.current = null;
      teamAnswerUnsubsRef.current.forEach((unsub) => unsub());
      teamAnswerUnsubsRef.current.clear();
      setTeamAnswers((prev) => {
        if (!presentingRoundMeta?.id) return prev;
        const next = { ...prev };
        delete next[presentingRoundMeta.id];
        return next;
      });
      return;
    }

    const db = getClientFirestore();
    const roundId = presentingRoundMeta.id;
    const teamAnswersRef = collection(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers");

    const unsubTeams = onSnapshot(teamAnswersRef, (teamsSnapshot) => {
      const currentTeamIds = new Set<string>();

      teamsSnapshot.forEach((teamDoc) => {
        const teamId = teamDoc.id;
        currentTeamIds.add(teamId);
        if (teamAnswerUnsubsRef.current.has(teamId)) return;

        const answersRef = collection(teamDoc.ref, "answers");
        const unsubAnswers = onSnapshot(answersRef, (answersSnap) => {
          const answerMap: Record<string, { answer: string; correct?: boolean }> = {};
          answersSnap.forEach((ansDoc) => {
            const data = ansDoc.data();
            answerMap[ansDoc.id] = {
              answer: (data.answer as string) ?? "",
              correct: data.correct as boolean | undefined,
            };
          });
          setTeamAnswers((prev) => ({
            ...prev,
            [roundId]: {
              ...(prev[roundId] ?? {}),
              [teamId]: answerMap,
            },
          }));
        });

        teamAnswerUnsubsRef.current.set(teamId, unsubAnswers);
      });

      // cleanup removed teams
      Array.from(teamAnswerUnsubsRef.current.entries()).forEach(([teamId, unsub]) => {
        if (!currentTeamIds.has(teamId)) {
          unsub();
          teamAnswerUnsubsRef.current.delete(teamId);
          setTeamAnswers((prev) => {
            const next = { ...prev };
            if (next[roundId]) {
              const roundEntry = { ...next[roundId] };
              delete roundEntry[teamId];
              next[roundId] = roundEntry;
            }
            return next;
          });
        }
      });
    });

    teamAnswerRoundUnsubRef.current = unsubTeams;

    return () => {
      unsubTeams();
      teamAnswerRoundUnsubRef.current = null;
      teamAnswerUnsubsRef.current.forEach((unsub) => unsub());
      teamAnswerUnsubsRef.current.clear();
    };
  }, [isHost, presentingRoundMeta?.id, presentingRoundMeta?.state, roomSlug]);

  useEffect(() => {
    function computeSize() {
      if (!teams || !teams.length) {
        setMemberSize(undefined);
        return;
      }

      const maxMembers = Math.max(...teams.map((team) => team.members.length));
      if (maxMembers <= 0) {
        setMemberSize(undefined);
        return;
      }

      const gap = 12; // approx gap-3
      const padding = 24; // approx p-6/p-4 overall
      const viewportWidth = window.innerWidth || 0;
      const viewportHeight = window.innerHeight || 0;

      // Team panels take 2/5 of the 5-column grid (with gaps).
      const gridWidth = Math.max(0, viewportWidth - padding * 2);
      const teamWidth = ((gridWidth - gap * 4) * 2) / 5;

      // Second row roughly half the screen height minus padding/gaps.
      const gridHeight = Math.max(0, viewportHeight - padding * 2);
      const teamHeight = Math.max(0, (gridHeight - gap * 3) / 2);

      const cols = Math.ceil(Math.sqrt(maxMembers));
      const rows = Math.ceil(maxMembers / cols);

      const tileWidth = teamWidth / cols - gap;
      const tileHeight = teamHeight / rows - gap;
      const size = Math.floor(Math.min(tileWidth, tileHeight));

      setMemberSize(size > 0 ? size : undefined);
    }

    computeSize();
    window.addEventListener("resize", computeSize);
    return () => window.removeEventListener("resize", computeSize);
  }, [teams]);

  const roundsPanel = isHost ? (
    <RoomHostRoundsPanel
      rounds={hostRounds}
      presenting={presenting}
      onPresentQuestion={presentQuestionFromPanel}
      onHideQuestion={hideQuestionFromPanel}
      onStartRound={handleActivateSpecificRound}
      onEndRound={handleEndSpecificRound}
      className="col-span-2 flex-1 min-h-0 rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80"
    />
  ) : (
    <RoomRoundsPanel
      rounds={rounds}
      roomSlug={roomSlug}
      teamId={viewerTeamId ?? undefined}
      className="col-span-2 h-full min-h-0 rounded-3xl border border-zinc-200 bg-white/90 p-4 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80"
    />
  );

  const resolvedChatName =
    (viewerName && viewerName.trim()) ||
    (isHost ? hostMember?.name?.trim() : undefined) ||
    undefined;

  async function handleActivateNextRound() {
    if (!isHost || !nextScheduledRound || isActivatingNext) return;
    setIsActivatingNext(true);
    setRoundsError(null);

    try {
      const db = getClientFirestore();
      const roundRef = doc(db, "rooms", roomSlug, "rounds", nextScheduledRound.id);
      const roomRef = doc(db, "rooms", roomSlug);
      await Promise.all([
        updateDoc(roundRef, {
          state: "active",
          activeWindow: { startedAt: serverTimestamp(), endedAt: null },
          gradingRequired: true,
        }),
        updateDoc(roomRef, {
          presenting: { round: nextScheduledRound.id, question: null, withAnswer: false, playMedia: false },
        }),
      ]);
    } catch (error) {
      console.error("[room-content] activate next round failed", error);
      setRoundsError("Unable to start the next round right now.");
    } finally {
      setIsActivatingNext(false);
    }
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-gradient-to-b from-white via-zinc-50 to-zinc-100 dark:from-black dark:via-zinc-950 dark:to-zinc-900">
      <main className="grid h-full grid-rows-2 gap-3 p-1 sm:gap-4 sm:p-2 lg:p-3">
        <section className="grid min-h-0 h-full w-full grid-cols-7 items-stretch gap-3">
          {roundsError ? (
            <div className="col-span-2 flex h-full min-h-0 items-center justify-center rounded-3xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700 shadow-xl dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {roundsError}
            </div>
          ) : isLoadingRounds ? (
            <div className="col-span-2 h-full min-h-0 animate-pulse rounded-3xl border border-zinc-200 bg-white/70 p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900/60" />
          ) : !isHost && !rounds.length && nextScheduledRound ? (
            <div className="col-span-2 flex h-full min-h-0 flex-col items-center justify-center gap-3 rounded-3xl border border-zinc-200 bg-white/80 p-6 text-center shadow-xl dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-zinc-600 dark:text-zinc-300">
                Waiting for the next round
              </p>
            </div>
          ) : (
            <div className="col-span-2 flex h-full min-h-0 flex-col gap-3">
              {isHost && allRoundsClosed ? (
                <div className="rounded-2xl border border-dashed border-red-300 bg-red-50/70 px-4 py-3 text-sm text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                  All rounds closed.
                  <button
                    type="button"
                    onClick={handleEndGame}
                    className="ml-3 inline-flex items-center justify-center rounded-lg bg-red-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
                  >
                    End game
                  </button>
                </div>
              ) : null}

              {isHost && !allRoundsClosed && !rounds.length && nextScheduledRound ? (
                <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-700 shadow-sm dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200">
                  Next up: {nextScheduledRound.title}
                  <button
                    type="button"
                    onClick={handleActivateNextRound}
                    disabled={isActivatingNext}
                    className="ml-3 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-400 dark:text-emerald-950 dark:hover:bg-emerald-300 dark:focus:ring-emerald-300 dark:focus:ring-offset-zinc-900"
                  >
                    {isActivatingNext ? "Starting..." : "Next round"}
                  </button>
                </div>
              ) : null}

              <div className="flex-1 min-h-0 space-y-2">{roundsPanel}</div>
            </div>
          )}

          <article className="col-span-3 flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-950 shadow-2xl dark:border-zinc-800">
            <header className="border-b border-white/10 px-5 py-4 text-white">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
                  {displayRoundMeta?.title ?? "Current question"}
                </p>
                {presentingQuestion ? (
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100">
                    Question {presentingQuestion.order + 1}
                  </p>
                ) : null}
              </div>
            </header>
            <div className="relative flex-1 overflow-hidden bg-black">
              {!presenting?.round ? (
                displayRoundMeta ? (
                  <div className="flex h-full w-full items-center justify-center px-8 text-center text-2xl font-semibold text-white">
                    {displayRoundMeta.title}
                  </div>
                ) : (
                  <div className="h-full w-full bg-black" />
                )
              ) : presenting?.round && !presenting?.question ? (
                presentingRoundMeta?.state === "closed" &&
                gradingMatrix.length &&
                gradingTeamIndex >= 0 &&
                gradingTeamIndex < gradingMatrix.length ? (
                  <div className="flex h-full w-full flex-col gap-4 overflow-auto px-6 py-6 text-white">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold uppercase tracking-[0.25em] text-emerald-200">
                        Grade answers · {presentingRoundMeta.title} ·{" "}
                        {gradingMatrix[gradingTeamIndex]?.teamName ?? ""}
                      </p>
                      <button
                        type="button"
                        onClick={finalizeScores}
                        className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1"
                      >
                        Finish grading
                      </button>
                    </div>
                    <div className="space-y-3">
                      {gradingMatrix[gradingTeamIndex] ? (
                        <div
                          key={gradingMatrix[gradingTeamIndex].teamId}
                          className="rounded-2xl border border-emerald-200/40 bg-emerald-900/20 p-3"
                        >
                          <div className="space-y-2">
                            {gradingMatrix[gradingTeamIndex].answers.map((ans) => (
                              <div
                                key={ans.questionId}
                                className="flex items-start gap-3 rounded-xl border border-emerald-200/30 bg-emerald-800/30 px-3 py-2"
                              >
                                <div className="w-8 text-xs font-semibold text-emerald-100">
                                  #{ans.order + 1}
                                </div>
                                <div className="flex-1">
                                  <p className="text-sm text-white">{ans.answer || "—"}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void gradeAnswer(
                                        gradingMatrix[gradingTeamIndex].teamId,
                                        ans.questionId,
                                        true
                                      )
                                    }
                                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${
                                      ans.correct === true
                                        ? "border-emerald-500 bg-emerald-500 text-white"
                                        : "border-emerald-400 bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/40"
                                    }`}
                                    title="Mark correct"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void gradeAnswer(
                                        gradingMatrix[gradingTeamIndex].teamId,
                                        ans.questionId,
                                        false
                                      )
                                    }
                                    className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${
                                      ans.correct === false
                                        ? "border-red-500 bg-red-500 text-white"
                                        : "border-red-400 bg-red-400/20 text-red-100 hover:bg-red-400/40"
                                    }`}
                                    title="Mark incorrect"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setGradingTeamIndex((prev) => Math.max(0, prev - 1))
                                }
                                disabled={gradingTeamIndex <= 0}
                                className="rounded-md bg-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-50"
                              >
                                Prev team
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setGradingTeamIndex((prev) =>
                                    Math.min(gradingMatrix.length - 1, prev + 1)
                                  )
                                }
                                disabled={gradingTeamIndex >= gradingMatrix.length - 1}
                                className="rounded-md bg-zinc-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white disabled:opacity-50"
                              >
                                Next team
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center px-8 text-center text-2xl font-semibold text-white">
                    {presentingRoundMeta?.title ?? "Round in progress"}
                  </div>
                )
              ) : presentingQuestion ? (
                <div className="relative h-full w-full text-white">
                  <div className="presenting-scroll h-full w-full overflow-auto">
                    <div className="flex flex-col gap-6 px-8 py-10">
                      {isPresentingImageRound && presenting?.withAnswer ? (
                        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                          <div className="space-y-6">
                            {!shouldShowMedia && presentingQuestion.prompt ? (
                              <h2 className="text-3xl font-semibold leading-tight text-white">
                                {presentingQuestion.prompt}
                              </h2>
                            ) : null}

                            {presentingMedia ? (
                              shouldShowMedia ? (
                                <div className="flex flex-col gap-3">
                                  {isMediaLoading ? (
                                    <p className="text-sm text-zinc-300">Loading media…</p>
                                  ) : presentingMediaUrl ? (
                                    mediaKind.isImage ? (
                                      <img
                                        key={presentingQuestion.id}
                                        src={presentingMediaUrl}
                                        alt={presentingMedia.filename ?? "Question media"}
                                        className="max-h-[70vh] w-full rounded-2xl bg-zinc-900 object-contain"
                                      />
                                    ) : mediaKind.isVideo ? (
                                      <video
                                        key={presentingQuestion.id}
                                        src={presentingMediaUrl}
                                        className="max-h-[70vh] w-full rounded-2xl bg-black object-contain"
                                        controls
                                        playsInline
                                        autoPlay
                                        onLoadedMetadata={(event) => {
                                          event.currentTarget.volume = DEFAULT_MEDIA_VOLUME;
                                        }}
                                      />
                                    ) : mediaKind.isAudio ? (
                                      <audio
                                        key={presentingQuestion.id}
                                        src={presentingMediaUrl}
                                        className="w-full"
                                        controls
                                        autoPlay
                                        onLoadedMetadata={(event) => {
                                          event.currentTarget.volume = DEFAULT_MEDIA_VOLUME;
                                        }}
                                      />
                                    ) : (
                                      <a
                                        href={presentingMediaUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sm text-emerald-300 underline"
                                      >
                                        Open media
                                      </a>
                                    )
                                  ) : null}
                                  {mediaError ? (
                                    <p className="text-sm text-red-300">{mediaError}</p>
                                  ) : null}
                                </div>
                              ) : null
                            ) : null}
                          </div>

                          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-200/40 bg-emerald-900/20 p-4 text-center">
                            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">
                              Answer
                            </p>
                            {isAnswerImageLoading ? (
                              <p className="text-sm text-emerald-100">Loading answer…</p>
                            ) : presentingAnswerImageUrl ? (
                              <img
                                src={presentingAnswerImageUrl}
                                alt="Correct answer"
                                className="max-h-[65vh] w-full rounded-2xl bg-black object-contain"
                              />
                            ) : answerImageError ? (
                              <p className="text-sm text-red-300">{answerImageError}</p>
                            ) : (
                              <p className="text-sm text-emerald-100">
                                Answer not available.
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          {!shouldShowMedia && presentingQuestion.prompt ? (
                            <h2 className="text-3xl font-semibold leading-tight text-white">
                              {presentingQuestion.prompt}
                            </h2>
                          ) : null}

                          {presentingMedia ? (
                            shouldShowMedia ? (
                              <div className="flex flex-col gap-3">
                                {isMediaLoading ? (
                                  <p className="text-sm text-zinc-300">Loading media…</p>
                                ) : presentingMediaUrl ? (
                                  mediaKind.isImage ? (
                                    <img
                                      key={presentingQuestion.id}
                                      src={presentingMediaUrl}
                                      alt={presentingMedia.filename ?? "Question media"}
                                      className="max-h-[70vh] w-full rounded-2xl bg-zinc-900 object-contain"
                                    />
                                  ) : mediaKind.isVideo ? (
                                    <video
                                      key={presentingQuestion.id}
                                      src={presentingMediaUrl}
                                      className="max-h-[70vh] w-full rounded-2xl bg-black object-contain"
                                      controls
                                      playsInline
                                      autoPlay
                                      onLoadedMetadata={(event) => {
                                        event.currentTarget.volume = DEFAULT_MEDIA_VOLUME;
                                      }}
                                    />
                                  ) : mediaKind.isAudio ? (
                                    <audio
                                      key={presentingQuestion.id}
                                      src={presentingMediaUrl}
                                      className="w-full"
                                      controls
                                      autoPlay
                                      onLoadedMetadata={(event) => {
                                        event.currentTarget.volume = DEFAULT_MEDIA_VOLUME;
                                      }}
                                    />
                                  ) : (
                                    <a
                                      href={presentingMediaUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-sm text-emerald-300 underline"
                                    >
                                      Open media
                                    </a>
                                  )
                                ) : null}
                                {mediaError ? (
                                  <p className="text-sm text-red-300">{mediaError}</p>
                                ) : null}
                              </div>
                            ) : null
                          ) : null}
                        </>
                      )}

                      {!presentingQuestion.prompt && !presentingMedia ? (
                        <p className="text-sm text-zinc-300">No content for this question.</p>
                      ) : null}
                    </div>
                  </div>
                  {presenting?.withAnswer && presentingAnswer && !isPresentingImageRound ? (
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                      style={{
                        top: "10%",
                        left: "10%",
                        right: "10%",
                        bottom: "10%",
                      }}
                    >
                      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-emerald-200/80 bg-emerald-700/98 px-8 py-6 text-center text-3xl font-semibold leading-tight text-white shadow-2xl">
                        <span className="block break-words">{presentingAnswer}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center px-8 text-center text-xl font-semibold text-white">
                  Loading question…
                </div>
              )}
            </div>
            {isHost && activeRoundForControls ? (
              <footer className="border-t border-white/10 bg-black/40 px-5 py-3 text-white">
                <div className="flex flex-wrap items-center gap-2">
                  {activeRoundForControls.state === "active" &&
                  !presentingQuestion &&
                  controlQuestions.length ? (
                    <button
                      type="button"
                      onClick={handleShowFirstQuestion}
                      disabled={isPresentingUpdatePending}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Show first question
                    </button>
                  ) : null}

                  {(activeRoundForControls.state === "active" ||
                    activeRoundForControls.state === "closed") &&
                  presentingQuestion &&
                  currentQuestionIndex >= 0 &&
                  currentQuestionIndex < controlQuestions.length - 1 ? (
                    <button
                      type="button"
                      onClick={handleShowNextQuestion}
                      disabled={isPresentingUpdatePending}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Next question
                    </button>
                  ) : null}

                  {activeRoundForControls.state === "active" &&
                  presentingQuestion &&
                  currentQuestionIndex === controlQuestions.length - 1 ? (
                    <button
                      type="button"
                      onClick={handleShowFirstQuestion}
                      disabled={isPresentingUpdatePending}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Show first question
                    </button>
                  ) : null}

                  {presentingQuestion ? (
                    <button
                      type="button"
                      onClick={handleHideQuestion}
                      disabled={isPresentingUpdatePending}
                      className="rounded-lg bg-zinc-700 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Hide question
                    </button>
                  ) : null}

                  {presentingQuestion?.media ? (
                    <button
                      type="button"
                      onClick={shouldShowMedia ? handleHideMedia : handlePlayMedia}
                      disabled={isPresentingUpdatePending}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {shouldShowMedia ? "Hide media" : "Play media"}
                    </button>
                  ) : null}

                  {presentingRoundMeta?.state === "closed" && presentingQuestion ? (
                    <button
                      type="button"
                      onClick={handleToggleAnswer}
                      disabled={isPresentingUpdatePending}
                      className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {presenting?.withAnswer ? "Hide answer" : "Show answer"}
                    </button>
                  ) : null}

                  {activeRoundForControls.state === "active" ? (
                    <button
                      type="button"
                      onClick={handleEndRound}
                      disabled={isEndingRound}
                      className="ml-auto rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-red-400 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isEndingRound ? "Ending..." : "End round"}
                    </button>
                  ) : null}
                </div>
              </footer>
            ) : null}
          </article>

    <RoomChatPanel
      className="col-span-2 h-full min-h-0 rounded-3xl border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/85"
      roomSlug={roomSlug}
      teams={teams}
      viewerTeamId={viewerTeamId ?? undefined}
      isHost={isHost}
      viewerName={resolvedChatName}
      memberNames={memberNames}
    />
        </section>

        <section className="grid min-h-0 h-full grid-cols-5 gap-3">
          {teams?.[0] ? (
            <div className="col-span-2 h-full min-h-0">
              <Team
                name={teams[0].name}
                color={teams[0].color ?? undefined}
                score={teamsForDisplay[0]?.scoreTotal ?? teams[0].scoreTotal ?? undefined}
                members={teamsForDisplay[0]?.members ?? teams[0].members}
                appearance="bare"
                className="h-full justify-end"
                memberSize={memberSize}
                emptyLabel="No members yet."
              />
            </div>
          ) : null}

          <aside className="col-span-1 flex h-full min-h-0 flex-col items-center justify-center gap-4 p-4 rounded-3xl border border-zinc-200 bg-white/90 text-center shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">
              QUIZMASTER
            </p>
            <div className="w-full [&_figcaption]:text-xs [&_figcaption]:tracking-[0.2em]">
              {hostMember ? (
                <Member
                  name={hostMember.name}
                  muted={hostMember.muted ?? false}
                  audioTrack={hostMember.audioTrack}
                  videoTrack={hostMember.videoTrack}
                />
              ) : null}
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              <p>Guiding tonight&apos;s cipher chase.</p>
            </div>
            {isHost && isActiveTextRound && teams?.length ? (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {teams.map((team) => {
                  const isActive = activeEavesdropTeamId === team.id;
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() =>
                        setActiveEavesdropTeamId((prev) =>
                          prev === team.id ? null : team.id
                        )
                      }
                      title={
                        isActive
                          ? `Stop listening to ${team.name}`
                          : `Listen to ${team.name}`
                      }
                      className="group inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-zinc-700 transition hover:bg-black/20 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={[
                          "h-4 w-4",
                          isActive
                            ? "text-emerald-500 dark:text-emerald-300"
                            : "text-zinc-600 dark:text-zinc-300",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <path d="M3 12a9 9 0 0 1 18 0" />
                        <path d="M7 12a5 5 0 0 1 10 0" />
                        <circle cx="12" cy="12" r="1.5" />
                      </svg>
                      {team.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </aside>

          {teams?.[1] ? (
            <div className="col-span-2 h-full min-h-0">
              <Team
                name={teams[1].name}
                color={teams[1].color ?? undefined}
                score={teamsForDisplay[1]?.scoreTotal ?? teams[1].scoreTotal ?? undefined}
                members={teamsForDisplay[1]?.members ?? teams[1].members}
                appearance="bare"
                className="h-full justify-end text-right"
                memberSize={memberSize}
                emptyLabel="No members yet."
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
