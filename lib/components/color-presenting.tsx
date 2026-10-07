"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { getClientFirestore } from "@/lib/firebase/client";
import { AnswerWriteQueue } from "@/lib/answer-write-queue";
import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import { ColorImage } from "./color-image";
import { useRoomColorArtwork } from "@/lib/hooks/use-room-color-artwork";
import { ColorControls } from "./color-controls";
import { ColorAnswerReveal } from "./color-answer-reveal";
import { ColorImageIndicator } from "./color-image-indicator";

export function ColorPresenting({ roomSlug, round, question, teamId, isHost, teams, withAnswer }: {
  roomSlug: string; round: RoundMeta; question: RoundQuestion; teamId?: string | null; isHost: boolean;
  teams: Array<{ id: string; name: string }>; withAnswer: boolean;
}) {
  const { getToken } = useFirebaseAuth();
  const [saved, setSaved] = useState<string | null>(null);
  const [score, setScore] = useState<{ perceptionScore: number; awardedPoints: number } | null>(null);
  const [teamColors, setTeamColors] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<AnswerWriteQueue | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<string | null>(null);
  const artwork = useRoomColorArtwork(roomSlug, question.media?.storagePath, question.mask?.storagePath, question.regionIds);
  const initial = question.initialColor ?? "#000000";
  const canEdit = !isHost && !!teamId && round.state === "active" && !withAnswer;
  const reveal = round.state === "closed" && (isHost || withAnswer);
  const teamKey = teams.map((team) => team.id).join("|");

  useEffect(() => {
    if (!isHost || round.state !== "active") return;
    const db = getClientFirestore();
    const unsubs = teamKey.split("|").filter(Boolean).map((id) => onSnapshot(doc(db, "rooms", roomSlug, "teams", id, "rounds", round.id, "answers", question.id),
      (snap) => setTeamColors((prev) => ({ ...prev, [id]: snap.data()?.answer ?? initial })), (e) => setError(e.message)));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [isHost, round.state, teamKey, roomSlug, round.id, question.id, initial]);

  useEffect(() => {
    if (!reveal) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "rounds", round.id, "answers", question.id),
      (snap) => setTarget(snap.data()?.answer ?? null), (e) => setError(e.message));
  }, [reveal, roomSlug, round.id, question.id]);

  useEffect(() => {
    if (!teamId || isHost) return;
    const answerRef = round.state === "closed"
      ? doc(getClientFirestore(), "rooms", roomSlug, "rounds", round.id, "teamAnswers", teamId, "answers", question.id)
      : doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", round.id, "answers", question.id);
    return onSnapshot(answerRef,
      (snap) => {
        const data = snap.data();
        setSaved(data?.answer ?? initial);
        setScore(round.state === "closed" && typeof data?.perceptionScore === "number" && Number.isFinite(data.perceptionScore) && typeof data.awardedPoints === "number" && Number.isFinite(data.awardedPoints)
          ? { perceptionScore: data.perceptionScore, awardedPoints: data.awardedPoints } : null);
      }, (e) => setError(e.message));
  }, [teamId, isHost, roomSlug, round.id, round.state, question.id, initial]);

  useEffect(() => {
    if (!canEdit || !teamId) return;
    const answerRef = doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", round.id, "answers", question.id);
    const writer = new AnswerWriteQueue({
      write: async (mutation) => {
        const token = await getToken();
        const response = await fetch(`/api/rooms/${roomSlug}/rounds/${round.id}/answers/${question.id}`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teamId, ...mutation }),
        });
        if (!response.ok) throw new Error((await response.json()).message ?? "Unable to save color.");
      },
      synchronize: async () => { const snap = await getDocFromServer(answerRef); setSaved(snap.data()?.answer ?? initial); },
      pending: (value) => { if (!queued.current) setPending(value?.answer ?? null); },
      error: (e) => setError(e instanceof Error ? e.message : "Unable to save color."),
    });
    queue.current = writer;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      queued.current = null;
      writer.dispose();
      queue.current = null;
      setPending(null);
    };
  }, [canEdit, teamId, roomSlug, round.id, question.id, getToken, initial]);

  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (queued.current && canEdit) queue.current?.enqueue({ answer: queued.current });
    queued.current = null;
  }
  function change(hex: string) {
    setPending(hex);
    queued.current = hex;
    if (!timer.current) timer.current = setTimeout(flush, 150);
  }
  if (error || artwork?.error) return <p role="alert" className="p-4 text-red-300">{error ?? artwork?.error}</p>;
  if (!artwork?.artwork) return <p className="p-4 text-zinc-100">Loading image...</p>;
  if (reveal && isHost) return target ? <div className="min-h-0 flex-1 overflow-auto p-4"><div className="relative"><ColorImage artwork={artwork.artwork} color={target} label="Correct answer" /><ColorImageIndicator version="original" /></div></div> : <p className="p-4">Loading answer...</p>;
  if (isHost) return <div className="@container min-h-0 flex-1 overflow-auto"><div className="grid grid-cols-1 gap-4 p-4 @sm:grid-cols-2 @3xl:grid-cols-3">
    {teams.map((team) => <figure key={team.id} className="min-w-0"><figcaption className="mb-2 break-words text-center text-sm font-semibold text-zinc-100">{team.name}</figcaption><div className="relative"><ColorImage artwork={artwork.artwork!} color={teamColors[team.id] ?? initial} label={`${team.name}'s answer`} /><ColorImageIndicator version="team" /></div></figure>)}
  </div></div>;
  const color = pending ?? saved ?? initial;
  return <div className="min-h-0 flex-1 overflow-auto"><div className={`grid min-w-0 gap-4 p-4 ${canEdit ? "h-full grid-rows-[minmax(0,1fr)_auto]" : ""}`}>
    {reveal && target ? <ColorAnswerReveal artwork={artwork.artwork} submittedColor={saved ?? initial} targetColor={target} /> : canEdit ? (
      <div className="relative flex min-h-0 items-center justify-center"><ColorImage artwork={artwork.artwork} color={color} className="block h-full w-full object-contain" />{teamId ? <ColorImageIndicator version="team" /> : null}</div>
    ) : <div className="relative"><ColorImage artwork={artwork.artwork} color={color} />{teamId ? <ColorImageIndicator version="team" /> : null}</div>}
    {canEdit ? <ColorControls color={color} disabled={false} onChange={change} onCommit={flush} /> : null}
    {reveal && teamId ? <div aria-label="Question score" className="flex flex-wrap justify-center gap-4 text-sm text-zinc-100">
      {score ? <><span>Similarity <strong>{score.perceptionScore.toFixed(2)} / 10</strong></span><span>Points <strong>{Number(score.awardedPoints.toFixed(2))}</strong></span></> : <span role="status">Scoring...</span>}
    </div> : null}
  </div></div>;
}
