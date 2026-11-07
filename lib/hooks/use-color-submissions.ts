import { useEffect, useState } from "react";
import { doc, getDocFromServer } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import { HEX_COLOR } from "@/types/color";

export function useColorSubmissions(roomSlug: string, roundId: string, questionId: string, teamIds: string[], enabled: boolean) {
  const teamKey = JSON.stringify(teamIds);
  const key = JSON.stringify([roomSlug, roundId, questionId, teamKey]);
  const [state, setState] = useState<{ key: string; colors?: Record<string, string | null>; error?: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ids: string[] = JSON.parse(teamKey);
    const db = getClientFirestore();
    Promise.all(ids.map(async (id) => {
      const snapshot = await getDocFromServer(doc(db, "rooms", roomSlug, "rounds", roundId, "teamAnswers", id, "answers", questionId));
      if (!snapshot.exists()) return [id, null] as const;
      const color: unknown = snapshot.data().answer;
      if (typeof color !== "string" || !HEX_COLOR.test(color)) throw new Error(`Invalid final color submission for team ${id}.`);
      return [id, color] as const;
    })).then((entries) => {
      if (!cancelled) setState({ key, colors: Object.fromEntries(entries) });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ key, error: error instanceof Error ? error.message : "Unable to load team submissions." });
    });
    return () => { cancelled = true; };
  }, [enabled, roomSlug, roundId, questionId, teamKey, key]);

  return enabled && state?.key === key ? state : null;
}
