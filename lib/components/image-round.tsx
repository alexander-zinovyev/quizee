"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { Question, ImageItem } from "@/types/quiz";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";

type ImageQuizRoundProps = {
  questions: Question[];
  images: ImageItem[];
  onAnswer?: (question: Question, answer: ImageItem) => void;
  roomSlug?: string;
  teamId?: string;
  roundId?: string;
};

type MatchMap = Record<string, string | undefined>;

function normalizeId(id: string | number | undefined, fallback: string) {
  return id !== undefined ? String(id) : fallback;
}

export default function ImageQuizRound({
  questions,
  images,
  onAnswer,
  roomSlug,
  teamId,
  roundId,
}: ImageQuizRoundProps) {
  const { user } = useFirebaseAuth();

  const questionIds = useMemo(
    () =>
      questions.map((question, index) =>
        normalizeId(question.id, `question-${index}`)
      ),
    [questions]
  );

  const imageIds = useMemo(
    () =>
      images.map((image, index) => normalizeId(image.id, `image-${index}`)),
    [images]
  );

  const [matches, setMatches] = useState<MatchMap>({});
  const [locks, setLocks] = useState<Record<string, boolean>>({});

  const matchedImageIds = new Set(
    questionIds
      .map((questionId) => matches[questionId])
      .filter(Boolean) as string[]
  );
  const unmatchedImageIds = imageIds.filter((id) => !matchedImageIds.has(id));

  const questionListRef = useRef<HTMLDivElement>(null);
  const imageListRef = useRef<HTMLDivElement>(null);
  const [zoomedImage, setZoomedImage] = useState<ImageItem | null>(null);

  useEffect(() => {
    if (!roomSlug || !teamId || !roundId) return;
    const db = getClientFirestore();
    const answersRef = collection(
      db,
      "rooms",
      roomSlug,
      "teams",
      teamId,
      "rounds",
      roundId,
      "answers"
    );

    const unsubscribe = onSnapshot(answersRef, (snapshot) => {
      const nextMatches: MatchMap = {};
      const nextLocks: Record<string, boolean> = {};

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const answer = typeof data.answer === "string" ? data.answer : "";
        nextMatches[docSnap.id] = answer || undefined;
        nextLocks[docSnap.id] = Boolean(data.locked);
      });

      setMatches((prev) => ({ ...prev, ...nextMatches }));
      setLocks((prev) => ({ ...prev, ...nextLocks }));
    });

    return () => unsubscribe();
  }, [roomSlug, roundId, teamId]);

  useEffect(() => {
    if (!zoomedImage) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomedImage(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [zoomedImage]);

  async function persistMatch(questionId: string, imageId: string | null, locked: boolean) {
    if (!roomSlug || !teamId || !roundId) return;
    const db = getClientFirestore();
    const answerRef = doc(
      db,
      "rooms",
      roomSlug,
      "teams",
      teamId,
      "rounds",
      roundId,
      "answers",
      questionId
    );
    await setDoc(
      answerRef,
      {
        answer: imageId ?? "",
        locked,
        user: user?.uid ?? null,
      },
      { merge: true }
    );
  }

  function setMatch(questionId: string, imageId: string) {
    if (!imageIds.includes(imageId)) return;
    if (locks[questionId]) return;

    setMatches((previous) => {
      const updated: MatchMap = { ...previous };

      for (const [descId, matchedId] of Object.entries(updated)) {
        if (matchedId === imageId) {
          updated[descId] = undefined;
        }
      }

      updated[questionId] = imageId;
      void persistMatch(questionId, imageId, locks[questionId] ?? false);
      return updated;
    });
  }

  function clearMatch(questionId: string) {
    setMatches((previous) => {
      const updated: MatchMap = { ...previous };
      updated[questionId] = undefined;
      void persistMatch(questionId, null, locks[questionId] ?? false);
      return updated;
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, questionId: string) {
    event.preventDefault();
    const imageId = event.dataTransfer.getData("text/plain");
    if (!imageId) return;
    setMatch(questionId, imageId);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  function handleScrollableDragOver(event: DragEvent<HTMLDivElement>) {
    const container = questionListRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const threshold = 48;

    if (event.clientY < rect.top + threshold) {
      container.scrollBy({ top: -16, behavior: "auto" });
    } else if (event.clientY > rect.bottom - threshold) {
      container.scrollBy({ top: 16, behavior: "auto" });
    }
  }

  function handleImageDrag(event: DragEvent<HTMLDivElement>, imageId: string) {
    event.dataTransfer.setData("text/plain", imageId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleToggleLock(questionId: string) {
    const nextLocked = !locks[questionId];
    setLocks((prev) => ({ ...prev, [questionId]: nextLocked }));
    const imageId = matches[questionId] ?? null;
    void persistMatch(questionId, imageId, nextLocked).then(() => {
      if (nextLocked && imageId) {
        const image = images[imageIds.indexOf(imageId)];
        const question = questions[questionIds.indexOf(questionId)];
        if (image && question) {
          onAnswer?.(question, image);
        }
      }
    });
  }

  function openZoom(image: ImageItem) {
    setZoomedImage(image);
  }

  function closeZoom() {
    setZoomedImage(null);
  }

  const zoomOverlay = zoomedImage ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={zoomedImage.alt ?? "Zoomed image preview"}
      onClick={closeZoom}
    >
      <div
        className="relative flex w-full max-w-5xl flex-col items-center gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="relative w-full overflow-hidden rounded-2xl bg-black shadow-2xl"
          style={{ width: "min(90vw, 960px)", height: "min(90vh, 600px)" }}
        >
          <button
            type="button"
            className="absolute right-3 top-3 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/80"
            aria-label="Close zoomed image"
            onClick={(event) => {
              event.stopPropagation();
              closeZoom();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <Image
            src={zoomedImage.src}
            alt={zoomedImage.alt ?? "Zoomed image"}
            fill
            sizes="(max-width: 1024px) 90vw, 960px"
            className="object-contain"
          />
        </div>
        {zoomedImage.label ? (
          <p className="text-sm text-white/80">{zoomedImage.label}</p>
        ) : null}
      </div>
    </div>
  ) : null;

  if (!questions.length) return null;

  return (
    <>
      <article className="flex h-full w-full flex-col gap-4 overflow-auto pr-2">
        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden lg:flex-row">
          <section
            ref={questionListRef}
            className="grid flex-1 grid-cols-1 gap-3 overflow-auto pr-2"
          >
            {questions.map((question, index) => {
              const questionId = questionIds[index];
              const matchedImageId = matches[questionId];
              const matchedImage =
                matchedImageId !== undefined
                  ? images[imageIds.indexOf(matchedImageId)]
                  : undefined;
              const label = `${index + 1}. ${question.prompt ?? ""}`;
              const questionMediaSrc = question.media?.storagePath ?? null;

              return (
                <div
                  key={questionId}
                  className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {label}
                      </p>
                      {questionMediaSrc ? (
                        <div className="group relative w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={questionMediaSrc}
                            alt={`Prompt media ${index + 1}`}
                            className="max-h-32 w-full rounded-xl object-contain"
                          />
                          <button
                            type="button"
                            className="absolute right-2 top-2 hidden rounded-full bg-black/70 p-1.5 text-white transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/90 group-hover:flex"
                            aria-label="Zoom prompt image"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openZoom({
                                id: `${questionId}-prompt`,
                                src: questionMediaSrc,
                                alt: `Prompt media ${index + 1}`,
                                label: label,
                              });
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-4 w-4"
                            >
                              <circle cx="11" cy="11" r="8" />
                              <line x1="21" y1="21" x2="16.65" y2="16.65" />
                              <line x1="11" y1="8" x2="11" y2="14" />
                              <line x1="8" y1="11" x2="14" y2="11" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleLock(questionId)}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border text-white transition ${
                        locks[questionId]
                          ? "border-zinc-300 bg-zinc-500 hover:bg-zinc-400 dark:border-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                          : "border-emerald-500 bg-emerald-500 hover:bg-emerald-400"
                      }`}
                      title={locks[questionId] ? "Edit match" : "Lock match"}
                    >
                      {locks[questionId] ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="h-4 w-4"
                        >
                          <path d="M4 20h4l10.5-10.5a1.5 1.5 0 00-3-3L5 17v3z" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="h-4 w-4"
                        >
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div
                    className={`relative flex-none h-16 rounded-2xl border-2 border-dashed text-xs text-zinc-400 transition-colors dark:text-zinc-500 ${
                      matchedImage
                        ? "w-full border-transparent bg-transparent"
                        : "aspect-square border-zinc-300 p-2 dark:border-zinc-700"
                    }`}
                    onDragOver={(event) => {
                      handleDragOver(event);
                      handleScrollableDragOver(event);
                    }}
                    onDrop={(event) => handleDrop(event, questionId)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Drop image for question ${index + 1}`}
                  >
                    {matchedImage ? (
                      <div className="flex h-full w-full items-center gap-2">
                        <div
                          className="group relative h-full w-16 shrink-0 cursor-grab overflow-hidden rounded-xl"
                          draggable
                          onDragStart={(event) =>
                            handleImageDrag(event, matchedImageId as string)
                          }
                        >
                          <Image
                            src={matchedImage.src}
                            alt={matchedImage.alt ?? "Matched image"}
                            fill
                            sizes="(max-width: 640px) 70vw, 256px"
                            className="object-cover"
                          />
                          <button
                            type="button"
                            className="absolute bottom-2 right-2 hidden h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/90 group-hover:flex"
                            aria-label="Zoom matched image"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              openZoom(matchedImage);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-4 w-4"
                            >
                              <circle cx="11" cy="11" r="8" />
                              <line x1="21" y1="21" x2="16.65" y2="16.65" />
                              <line x1="11" y1="8" x2="11" y2="14" />
                              <line x1="8" y1="11" x2="14" y2="11" />
                            </svg>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            clearMatch(questionId);
                          }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-white/70"
                          aria-label="Remove image match"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="flex flex-none min-h-0 flex-col rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
            <div
              ref={imageListRef}
              className="grid flex-1 grid-cols-1 gap-3 overflow-auto pr-2 lg:grid-cols-1 xl:grid-cols-1"
            >
              {unmatchedImageIds.length ? (
                unmatchedImageIds.map((imageId) => {
                  const unmatchedImage = images[imageIds.indexOf(imageId)];

                  return (
                    <div
                      key={imageId}
                      className="group relative flex cursor-grab items-center justify-center rounded-xl border border-zinc-200 bg-white/95 p-2 shadow-sm transition hover:border-blue-300 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-950"
                      draggable
                      onDragStart={(event) => handleImageDrag(event, imageId)}
                    >
                      <div className="relative h-16 w-16 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                        <Image
                          src={unmatchedImage.src}
                          alt={unmatchedImage.alt ?? "Quiz image option"}
                          fill
                          sizes="(max-width: 640px) 40vw, 128px"
                          className="object-cover"
                        />
                        <button
                          type="button"
                          className="absolute right-2 top-2 hidden rounded-full bg-black/70 p-1.5 text-white transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-white/90 group-hover:flex"
                          aria-label="Zoom image"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openZoom(unmatchedImage);
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            <line x1="11" y1="8" x2="11" y2="14" />
                            <line x1="8" y1="11" x2="14" y2="11" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="shrink-0 self-center whitespace-nowrap px-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  All done!
                </p>
              )}
            </div>
          </section>
        </div>
      </article>
      {typeof document !== "undefined" && zoomOverlay
        ? createPortal(zoomOverlay, document.body)
        : null}
    </>
  );
}
