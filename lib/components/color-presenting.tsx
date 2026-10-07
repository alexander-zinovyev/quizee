"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { getDownloadURL, getStorage, ref } from "firebase/storage";
import { useFirebaseAuth } from "@/app/providers/firebase-auth-provider";
import { getClientFirestore, getFirebaseClientApp } from "@/lib/firebase/client";
import { AnswerWriteQueue } from "@/lib/answer-write-queue";
import type { RoundMeta, RoundQuestion } from "@/lib/hooks/use-room-rounds";
import { ColorImage, useColorArtwork } from "./color-image";
import { ColorControls } from "./color-controls";

export function ColorPresenting({ roomSlug, round, question, teamId, isHost, teams, withAnswer }: {
  roomSlug: string; round: RoundMeta; question: RoundQuestion; teamId?: string | null; isHost: boolean;
  teams: Array<{ id: string; name: string }>; withAnswer: boolean;
}) {
  const { getToken } = useFirebaseAuth();
  const [urls, setUrls] = useState<{ image: string; mask: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [teamColors, setTeamColors] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<AnswerWriteQueue | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<string | null>(null);
  const artwork = useColorArtwork(urls?.image ?? null, urls?.mask ?? null);
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
    let cancelled = false;
    if (!question.media?.storagePath || !question.mask?.storagePath) return;
    const storage = getStorage(getFirebaseClientApp());
    Promise.all([question.media.storagePath, question.mask.storagePath].map((path) => getDownloadURL(ref(storage, path))))
      .then(([image, mask]) => { if (!cancelled) setUrls({ image, mask }); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [question.media?.storagePath, question.mask?.storagePath]);

  useEffect(() => {
    if (!teamId || isHost) return;
    return onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", round.id, "answers", question.id),
      (snap) => setSaved(snap.data()?.answer ?? initial), (e) => setError(e.message));
  }, [teamId, isHost, roomSlug, round.id, question.id, initial]);

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
  if (!artwork?.artwork) return <p className="p-4">Loading image...</p>;
  if (reveal) return target ? <div className="p-4"><ColorImage artwork={artwork.artwork} color={target} label="Correct answer" /></div> : <p className="p-4">Loading answer...</p>;
  if (isHost) return <div className="grid grid-cols-1 gap-4 overflow-auto p-4 sm:grid-cols-2 xl:grid-cols-3">
    {teams.map((team) => <figure key={team.id} className="min-w-0"><figcaption className="mb-2 break-words text-center text-sm font-semibold">{team.name}</figcaption><ColorImage artwork={artwork.artwork!} color={teamColors[team.id] ?? initial} label={`${team.name}'s answer`} /></figure>)}
  </div>;
  const color = pending ?? saved ?? initial;
  return <div className="grid min-w-0 gap-4 overflow-auto p-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,260px)]">
    <ColorImage artwork={artwork.artwork} color={color} />
    {!isHost ? <ColorControls color={color} disabled={!canEdit} onChange={change} onCommit={flush} /> : null}
  </div>;
}
