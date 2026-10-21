import assert from "node:assert/strict";
import { AnswerWriteQueue } from "./answer-write-queue";
import type { AnswerMutation } from "./answers";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  {
    const first = deferred();
    const done = deferred();
    const writes: AnswerMutation[] = [];
    const queue = new AnswerWriteQueue({
      write: async (mutation) => { writes.push(mutation); if (writes.length === 1) await first.promise; },
      synchronize: async () => {},
      pending: (value) => { if (value === null) done.resolve(); },
      error: (error) => { throw error; },
    });
    queue.enqueue({ answer: "A" });
    queue.enqueue({ wagered: true });
    queue.enqueue({ locked: true });
    queue.enqueue({ wagered: false });
    queue.enqueue({ wagered: true });
    first.resolve();
    await done.promise;
    assert.deepEqual(writes, [{ answer: "A" }, { wagered: true }, { locked: true }, { wagered: false }, { wagered: true }]);
  }
  {
    const first = deferred();
    const done = deferred();
    const writes: AnswerMutation[] = [];
    const queue = new AnswerWriteQueue({
      write: async (mutation) => { writes.push(mutation); if (writes.length === 1) await first.promise; },
      synchronize: async () => {},
      pending: (value) => { if (value === null) done.resolve(); },
      error: (error) => { throw error; },
    });
    queue.enqueue({ answer: "A" }, 0);
    queue.enqueue({ answer: "AB" }, 0);
    queue.enqueue({ answer: "ABC" }, 0);
    queue.enqueue({ locked: true }, 0);
    first.resolve();
    await done.promise;
    assert.deepEqual(writes, [{ answer: "A" }, { answer: "ABC" }, { locked: true }]);
  }
  {
    const first = deferred();
    const done = deferred();
    const steps: Array<number | undefined> = [];
    const errors: unknown[] = [];
    const queue = new AnswerWriteQueue({
      write: async (_mutation, step) => {
        steps.push(step);
        if (steps.length === 1) { await first.promise; throw new Error("Step closed"); }
      },
      synchronize: async () => {},
      pending: (value) => { if (value === null) done.resolve(); },
      error: (error) => errors.push(error),
    });
    queue.enqueue({ answer: "Old" }, 0);
    queue.enqueue({ answer: "Stale old" }, 0);
    queue.enqueue({ answer: "New" }, 1);
    queue.enqueue({ answer: "Newest" }, 1);
    first.resolve();
    await done.promise;
    assert.deepEqual(steps, [0, 1]);
    assert.equal(errors.length, 1);
  }
  {
    const refreshing = deferred();
    const started = deferred();
    const done = deferred();
    const writes: AnswerMutation[] = [];
    let refreshes = 0;
    const queue = new AnswerWriteQueue({
      write: async (mutation) => { writes.push(mutation); },
      synchronize: async () => { refreshes++; if (refreshes === 1) { started.resolve(); await refreshing.promise; } },
      pending: (value) => { if (value === null) done.resolve(); },
      error: (error) => { throw error; },
    });
    queue.enqueue({ answer: "First" });
    await started.promise;
    queue.enqueue({ answer: "During refresh" });
    refreshing.resolve();
    await done.promise;
    assert.deepEqual(writes, [{ answer: "First" }, { answer: "During refresh" }]);
    assert.equal(refreshes, 2);
  }
  {
    const started = deferred();
    const first = deferred();
    const writes: AnswerMutation[] = [];
    const queue = new AnswerWriteQueue({
      write: async (mutation) => { writes.push(mutation); started.resolve(); await first.promise; },
      synchronize: async () => { throw new Error("Disposed queue must not refresh"); },
      pending: () => {}, error: (error) => { throw error; },
    });
    queue.enqueue({ answer: "First" });
    queue.enqueue({ answer: "Should not save" });
    await started.promise;
    queue.dispose();
    first.resolve();
    await first.promise;
    assert.deepEqual(writes, [{ answer: "First" }]);
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
