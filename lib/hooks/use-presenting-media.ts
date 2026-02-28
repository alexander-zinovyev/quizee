import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";

import { getClientFirestore, getFirebaseClientApp } from "@/lib/firebase/client";
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
      playMedia?: boolean;
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

function shouldAutoStartMedia(question: RoundQuestion | null): boolean {
  if (!question?.media) return false;
  const kind = getMediaKind(question.media);
  if (!question.prompt && (kind.isImage || question.media.autoplay)) {
    return true;
  }
  return false;
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
  const [presentingAnswerImageUrl, setPresentingAnswerImageUrl] = useState<string | null>(null);
  const [presentingTextAnswer, setPresentingTextAnswer] = useState<string | null>(null);
  const [isAnswerImageLoading, setIsAnswerImageLoading] = useState(false);
  const [answerImageError, setAnswerImageError] = useState<string | null>(null);

  const presentingMedia = useMemo(
    () => presentingQuestion?.media ?? null,
    [presentingQuestion]
  );

  const presentingImageAnswer = useMemo<RoundImage | null>(() => {
    if (!presentingRoundMeta?.id || !presentingImageAnswerId) return null;
    return (
      (roundImages[presentingRoundMeta.id] ?? []).find(
        (img) => img.id === presentingImageAnswerId
      ) ?? null
    );
  }, [presentingImageAnswerId, presentingRoundMeta?.id, roundImages]);

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
  }, [roundImages, roundQuestions, roundsMeta]);

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
    isAnswerImageLoading,
    isMediaLoading,
    isPresentingImageRound,
    mediaCacheVersion,
    mediaError,
    mediaKind,
    presentingAnswerImageUrl,
    presentingImageAnswer,
    presentingMedia,
    presentingMediaUrl,
    presentingTextAnswer,
    shouldShowMedia,
    answerImageError,
    DEFAULT_MEDIA_VOLUME,
  };
}
