"use client";

import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { assertUniqueImageMatches, editImageMatches, parseImageMatch, type ImageMatchEdit, type ImageMatches } from "@/lib/image-matching";
import { saveImageMatch } from "@/lib/image-match-store";

export function useImageMatches({ roomSlug, teamId, roundId, questionIds, imageIds }: {
  roomSlug?: string; teamId?: string; roundId?: string; questionIds: readonly string[]; imageIds: readonly string[];
}) {
  const { user } = useFirebaseAuth();
  const connected = Boolean(roomSlug && teamId && roundId);
  const ready = questionIds.length > 0 && imageIds.length > 0;
  const [answers, setAnswers] = useState<ImageMatches>({});
  const [enabled, setEnabled] = useState(!connected);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const authoritative = useRef<ImageMatches>({});
  const saving = useRef(false);
  const questionKey = JSON.stringify(questionIds), imageKey = JSON.stringify(imageIds);

  useEffect(() => {
    if (!ready || !roomSlug || !teamId || !roundId) return;
    const ids = JSON.parse(questionKey) as string[];
    const images = JSON.parse(imageKey) as string[];
    return onSnapshot(collection(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers"),
      { includeMetadataChanges: true }, (snapshot) => {
        try {
          const next: ImageMatches = {};
          snapshot.forEach((answer) => {
            if (!ids.includes(answer.id)) throw new Error("Unknown saved image description.");
            next[answer.id] = parseImageMatch(answer.data(), images);
          });
          assertUniqueImageMatches(next);
          authoritative.current = next;
          setAnswers(next);
          setEnabled(!snapshot.metadata.fromCache);
          setLoadError(null);
        } catch (loadError) {
          setEnabled(false);
          setLoadError(loadError instanceof Error ? loadError.message : "Unable to load image matches.");
        }
      }, () => { setEnabled(false); setLoadError("Unable to load image matches."); });
  }, [ready, roomSlug, teamId, roundId, questionKey, imageKey]);

  async function edit(change: ImageMatchEdit) {
    if (!ready || !enabled || saving.current) return null;
    setError(null);
    let optimistic: ImageMatches;
    try { optimistic = editImageMatches(answers, change, questionIds, imageIds); }
    catch (editError) { setError((editError as Error).message); return null; }
    if (!roomSlug || !teamId || !roundId) {
      authoritative.current = optimistic;
      setAnswers(optimistic);
      return optimistic;
    }
    saving.current = true;
    setPending(true);
    setAnswers(optimistic);
    try {
      return await saveImageMatch({ db: getClientFirestore(), roomSlug, teamId, roundId,
        questionIds, imageIds, uid: user?.uid }, change);
    } catch (saveError) {
      setAnswers(authoritative.current);
      setError(saveError instanceof Error ? saveError.message : "Image matches were not saved.");
      return null;
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return { answers, enabled: ready && enabled, pending, error: loadError ?? error,
    dismissError: () => { setError(null); setLoadError(null); }, edit };
}
