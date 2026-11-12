"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";

/** Team-owned viewing state, independent of the host presentation and the coin ledger. */
export function useCluesNavigation({ roomSlug, teamId, roundId, questions }: {
  roomSlug: string; teamId?: string | null; roundId?: string | null; questions: { id: string }[];
}) {
  const key = JSON.stringify([roomSlug, teamId ?? null, roundId ?? null]);
  const [selection, setSelection] = useState<{ key: string; questionId: string | null; error: string | null } | null>(null);
  const [write, setWrite] = useState<{ key: string; pending: boolean; error: string | null } | null>(null);

  useEffect(() => {
    if (!teamId || !roundId) return;
    let active = true;
    const stop = onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId), (snapshot) => {
      if (!active) return;
      const questionId: unknown = snapshot.data()?.selectedQuestionId;
      if (questionId !== undefined && (typeof questionId !== "string" || !questionId || questionId.includes("/"))) {
        setSelection({ key, questionId: null, error: "Invalid selected clues question." });
      } else {
        setSelection({ key, questionId: typeof questionId === "string" ? questionId : null, error: null });
      }
    }, (error) => { if (active) setSelection({ key, questionId: null, error: error.message }); });
    return () => { active = false; stop(); };
  }, [key, roomSlug, teamId, roundId]);

  const ready = Boolean(teamId && roundId && selection?.key === key && !selection.error);
  const selected = ready ? selection!.questionId ?? questions[0]?.id ?? null : null;
  const invalidQuestion = selected !== null && questions.length > 0 && !questions.some((question) => question.id === selected);
  const questionId = invalidQuestion ? null : selected;
  const error = (selection?.key === key ? selection.error : null) ??
    (invalidQuestion ? "Selected clues question does not exist in this round." : null) ??
    (write?.key === key ? write.error : null);

  async function selectQuestion(nextQuestionId: string) {
    if (!teamId || !roundId || !ready || invalidQuestion || (write?.key === key && write.pending)) return;
    setWrite({ key, pending: true, error: null });
    try {
      if (!questions.some((question) => question.id === nextQuestionId)) throw new Error("Unknown clues question.");
      await setDoc(doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId),
        { selectedQuestionId: nextQuestionId }, { merge: true });
      setWrite((current) => current?.key === key ? { key, pending: false, error: null } : current);
    } catch (failure) {
      setWrite((current) => current?.key === key ? {
        key, pending: false, error: failure instanceof Error ? failure.message : "Unable to select question.",
      } : current);
    }
  }

  return { questionId, error, pending: !ready || invalidQuestion || Boolean(write?.key === key && write.pending), selectQuestion };
}
