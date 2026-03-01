"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { Question, ImageItem } from "@/types/quiz";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import ZoomableImage from "@/lib/components/zoomable-image";

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
                        <ZoomableImage
                          src={questionMediaSrc}
                          alt={`Prompt media ${index + 1}`}
                          label={label}
                          wrapperClassName="w-full"
                          imageClassName="max-h-32 w-full rounded-xl object-contain"
                          zoomLabel="Zoom prompt image"
                          zoomButtonClassName="hidden group-hover:flex"
                        />
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
                          <ZoomableImage
                            src={matchedImage.src}
                            alt={matchedImage.alt ?? "Matched image"}
                            label={label}
                            wrapperClassName="h-full w-full overflow-hidden rounded-xl"
                            imageClassName="h-full w-full object-cover"
                            zoomLabel="Zoom matched image"
                            zoomButtonClassName="bottom-2 right-2 hidden h-7 w-7 items-center justify-center group-hover:flex"
                          />
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
                      <ZoomableImage
                        src={unmatchedImage.src}
                        alt={unmatchedImage.alt ?? "Quiz image option"}
                        label={unmatchedImage.label}
                        wrapperClassName="h-16 w-16 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900"
                        imageClassName="h-full w-full object-cover"
                        zoomLabel="Zoom image"
                        zoomButtonClassName="hidden group-hover:flex"
                      />
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
    </>
  );
}
