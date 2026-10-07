import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";

import { getClientFirestore, getFirebaseClientApp } from "@/lib/firebase/client";
import { roomColorArtwork } from "@/lib/media/color-artwork";
import type {
  RoundImage,
  RoundImages,
  RoundMeta,
  RoundQuestion,
  RoundQuestionMedia,
  RoundQuestions,
} from "@/lib/hooks/use-room-rounds";

type PresentingState =
  | {
      round?: string | null;
      question?: string | null;
      withAnswer?: boolean;
      answerPage?: number;
    }
  | null;

const DEFAULT_MEDIA_VOLUME = 0.2;

type MediaKind = {
  isAudio: boolean;
  isImage: boolean;
  isVideo: boolean;
};

function getMediaKind(media: RoundQuestionMedia | null | undefined): MediaKind {
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

export function usesStagedAnswerReveal(roundType: RoundMeta["type"] | null | undefined): boolean {
  return roundType === "text" || roundType === "multi-step";
}

export function getColorPreloadQuestions(questions: RoundQuestion[], questionId?: string | null): RoundQuestion[] {
  const index = Math.max(0, questions.findIndex((question) => question.id === questionId));
  return questions.slice(index, index + 2);
}

function cacheMediaUrl(
  cache: Map<string, { isBlob: boolean; url: string }>,
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

export function usePresentingMedia({
  presenting,
  presentingQuestion,
  presentingRoundMeta,
  roomSlug,
  roundImages,
  roundQuestions,
  roundsMeta,
}: {
  presenting: PresentingState;
  presentingQuestion: RoundQuestion | null;
  presentingRoundMeta: RoundMeta | null;
  roomSlug: string;
  roundImages: RoundImages;
  roundQuestions: RoundQuestions;
  roundsMeta: RoundMeta[];
}) {
  const [isMediaLoading, setIsMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [presentingMediaUrl, setPresentingMediaUrl] = useState<string | null>(null);
  const mediaUrlCacheRef = useRef<Map<string, { url: string; isBlob: boolean }>>(new Map());
  const [mediaCacheVersion, setMediaCacheVersion] = useState(0);
  const mediaPreloadInFlightRef = useRef<Set<string>>(new Set());
  const presentingAnswerUnsubRef = useRef<Unsubscribe | null>(null);
  const [presentingImageAnswerId, setPresentingImageAnswerId] = useState<string | null>(null);
  const [presentingAnswerMediaUrl, setPresentingAnswerMediaUrl] = useState<string | null>(null);
  const [presentingTextAnswer, setPresentingTextAnswer] = useState<string | null>(null);
  const [presentingTextAnswerMedia, setPresentingTextAnswerMedia] = useState<RoundQuestionMedia | null>(null);
  const [presentingTextAnswerStageCount, setPresentingTextAnswerStageCount] = useState(0);
  const [isAnswerMediaLoading, setIsAnswerMediaLoading] = useState(false);
  const [answerMediaError, setAnswerMediaError] = useState<string | null>(null);

  const presentingMedia = useMemo(
    () => presentingRoundMeta?.type === "color" ? null : presentingQuestion?.media ?? null,
    [presentingQuestion, presentingRoundMeta?.type]
  );

  const presentingImageAnswer = useMemo<RoundImage | null>(() => {
    if (!presentingRoundMeta?.id || !presentingImageAnswerId) return null;
    return (
      (roundImages[presentingRoundMeta.id] ?? []).find(
        (img) => img.id === presentingImageAnswerId
      ) ?? null
    );
  }, [presentingImageAnswerId, presentingRoundMeta?.id, roundImages]);

  const shouldShowMedia = !!presentingMedia;

  const isPresentingImageRound = presentingRoundMeta?.type === "image";

  const mediaKind = useMemo(() => getMediaKind(presentingMedia), [presentingMedia]);
  const presentingMediaResetKey = `${presentingQuestion?.id ?? ""}:${presentingQuestion?.media?.storagePath ?? ""}`;

  useEffect(() => {
    setMediaError(null);
    setPresentingMediaUrl(null);
    setIsMediaLoading(false);
  }, [presentingMediaResetKey]);

  useEffect(() => {
    presentingAnswerUnsubRef.current?.();
    presentingAnswerUnsubRef.current = null;
    setPresentingImageAnswerId(null);
    setAnswerMediaError(null);
    setPresentingAnswerMediaUrl(null);
    setIsAnswerMediaLoading(false);
    setPresentingTextAnswer(null);
    setPresentingTextAnswerMedia(null);
    setPresentingTextAnswerStageCount(0);

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
        setAnswerMediaError("Unable to load the answer right now.");
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
      !usesStagedAnswerReveal(presentingRoundMeta.type) ||
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
        const stages = Array.isArray(data?.stages)
          ? (data?.stages as Array<Record<string, unknown>>)
          : [];
        const hasStages = stages.length > 0;
        const stageCount = hasStages ? stages.length : 1;
        setPresentingTextAnswerStageCount(stageCount);
        const requestedStage = Math.max(0, presenting?.answerPage ?? 0);
        const stageIndex = Math.min(requestedStage, stageCount - 1);
        const stage = stages[stageIndex];
        const stageText =
          stage && typeof stage.text === "string" && stage.text.trim().length
            ? stage.text.trim()
            : null;
        const stageMedia =
          stage && stage.media && typeof stage.media === "object"
            ? (() => {
                const media = stage.media as Record<string, unknown>;
                const storagePath =
                  typeof media.storagePath === "string" && media.storagePath.length
                    ? media.storagePath
                    : null;
                if (!storagePath) return null;
                return {
                  storagePath,
                  contentType:
                    typeof media.contentType === "string" ? media.contentType : null,
                  size:
                    typeof media.size === "number"
                      ? media.size
                      : Number(media.size) || null,
                  filename:
                    typeof media.filename === "string" ? media.filename : null,
                  originalPath:
                    typeof media.originalPath === "string" ? media.originalPath : null,
                } satisfies RoundQuestionMedia;
              })()
            : null;
        const answer = hasStages ? stageText : null;
        setPresentingTextAnswer(answer && answer.trim().length ? answer : null);
        setPresentingTextAnswerMedia(stageMedia);
      },
      (error) => {
        console.error("[room-content] text answer reveal error", error);
        setPresentingTextAnswer(null);
        setPresentingTextAnswerMedia(null);
        setPresentingTextAnswerStageCount(0);
      }
    );

    return () => unsubscribe();
  }, [
    presenting?.question,
    presenting?.answerPage,
    presenting?.withAnswer,
    presentingRoundMeta?.id,
    presentingRoundMeta?.type,
    roomSlug,
  ]);

  const presentingAnswerMedia = useMemo<RoundQuestionMedia | null>(() => {
    return presentingImageAnswer?.media ?? presentingTextAnswerMedia ?? null;
  }, [presentingImageAnswer?.media, presentingTextAnswerMedia]);

  const answerMediaKind = useMemo(
    () => getMediaKind(presentingAnswerMedia),
    [presentingAnswerMedia]
  );

  useEffect(() => {
    setAnswerMediaError(null);
    setPresentingAnswerMediaUrl(null);
    setIsAnswerMediaLoading(false);

    const storagePath = presentingAnswerMedia?.storagePath;
    if (!storagePath) return;
    const cached = mediaUrlCacheRef.current.get(storagePath);
    if (cached) {
      setPresentingAnswerMediaUrl(cached.url);
      return;
    }

    let cancelled = false;
    setIsAnswerMediaLoading(true);
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
          setPresentingAnswerMediaUrl(objectUrl);
        } catch (fetchError) {
          console.error("[room-content] answer media fetch error", fetchError);
          cacheMediaUrl(
            mediaUrlCacheRef.current,
            storagePath,
            url,
            false,
            () => setMediaCacheVersion((v) => v + 1)
          );
          setPresentingAnswerMediaUrl(url);
        } finally {
          setIsAnswerMediaLoading(false);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[room-content] answer media load error", error);
        setAnswerMediaError("Unable to load the answer media.");
        setIsAnswerMediaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [presentingAnswerMedia?.storagePath]);

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
    const activeRoundIds = roundsMeta.filter((r) => r.state === "active").map((r) => r.id);
    if (!activeRoundIds.length) return;
    const storage = getStorage(getFirebaseClientApp());

    activeRoundIds.forEach((roundId) => {
      const meta = roundsMeta.find((r) => r.id === roundId);
      if (meta?.type === "color") {
        getColorPreloadQuestions(roundQuestions[roundId] ?? [], presenting?.round === roundId ? presenting.question : null).forEach((question) => {
          if (!question.media?.storagePath || !question.mask?.storagePath) return;
          void roomColorArtwork.load(roomSlug, question.media.storagePath, question.mask.storagePath).catch((error: unknown) => {
            console.error("[room-content] color artwork preload failed", error);
          });
        });
        return;
      }
      const mediaItems =
        meta?.type === "image"
          ? [
              ...(roundImages[roundId] ?? []).map((img) => img.media),
              ...(roundQuestions[roundId] ?? []).map((q) => q.media),
            ]
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

            const kind = getMediaKind(media);
            if (kind.isImage) {
              const img = new Image();
              const src =
                mediaUrlCacheRef.current.get(media.storagePath)?.url ?? url;
              img.src = src;
            } else {
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
  }, [roundImages, roundQuestions, roundsMeta, roomSlug, presenting?.round, presenting?.question]);

  const getCachedMediaUrl = (storagePath: string) => {
    return mediaUrlCacheRef.current.get(storagePath)?.url;
  };

  const clearCachedMedia = () => {
    mediaUrlCacheRef.current.forEach((cached) => {
      if (cached.isBlob) {
        URL.revokeObjectURL(cached.url);
      }
    });
    mediaUrlCacheRef.current.clear();
  };

  return {
    clearCachedMedia,
    getCachedMediaUrl,
    isAnswerMediaLoading,
    isMediaLoading,
    isPresentingImageRound,
    mediaCacheVersion,
    mediaError,
    answerMediaKind,
    mediaKind,
    presentingAnswerMedia,
    presentingAnswerMediaUrl,
    presentingMedia,
    presentingMediaUrl,
    presentingTextAnswer,
    presentingTextAnswerStageCount,
    shouldShowMedia,
    answerMediaError,
    DEFAULT_MEDIA_VOLUME,
  };
}
