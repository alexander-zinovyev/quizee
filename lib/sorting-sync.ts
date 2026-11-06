import { applySortingEdit, type SortingEdit, type SortingSnapshot } from "@/types/sorting";

export type PendingSortingChange = { edit: SortingEdit; editRevision: number | null };
export type SortingSyncState = {
  serverOrder: string[] | null;
  serverRevision: number | null;
  pendingChanges: PendingSortingChange[];
  error: string | null;
  errorKind: "transport" | "subscription" | "rejected" | "closed" | null;
  closed: boolean;
};
export type SortingSyncEvent =
  | { type: "snapshot"; snapshot: SortingSnapshot }
  | { type: "enqueue"; edit: SortingEdit }
  | { type: "acknowledge"; editId: string; revision: number }
  | { type: "reject"; editId: string; message: string }
  | { type: "error"; message: string; kind: "transport" | "subscription" }
  | { type: "retry" }
  | { type: "dismiss" }
  | { type: "close" };

export function initialSortingSyncState(): SortingSyncState {
  return { serverOrder: null, serverRevision: null, pendingChanges: [], error: null, errorKind: null, closed: false };
}

function outstanding(changes: PendingSortingChange[], revision: number | null) {
  return changes.filter((change) => change.editRevision === null || revision === null || change.editRevision > revision);
}

/** Snapshot adoption and covered-edit retirement are deliberately one transition. */
export function sortingSyncReducer(state: SortingSyncState, event: SortingSyncEvent): SortingSyncState {
  if (state.closed && event.type !== "close" && event.type !== "dismiss") return state;
  switch (event.type) {
    case "snapshot": {
      const { order, revision } = event.snapshot;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid sorting revision.");
      if (state.serverRevision !== null && revision < state.serverRevision) return state;
      if (revision === state.serverRevision && JSON.stringify(order) !== JSON.stringify(state.serverOrder)) throw new Error("Conflicting sorting orders share a revision.");
      return { ...state, serverOrder: [...order], serverRevision: revision,
        pendingChanges: outstanding(state.pendingChanges, revision) };
    }
    case "enqueue":
      if (!state.serverOrder) throw new Error("Load the team order before changing it.");
      if (state.pendingChanges.some((change) => change.edit.id === event.edit.id)) throw new Error("Duplicate pending sorting edit.");
      return { ...state, pendingChanges: [...state.pendingChanges, { edit: event.edit, editRevision: null }] };
    case "acknowledge":
      if (!Number.isSafeInteger(event.revision) || event.revision < 1) throw new Error("Invalid sorting edit acknowledgement.");
      return { ...state, pendingChanges: outstanding(state.pendingChanges.map((change) => change.edit.id === event.editId
        ? { ...change, editRevision: event.revision } : change), state.serverRevision) };
    case "reject":
      return { ...state, pendingChanges: state.pendingChanges.filter((change) => change.edit.id !== event.editId), error: event.message, errorKind: "rejected" };
    case "error":
      return { ...state, error: event.message, errorKind: event.kind };
    case "retry":
    case "dismiss":
      return { ...state, error: null, errorKind: null };
    case "close":
      return { ...state, closed: true, pendingChanges: [],
        ...(state.pendingChanges.length ? { error: "The round closed before all changes were confirmed.", errorKind: "closed" as const } : {}) };
  }
}

export function visibleSortingOrder(state: SortingSyncState): string[] | null {
  return state.serverOrder === null ? null : state.pendingChanges.reduce((order, change) => applySortingEdit(order, change.edit), [...state.serverOrder]);
}

export type SortingOrderView = {
  closed: boolean;
  order: string[] | null;
  revision: number | null;
  pendingCount: number;
  status: "loading" | "saving" | "saved" | "error";
  error: string | null;
};
export const emptySortingOrderView: SortingOrderView = { closed: false, order: null, revision: null, pendingCount: 0, status: "loading", error: null };

export class SortingEditRequestError extends Error {
  constructor(message: string, readonly definitive = false, readonly roundClosed = false) { super(message); }
}

type SortingAcknowledgement = { editId: string; revision: number };
export type SortingTiming = { phase: "request" | "firestore"; durationMs: number };
export type SortingOrderTransport = {
  watch: (snapshot: (value: SortingSnapshot) => void, error: (error: unknown) => void) => () => void;
  write: (edit: SortingEdit) => Promise<SortingAcknowledgement>;
  timing?: (timing: SortingTiming) => void;
  now?: () => number;
  active?: () => void;
  idle?: () => void;
};

/** A controller outlives a mounted tab while its edits await acknowledgement. */
export class SortingOrderController {
  private state = initialSortingSyncState();
  private view = emptySortingOrderView;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private watchingFailed = false;
  private running = false;
  private paused = false;
  private startedAt = new Map<string, number>();
  private latestSnapshotAt = 0;

  constructor(private readonly transport: SortingOrderTransport) {}

  getSnapshot = () => this.view;
  getState = () => this.state;
  getServerSnapshot = () => emptySortingOrderView;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.transport.active?.();
    this.watch();
    return () => { this.listeners.delete(listener); this.cleanup(); };
  };

  enqueue(edit: SortingEdit) {
    if (this.state.closed) return;
    const order = visibleSortingOrder(this.state);
    if (!order) throw new Error("Load the team order before changing it.");
    applySortingEdit(order, edit);
    this.dispatch({ type: "enqueue", edit });
    this.watch();
    void this.drain();
  }

  retry = () => {
    if (this.state.closed) { this.dispatch({ type: "dismiss" }); this.cleanup(); return; }
    this.paused = false;
    if (this.watchingFailed) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.watchingFailed = false;
    }
    this.dispatch({ type: "retry" });
    this.watch();
    void this.drain();
  };

  close = () => {
    this.paused = true;
    this.dispatch({ type: "close" });
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.startedAt.clear();
    this.cleanup();
  };

  private now() { return this.transport.now?.() ?? performance.now(); }

  private dispatch(event: SortingSyncEvent) {
    const previous = this.state;
    const state = sortingSyncReducer(previous, event);
    if (state === previous) return;
    if (event.type === "snapshot") this.latestSnapshotAt = this.now();
    this.state = state;
    this.view = { closed: state.closed, order: visibleSortingOrder(state), revision: state.serverRevision,
      pendingCount: state.pendingChanges.length, error: state.error,
      status: state.error ? "error" : state.serverOrder === null ? "loading" : state.pendingChanges.length ? "saving" : "saved" };
    for (const change of previous.pendingChanges) {
      if (state.pendingChanges.some((pending) => pending.edit.id === change.edit.id)) continue;
      const start = this.startedAt.get(change.edit.id);
      if (start !== undefined && (event.type === "snapshot" || event.type === "acknowledge")) {
        this.transport.timing?.({ phase: "firestore", durationMs: Math.max(0, this.latestSnapshotAt - start) });
      }
      this.startedAt.delete(change.edit.id);
    }
    this.listeners.forEach((listener) => listener());
  }

  private watch() {
    if (this.unsubscribe || this.state.closed || this.watchingFailed) return;
    this.unsubscribe = this.transport.watch((snapshot) => {
      if (this.state.closed) return;
      try { this.dispatch({ type: "snapshot", snapshot }); }
      catch (error) { this.subscriptionError(error); }
      this.cleanup();
    }, (error) => this.subscriptionError(error));
  }

  private subscriptionError(error: unknown) {
    if (this.state.closed) return;
    this.watchingFailed = true;
    this.paused = true;
    this.dispatch({ type: "error", kind: "subscription", message: error instanceof Error ? error.message : "Unable to load the team order." });
  }

  private cleanup() {
    if (this.listeners.size || this.state.pendingChanges.length) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!this.state.error) this.transport.idle?.();
  }

  private async drain() {
    if (this.running || this.paused || this.state.closed) return;
    this.running = true;
    try {
      while (!this.paused && !this.state.closed) {
        const change = this.state.pendingChanges.find((entry) => entry.editRevision === null);
        if (!change) break;
        const requestStarted = this.now();
        if (!this.startedAt.has(change.edit.id)) this.startedAt.set(change.edit.id, requestStarted);
        try {
          const acknowledgement = await this.transport.write(change.edit);
          this.transport.timing?.({ phase: "request", durationMs: this.now() - requestStarted });
          if (this.state.closed) break;
          if (!acknowledgement || typeof acknowledgement !== "object" || acknowledgement.editId !== change.edit.id || !Number.isSafeInteger(acknowledgement.revision) || acknowledgement.revision < 1) {
            throw new SortingEditRequestError("Invalid sorting edit acknowledgement.");
          }
          this.dispatch({ type: "acknowledge", ...acknowledgement });
        } catch (error) {
          if (this.state.closed) break;
          const message = error instanceof Error ? error.message : "Sorting changes were not saved.";
          if (error instanceof SortingEditRequestError && error.roundClosed) {
            this.close();
          } else if (error instanceof SortingEditRequestError && error.definitive) {
            this.dispatch({ type: "reject", editId: change.edit.id, message });
          } else {
            this.paused = true;
            this.dispatch({ type: "error", kind: "transport", message });
          }
        }
      }
    } finally {
      this.running = false;
      this.cleanup();
    }
  }
}
