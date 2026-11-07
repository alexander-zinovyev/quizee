"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { Lock, LockOpen } from "lucide-react";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { getClientFirestore } from "@/lib/firebase/client";
import { AnswerWriteQueue, type PendingAnswer } from "@/lib/answer-write-queue";
import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import { ColorImage } from "./color-image";
import { useRoomColorArtwork } from "@/lib/hooks/use-room-color-artwork";
import { useColorSubmissions } from "@/lib/hooks/use-color-submissions";
import { ColorControls } from "./color-controls";
import { ColorSubmissions } from "./color-submissions";
import { ColorImageIndicator } from "./color-image-indicator";

export function ColorPresenting({ roomSlug, round, question, teamId, isHost, teams, withAnswer }: {
  roomSlug: string; round: RoundMeta; question: RoundQuestion; teamId?: string | null; isHost: boolean;
  teams: Array<{ id: string; name: string }>; withAnswer: boolean;
}) {
  const { getToken } = useFirebaseAuth();
  const initial = question.initialColor ?? "#000000";
  const [saved, setSaved] = useState<string | null>(null);
  const savedRef = useRef(initial);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [answerReady, setAnswerReady] = useState(false);
  const [score, setScore] = useState<{ perceptionScore: number; awardedPoints: number } | null>(null);
  const [teamColors, setTeamColors] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAnswer | null>(null);
  const pendingRef = useRef<PendingAnswer | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queue = useRef<AnswerWriteQueue | null>(null);
  const artwork = useRoomColorArtwork(roomSlug, question.media?.storagePath, question.mask?.storagePath, question.regionIds);
  const canEdit = !isHost && !!teamId && round.state === "active" && !withAnswer;
  const isLocked = pending?.locked ?? locked;
  const controlsDisabled = !answerReady || isLocked || pending?.locked !== undefined;
  const reveal = round.state === "closed" && (isHost || withAnswer);
  const showSubmissions = round.state === "closed" && !isHost;
  const teamKey = teams.map((team) => team.id).join("|");
  const otherTeams = teams.filter((team) => team.id !== teamId);
  const submissions = useColorSubmissions(roomSlug, round.id, question.id, otherTeams.map((team) => team.id), showSubmissions);

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
    return onSnapshot(answerRef, { includeMetadataChanges: true },
      (snap) => {
        const data = snap.data();
        savedRef.current = data?.answer ?? initial;
        setSaved(savedRef.current);
        lockedRef.current = data?.locked === true;
        setLocked(lockedRef.current);
        setAnswerReady(!snap.metadata.fromCache);
        if (lockedRef.current) { draftRef.current = null; setDraft(null); }
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
      synchronize: async () => {
        const snap = await getDocFromServer(answerRef);
        savedRef.current = snap.data()?.answer ?? initial;
        setSaved(savedRef.current);
        lockedRef.current = snap.data()?.locked === true;
        setLocked(lockedRef.current);
      },
      pending: (value) => { pendingRef.current = value; setPending(value); },
      error: (e) => setSaveError(e instanceof Error ? e.message : "Unable to save color."),
    });
    queue.current = writer;
    return () => {
      draftRef.current = null;
      pendingRef.current = null;
      writer.dispose();
      queue.current = null;
      setPending(null);
      setDraft(null);
    };
  }, [canEdit, teamId, roomSlug, round.id, question.id, getToken, initial]);

  function commit() {
    const color = draftRef.current;
    if (!color || !canEdit || !queue.current) return;
    draftRef.current = null;
    setDraft(null);
    if (lockedRef.current || pendingRef.current?.locked !== undefined || color === (pendingRef.current?.answer ?? savedRef.current)) return;
    setSaveError(null);
    queue.current.enqueue({ answer: color });
  }
  function cancel() {
    draftRef.current = null;
    setDraft(null);
  }
  function change(hex: string) {
    if (lockedRef.current || pendingRef.current?.locked !== undefined) return;
    draftRef.current = hex;
    setDraft(hex);
  }
  function toggleLock() {
    if (!canEdit || !answerReady || !queue.current || pendingRef.current?.locked !== undefined) return;
    setSaveError(null);
    if (!lockedRef.current) commit();
    cancel();
    queue.current.enqueue({ locked: !lockedRef.current });
  }
  if (error || artwork?.error || submissions?.error) return <p role="alert" className="p-4 text-red-300">{error ?? artwork?.error ?? submissions?.error}</p>;
  if (!artwork?.artwork) return <p className="p-4 text-zinc-100">Loading image...</p>;
  if (reveal && isHost) return target ? <div className="min-h-0 flex-1 p-4"><div className="relative h-full"><ColorImage artwork={artwork.artwork} color={target} label="Correct answer" className="block h-full w-full object-contain" /><ColorImageIndicator version="original" /></div></div> : <p className="p-4">Loading answer...</p>;
  if (isHost) return <div className="@container min-h-0 flex-1"><div className="grid h-full auto-rows-[minmax(0,1fr)] grid-cols-1 gap-4 p-4 @sm:grid-cols-2 @3xl:grid-cols-3">
    {teams.map((team) => <figure key={team.id} className="flex min-h-0 min-w-0 flex-col"><figcaption className="mb-2 shrink-0 break-words text-center text-sm font-semibold text-zinc-100">{team.name}</figcaption><div className="relative min-h-0 flex-1"><ColorImage className="block h-full w-full object-contain" artwork={artwork.artwork!} color={teamColors[team.id] ?? initial} label={`${team.name}'s answer`} /><ColorImageIndicator version="team" /></div></figure>)}
  </div></div>;
  const color = draft ?? pending?.answer ?? saved ?? initial;
  return <div className="@container min-h-0 flex-1"><div className={`grid h-full min-w-0 gap-4 p-4 ${canEdit || (reveal && teamId) ? "grid-rows-[minmax(0,1fr)_auto]" : "grid-rows-[minmax(0,1fr)]"}`}>
    {showSubmissions ? <ColorSubmissions artwork={artwork.artwork}
      ownSubmission={{ id: teamId ?? "", name: teams.find((team) => team.id === teamId)?.name ?? "Your team", color: saved ?? initial }}
      opponents={otherTeams.map((team) => ({ ...team, color: submissions?.colors?.[team.id] }))} targetColor={reveal ? target : null} /> : canEdit ? (
      <div className="relative flex min-h-0 items-center justify-center"><ColorImage artwork={artwork.artwork} color={color} className="block h-full w-full object-contain" />{teamId ? <ColorImageIndicator version="team" /> : null}</div>
    ) : <div className="relative min-h-0"><ColorImage artwork={artwork.artwork} color={color} className="block h-full w-full object-contain" />{teamId ? <ColorImageIndicator version="team" /> : null}</div>}
    {canEdit ? <div className="w-full max-w-[472px] justify-self-center">
      {saveError ? <p role="alert" className="mb-2 text-sm text-red-300">{saveError}</p> : null}
      <div className="flex min-w-0 items-center gap-3">
        <ColorControls color={color} disabled={controlsDisabled} onChange={change} onCommit={commit} onCancel={cancel} />
        <button type="button" aria-label={isLocked ? "Unlock answer" : "Lock answer"} title={isLocked ? "Unlock answer" : "Lock answer"} aria-pressed={isLocked}
          disabled={!answerReady || pending?.locked !== undefined} onClick={toggleLock}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded border text-white disabled:cursor-not-allowed disabled:opacity-50 ${isLocked ? "border-emerald-400 bg-emerald-600 hover:bg-emerald-500" : "border-zinc-600 bg-zinc-800 hover:bg-zinc-700"}`}>
          {isLocked ? <Lock size={18} /> : <LockOpen size={18} />}
        </button>
      </div>
    </div> : null}
    {reveal && teamId ? <div aria-label="Question score" className="flex flex-wrap justify-center gap-4 text-sm text-zinc-100">
      {score ? <><span>Similarity <strong>{score.perceptionScore.toFixed(2)} / 10</strong></span><span>Points <strong>{Number(score.awardedPoints.toFixed(2))}</strong></span></> : <span role="status">Scoring...</span>}
    </div> : null}
  </div></div>;
}
