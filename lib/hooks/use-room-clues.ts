"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import { parseClueContent, remainingCoins, type ClueMetadata, type CluesView, type VisibleClue } from "@/types/clues";

type Content = NonNullable<VisibleClue["content"]>;
type ClueData = { key: string; balance: number; balanceReady: boolean; contentReady: boolean; contents: Record<string, Content> };

/** Balances and unlocked copies are server-owned but readable by every teammate. */
export function useRoomClues({ roomId, roundId, questionId, teamId, isHost, startingCoins, metadata, revealedClueIds }: {
  roomId: string; roundId: string; questionId: string; teamId?: string | null; isHost: boolean; startingCoins: number;
  metadata: ClueMetadata[]; revealedClueIds: string[];
}): { view: CluesView | null; error: string | null; key: string } {
  const key = JSON.stringify([roomId, roundId, questionId, teamId ?? null, isHost]);
  const [data, setData] = useState<ClueData | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string; revealKey?: string } | null>(null);
  const [publicData, setPublicData] = useState<{ key: string; revealKey: string; contents: Record<string, Content> } | null>(null);
  const revealKey = JSON.stringify(revealedClueIds);

  useEffect(() => {
    const db = getClientFirestore();
    let active = true;
    let current: ClueData = { key, balance: startingCoins, balanceReady: isHost || !teamId, contentReady: !isHost && !teamId, contents: {} };
    const publish = () => { if (active) setData({ ...current }); };
    const fail = (error: Error) => { if (active) setFailure({ key, message: error.message }); };
    const safely = (work: () => void) => { try { work(); publish(); } catch (error) { fail(error instanceof Error ? error : new Error("Unable to read clues.")); } };
    const questionPath = ["rooms", roomId, "rounds", roundId, "questions", questionId];
    const unsubscribe: Unsubscribe[] = [];
    if (isHost) {
      unsubscribe.push(onSnapshot(collection(db, [...questionPath, "clues"].join("/")), (snapshot) => safely(() => {
        current = { ...current, contentReady: true, contents: Object.fromEntries(snapshot.docs.map((item) => [item.id, parseClueContent(item.data().content)])) };
      }), fail));
    } else if (teamId) {
      const ledgerPath = ["rooms", roomId, "cluePurchases", teamId, "rounds", roundId];
      unsubscribe.push(onSnapshot(doc(db, ledgerPath.join("/")), (snapshot) => safely(() => {
        current = { ...current, balanceReady: true, balance: remainingCoins(snapshot.exists() ? snapshot.data().remainingCoins : startingCoins, startingCoins) };
      }), fail));
      unsubscribe.push(onSnapshot(query(collection(db, [...ledgerPath, "openedClues"].join("/")), where("questionId", "==", questionId)), (snapshot) => safely(() => {
        current = { ...current, contentReady: true, contents: Object.fromEntries(snapshot.docs.map((item) => [item.data().clueId, parseClueContent(item.data().content)])) };
      }), fail));
    }
    publish();
    return () => { active = false; unsubscribe.forEach((stop) => stop()); };
  }, [key, roomId, roundId, questionId, teamId, isHost, startingCoins]);

  useEffect(() => {
    if (isHost) return;
    let active = true;
    const contents: Record<string, Content> = {};
    const ids: string[] = JSON.parse(revealKey);
    // Rules authorize individual documents against the current presentation, not a collection query.
    const stop = ids.map((id) => onSnapshot(doc(getClientFirestore(), "rooms", roomId, "rounds", roundId, "questions", questionId, "clues", id), (snapshot) => {
      if (!active) return;
      try {
        contents[id] = parseClueContent(snapshot.data()?.content);
        setPublicData({ key, revealKey, contents: { ...contents } });
      } catch (error) { setFailure({ key, revealKey, message: error instanceof Error ? error.message : "Unable to read revealed clue." }); }
    }, (error) => {
      if (active) {
        delete contents[id];
        setPublicData({ key, revealKey, contents: { ...contents } });
        setFailure({ key, revealKey, message: error.message });
      }
    }));
    return () => { active = false; stop.forEach((unsubscribe) => unsubscribe()); };
  }, [key, roomId, roundId, questionId, isHost, revealKey]);

  const ready = data?.key === key && data.balanceReady && data.contentReady;
  return { key, error: failure?.key === key && (failure.revealKey === undefined || failure.revealKey === revealKey) ? failure.message : null, view: ready ? {
    teamId: isHost ? null : teamId ?? null, remainingCoins: data.balance,
    clues: metadata.map((clue) => {
      const purchased = !isHost && !!data.contents[clue.id];
      const content = data.contents[clue.id] ?? (revealedClueIds.includes(clue.id) && publicData?.key === key && publicData.revealKey === revealKey ? publicData.contents[clue.id] : undefined);
      return { ...clue, purchased, ...(content ? { content } : {}) };
    }),
  } : null };
}
