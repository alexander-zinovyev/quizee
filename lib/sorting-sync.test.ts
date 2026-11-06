import assert from "node:assert/strict";
import { applySortingEdit, type SortingEdit, type SortingSnapshot } from "@/types/sorting";
import { initialSortingSyncState, SortingEditRequestError, SortingOrderController, sortingSyncReducer, visibleSortingOrder, type SortingSyncState } from "./sorting-sync";

function edit(id: string, itemId: string, anchorId: string, placement: "before" | "after" = "after"): SortingEdit {
  return { id, itemId, anchorId, placement };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function loaded(order = ["a", "b", "c", "d"], revision = 0): SortingSyncState {
  return sortingSyncReducer(initialSortingSyncState(), { type: "snapshot", snapshot: { order, revision } });
}
function fixture() {
  const requests: Array<{ edit: SortingEdit; result: ReturnType<typeof deferred<{ editId: string; revision: number }>> }> = [];
  const requestWaiters: Array<{ count: number; done: () => void }> = [];
  let receive: ((value: SortingSnapshot) => void) | undefined;
  let subscriptionError: ((error: unknown) => void) | undefined;
  let subscriptions = 0, stops = 0, idles = 0, clock = 0;
  const timings: Array<{ phase: "request" | "firestore"; durationMs: number }> = [];
  const controller = new SortingOrderController({
    watch: (snapshot, error) => {
      receive = snapshot;
      subscriptionError = error;
      subscriptions++;
      return () => { receive = undefined; subscriptionError = undefined; stops++; };
    },
    write: (change) => {
      const result = deferred<{ editId: string; revision: number }>();
      requests.push({ edit: change, result });
      requestWaiters.filter((waiter) => requests.length >= waiter.count).forEach((waiter) => waiter.done());
      return result.promise;
    },
    idle: () => { idles++; },
    now: () => clock,
    timing: (value) => timings.push(value),
  });
  const unsubscribe = controller.subscribe(() => {});
  const snapshot = (value: SortingSnapshot) => { assert.ok(receive); receive(value); };
  snapshot({ order: ["a", "b", "c", "d"], revision: 0 });
  return { controller, requests, unsubscribe, snapshot, timings,
    setClock: (value: number) => { clock = value; },
    failWatch: (error: unknown) => { assert.ok(subscriptionError); subscriptionError(error); },
    counts: () => ({ subscriptions, stops, idles }),
    waitRequests: (count: number) => requests.length >= count ? Promise.resolve() : new Promise<void>((done) => { requestWaiters.push({ count, done }); }),
  };
}

async function main() {
  const first = edit("first", "a", "b"), second = edit("second", "b", "c");
  {
    // Adopting the base and retiring both covered edits in separate renders would
    // briefly display C B A D, because replaying this edit sequence is not idempotent.
    let state = loaded();
    for (const change of [first, second]) state = sortingSyncReducer(state, { type: "enqueue", edit: change });
    state = sortingSyncReducer(state, { type: "acknowledge", editId: first.id, revision: 1 });
    state = sortingSyncReducer(state, { type: "acknowledge", editId: second.id, revision: 2 });
    const committed = applySortingEdit(applySortingEdit(["a", "b", "c", "d"], first), second);
    state = sortingSyncReducer(state, { type: "snapshot", snapshot: { order: committed, revision: 2 } });
    assert.deepEqual(visibleSortingOrder(state), ["a", "c", "b", "d"]);
    assert.deepEqual(state.pendingChanges, []);
    assert.equal(state.serverRevision, 2);
  }
  {
    let state = sortingSyncReducer(loaded(), { type: "enqueue", edit: first });
    state = sortingSyncReducer(state, { type: "snapshot", snapshot: { order: ["b", "a", "c", "d"], revision: 1 } });
    assert.equal(state.pendingChanges[0].editRevision, null);
    state = sortingSyncReducer(state, { type: "acknowledge", editId: first.id, revision: 1 });
    assert.deepEqual(state.pendingChanges, []);
    assert.deepEqual(visibleSortingOrder(state), ["b", "a", "c", "d"]);
    assert.equal(sortingSyncReducer(state, { type: "snapshot", snapshot: { order: ["a", "b", "c", "d"], revision: 0 } }), state);
    assert.throws(() => sortingSyncReducer(state, { type: "snapshot", snapshot: { order: ["a", "b", "c", "d"], revision: 1 } }), /Conflicting/);
  }
  {
    const f = fixture();
    const renders: Array<{ revision: number | null; order: string[] | null; pending: number }> = [];
    const stop = f.controller.subscribe(() => {
      const view = f.controller.getSnapshot();
      renders.push({ revision: view.revision, order: view.order, pending: view.pendingCount });
    });
    f.setClock(10);
    f.controller.enqueue(first);
    f.controller.enqueue(second);
    assert.deepEqual(f.controller.getSnapshot().order, ["a", "c", "b", "d"]);
    assert.equal(f.requests.length, 1, "Later moves stay interactive but must wait for the preceding request");
    f.setClock(20);
    f.requests[0].result.resolve({ editId: first.id, revision: 1 });
    await f.waitRequests(2);
    assert.deepEqual(f.requests.map((request) => request.edit.id), ["first", "second"]);
    const secondCommitted = deferred<void>();
    const watchDone = f.controller.subscribe(() => {
      if (f.controller.getState().pendingChanges[1]?.editRevision === 2) secondCommitted.resolve();
    });
    f.setClock(30);
    f.requests[1].result.resolve({ editId: second.id, revision: 2 });
    await secondCommitted.promise;
    const before = renders.length;
    f.setClock(40);
    f.snapshot({ order: ["a", "c", "b", "d"], revision: 2 });
    assert.equal(renders.length, before + 1, "Snapshot adoption and pending retirement publish exactly one state");
    assert.deepEqual(renders.at(-1), { revision: 2, order: ["a", "c", "b", "d"], pending: 0 });
    assert.equal(f.controller.getSnapshot().status, "saved");
    assert.deepEqual(f.timings, [
      { phase: "request", durationMs: 10 }, { phase: "request", durationMs: 10 },
      { phase: "firestore", durationMs: 30 }, { phase: "firestore", durationMs: 20 },
    ]);
    watchDone(); stop(); f.unsubscribe();
    assert.equal(f.counts().stops, 1);
  }
  {
    const f = fixture();
    f.controller.enqueue(first);
    f.unsubscribe();
    assert.equal(f.counts().stops, 0, "Unmounting a tab must keep its pending request and listener alive");
    f.setClock(15);
    f.snapshot({ order: ["b", "a", "c", "d"], revision: 1 });
    assert.equal(f.controller.getSnapshot().pendingCount, 1);
    const settled = deferred<void>();
    const stop = f.controller.subscribe(() => { if (!f.controller.getSnapshot().pendingCount) settled.resolve(); });
    f.requests[0].result.resolve({ editId: first.id, revision: 1 });
    await settled.promise;
    assert.deepEqual(f.controller.getSnapshot().order, ["b", "a", "c", "d"]);
    stop();
    assert.equal(f.counts().stops, 1);
    const resubscribe = f.controller.subscribe(() => {});
    assert.equal(f.counts().subscriptions, 2, "An idle controller can be mounted again");
    resubscribe();
  }
  {
    const f = fixture();
    const errored = deferred<void>();
    const stop = f.controller.subscribe(() => { if (f.controller.getSnapshot().error) errored.resolve(); });
    f.controller.enqueue(first);
    f.controller.enqueue(second);
    f.requests[0].result.reject(new Error("Connection interrupted"));
    await errored.promise;
    assert.equal(f.controller.getSnapshot().pendingCount, 2);
    assert.deepEqual(f.controller.getSnapshot().order, ["a", "c", "b", "d"]);
    assert.equal(f.requests.length, 1, "An ambiguous failure must not send later edits out of order");
    f.controller.retry();
    await f.waitRequests(2);
    assert.equal(f.requests[1].edit.id, first.id, "Explicit resubmission must reuse the original edit identity");
    f.snapshot({ order: ["b", "a", "c", "d"], revision: 1 });
    f.requests[1].result.resolve({ editId: first.id, revision: 1 });
    await f.waitRequests(3);
    assert.equal(f.requests[2].edit.id, second.id);
    f.controller.close();
    f.requests[2].result.resolve({ editId: second.id, revision: 2 });
    stop(); f.unsubscribe();
  }
  {
    const f = fixture();
    f.controller.enqueue(first);
    f.controller.enqueue(second);
    f.requests[0].result.reject(new SortingEditRequestError("Move refused", true));
    await f.waitRequests(2);
    assert.equal(f.controller.getSnapshot().error, "Move refused");
    assert.deepEqual(f.controller.getSnapshot().order, ["a", "c", "b", "d"]);
    assert.deepEqual(f.controller.getState().pendingChanges.map((change) => change.edit.id), [second.id]);
    const closed = deferred<void>();
    const stop = f.controller.subscribe(() => { if (f.controller.getState().closed) closed.resolve(); });
    f.requests[1].result.reject(new SortingEditRequestError("Round closed", true, true));
    await closed.promise;
    assert.equal(f.controller.getSnapshot().pendingCount, 0);
    f.controller.enqueue(edit("late", "a", "d"));
    f.controller.retry();
    assert.equal(f.requests.length, 2);
    stop(); f.unsubscribe();
  }
  {
    const f = fixture();
    f.failWatch(new Error("Subscription failed"));
    assert.equal(f.controller.getSnapshot().status, "error");
    f.controller.enqueue(first);
    assert.equal(f.requests.length, 0);
    f.controller.retry();
    await f.waitRequests(1);
    assert.equal(f.counts().subscriptions, 2);
    f.controller.close();
    f.requests[0].result.resolve({ editId: first.id, revision: 1 });
    f.unsubscribe();
  }
  {
    const f = fixture();
    f.controller.enqueue(first);
    f.unsubscribe();
    f.requests[0].result.reject(new SortingEditRequestError("Rejected while away", true));
    await Promise.allSettled([f.requests[0].result.promise]);
    assert.equal(f.controller.getSnapshot().error, "Rejected while away");
    assert.equal(f.counts().idles, 0, "An unmounted tab must retain an undismissed rejection");
    const stop = f.controller.subscribe(() => {});
    assert.equal(f.controller.getSnapshot().error, "Rejected while away");
    f.controller.retry();
    stop();
    assert.equal(f.counts().idles, 1);
  }
  {
    const f = fixture();
    f.controller.enqueue(first);
    f.controller.close();
    assert.equal(f.controller.getSnapshot().closed, true);
    assert.match(f.controller.getSnapshot().error!, /round closed/);
    f.controller.retry();
    assert.equal(f.controller.getSnapshot().error, null);
    assert.equal(f.controller.getSnapshot().closed, true);
    f.requests[0].result.resolve({ editId: first.id, revision: 1 });
    f.unsubscribe();
  }
  console.log("Sorting synchronization verified: atomic reconciliation, ordered optimistic edits, persistent pending tabs, rejection/close handling and explicit idempotent resubmission.");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
