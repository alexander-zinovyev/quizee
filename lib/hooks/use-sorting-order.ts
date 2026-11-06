"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { getClientFirestore } from "@/lib/firebase/client";
import { parseSortingSnapshot, type SortingEdit } from "@/types/sorting";
import { emptySortingOrderView, SortingEditRequestError, SortingOrderController } from "@/lib/sorting-sync";

const controllers = new Map<string, SortingOrderController>();
const subscribeToNothing = () => () => {};
const emptySnapshot = () => emptySortingOrderView;

function measure(name: string, start: number, end: number, detail?: unknown) {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  performance.clearMeasures(name);
  performance.measure(name, { start, end, detail });
}

type SortingControllerOptions = {
  key: string; roomSlug: string; teamId: string; roundId: string; questionId: string; idsKey: string;
  getToken: () => Promise<string>;
};

function getSortingController({ key, roomSlug, teamId, roundId, questionId, idsKey, getToken }: SortingControllerOptions) {
  const existing = controllers.get(key);
  if (existing) return existing;
  const itemIds: string[] = JSON.parse(idsKey);
  const next = new SortingOrderController({
    watch: (snapshot, error) => onSnapshot(doc(getClientFirestore(), "rooms", roomSlug, "teams", teamId, "rounds", roundId, "answers", questionId), { includeMetadataChanges: true }, (value) => {
      if (value.metadata.fromCache && !value.exists()) return;
      try { snapshot(parseSortingSnapshot(value.data(), itemIds)); }
      catch { error(new Error("Invalid saved sorting order.")); }
    }, error),
    write: async (edit) => {
      const start = performance.now();
      const token = await getToken();
      const response = await fetch(`/api/rooms/${roomSlug}/rounds/${roundId}/answers/${questionId}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teamId, edit }),
      });
      measure("sorting-edit.request", start, performance.now(), { serverTiming: response.headers.get("Server-Timing") });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new SortingEditRequestError(payload?.message ?? "Sorting changes were not saved.", response.status >= 400 && response.status < 500, payload?.code === "round-closed");
      }
      return payload;
    },
    timing: ({ phase, durationMs }) => {
      if (phase === "firestore") {
        const end = performance.now();
        measure("sorting-edit.firestore", end - durationMs, end);
      }
    },
    active: () => { controllers.set(key, next); },
    idle: () => { if (controllers.get(key) === next) controllers.delete(key); },
  });
  controllers.set(key, next);
  return next;
}

export function useSortingOrder({ roomSlug, teamId, roundId, questionId, itemIds, uid, getToken, enabled, closed = false }: {
  roomSlug?: string; teamId?: string; roundId: string; questionId: string; itemIds: readonly string[];
  uid?: string; getToken: () => Promise<string>; enabled: boolean; closed?: boolean;
}) {
  const key = roomSlug && teamId && uid ? JSON.stringify([roomSlug, teamId, roundId, questionId, uid]) : null;
  const idsKey = JSON.stringify([...itemIds].sort());
  const controller = useMemo(() => !key || !roomSlug || !teamId ? null : closed ? controllers.get(key) ?? null : !enabled ? null
    : getSortingController({ key, roomSlug, teamId, roundId, questionId, idsKey, getToken }),
  [key, idsKey, enabled, closed, roomSlug, teamId, roundId, questionId, getToken]);

  useEffect(() => {
    if (closed) controller?.close();
  }, [closed, controller]);

  const view = useSyncExternalStore(controller?.subscribe ?? subscribeToNothing, controller?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return { ...view,
    move: (edit: Omit<SortingEdit, "id">) => { if (enabled && !closed) controller?.enqueue({ ...edit, id: crypto.randomUUID() }); },
    retry: () => controller?.retry(),
  };
}
