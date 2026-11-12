"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where, type Unsubscribe } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import { cluePrice, parseClueContent, parsePurchasedClueCounts, remainingCoins, type ClueMetadata, type CluePricing, type CluesView, type VisibleClue } from "@/types/clues";

type Content = NonNullable<VisibleClue["content"]>;
type ClueData = { key: string; balance: number; purchasedCount: number; balanceReady: boolean; contentReady: boolean; contents: Record<string, Content> };

/** Balances and unlocked copies are server-owned but readable by every teammate. */
export function useRoomClues({ roomId, roundId, questionId, teamId, isHost, startingCoins, pricing = { mode: "manual" }, metadata, revealedClueIds }: {
  roomId: string; roundId: string; questionId: string; teamId?: string | null; isHost: boolean; startingCoins: number;
  metadata: ClueMetadata[]; revealedClueIds: string[];
  pricing?: CluePricing;
}): { view: CluesView | null; error: string | null; key: string } {
  const key = JSON.stringify([roomId, roundId, questionId, teamId ?? null, isHost]);
  const [data, setData] = useState<ClueData | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [publicData, setPublicData] = useState<{ key: string; revealKey: string; contents: Record<string, Content>; errors: Record<string, string> } | null>(null);
  const revealKey = JSON.stringify(revealedClueIds);

  useEffect(() => {
    const db = getClientFirestore();
    let active = true;
    let current: ClueData = { key, balance: startingCoins, purchasedCount: 0, balanceReady: isHost || !teamId, contentReady: !isHost && !teamId, contents: {} };
    const publish = () => {
      if (!active) return;
      // A purchase commits balance/count and unlocked content together, but their
      // listeners can arrive in either order. Retain the last complete view until both arrive.
      if (!isHost && teamId && pricing.mode !== "manual" && current.balanceReady && current.contentReady &&
          Object.keys(current.contents).length !== current.purchasedCount) return;
      setData({ ...current });
    };
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
        const counts = parsePurchasedClueCounts(snapshot.data()?.purchasedCounts);
        current = { ...current, balanceReady: true, balance: remainingCoins(snapshot.exists() ? snapshot.data().remainingCoins : startingCoins, startingCoins),
          purchasedCount: Object.hasOwn(counts, questionId) ? counts[questionId] : 0 };
      }), fail));
      unsubscribe.push(onSnapshot(query(collection(db, [...ledgerPath, "openedClues"].join("/")), where("questionId", "==", questionId)), (snapshot) => safely(() => {
        current = { ...current, contentReady: true, contents: Object.fromEntries(snapshot.docs.map((item) => [item.data().clueId, parseClueContent(item.data().content)])) };
      }), fail));
    }
    publish();
    return () => { active = false; unsubscribe.forEach((stop) => stop()); };
  }, [key, roomId, roundId, questionId, teamId, isHost, startingCoins, pricing.mode]);

  useEffect(() => {
    if (isHost) return;
    let active = true;
    const contents: Record<string, Content> = {};
    const errors: Record<string, string> = {};
    const ids: string[] = JSON.parse(revealKey);
    const publish = () => setPublicData({ key, revealKey, contents: { ...contents }, errors: { ...errors } });
    // Each listener attempt owns its errors, so a new successful subscription clears old failures.
    // Read only the clues the host currently shows, even though all closed-round clues are readable.
    const stop = ids.map((id) => onSnapshot(doc(getClientFirestore(), "rooms", roomId, "rounds", roundId, "questions", questionId, "clues", id), (snapshot) => {
      if (!active) return;
      try {
        contents[id] = parseClueContent(snapshot.data()?.content);
        delete errors[id];
      } catch (error) {
        delete contents[id];
        errors[id] = error instanceof Error ? error.message : "Unable to read revealed clue.";
      }
      publish();
    }, (error) => {
      if (active) {
        delete contents[id];
        errors[id] = error.message;
        publish();
      }
    }));
    return () => { active = false; stop.forEach((unsubscribe) => unsubscribe()); };
  }, [key, roomId, roundId, questionId, isHost, revealKey]);

  const ready = data?.key === key && data.balanceReady && data.contentReady;
  const publicError = publicData?.key === key && publicData.revealKey === revealKey ? Object.values(publicData.errors)[0] ?? null : null;
  return { key, error: failure?.key === key ? failure.message : publicError, view: ready ? {
    teamId: isHost ? null : teamId ?? null, remainingCoins: data.balance,
    clues: metadata.map((clue) => {
      const storedContent = Object.hasOwn(data.contents, clue.id) ? data.contents[clue.id] : undefined;
      const purchased = !isHost && storedContent !== undefined;
      const content = storedContent ?? (revealedClueIds.includes(clue.id) && publicData?.key === key && publicData.revealKey === revealKey && Object.hasOwn(publicData.contents, clue.id) ? publicData.contents[clue.id] : undefined);
      // Progressive prices describe unopened clues. An opened clue stays free to access.
      const price = purchased && pricing.mode !== "manual" ? 0 : cluePrice(pricing, clue, data.purchasedCount);
      return { ...clue, price, purchased, ...(content ? { content } : {}) };
    }),
  } : null };
}
