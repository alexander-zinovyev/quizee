import type { AnswerMutation } from "./answers";

export type PendingAnswer = { answer?: string; locked?: boolean };
type Job = { mutation: AnswerMutation; expectedStep?: number };

export class AnswerWriteQueue {
  private jobs: Job[] = [];
  private pending: PendingAnswer = {};
  private running = false;
  private disposed = false;

  constructor(private readonly callbacks: {
    write: (mutation: AnswerMutation, expectedStep?: number) => Promise<void>;
    synchronize: () => Promise<void>;
    pending: (value: PendingAnswer | null) => void;
    error: (error: unknown) => void;
  }) {}

  enqueue(mutation: AnswerMutation, expectedStep?: number) {
    if (this.disposed) return;
    this.pending = { ...this.pending, ...mutation };
    this.callbacks.pending(this.pending);
    const last = this.jobs[this.jobs.length - 1];
    // Coalesce typing within a window, while preserving lock commands and step boundaries.
    if (last && "answer" in last.mutation && "answer" in mutation && last.expectedStep === expectedStep) {
      last.mutation = mutation;
    } else {
      this.jobs.push({ mutation, expectedStep });
    }
    void this.drain();
  }

  dispose() {
    this.disposed = true;
    this.jobs = [];
  }

  private async drain() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed) {
        while (this.jobs.length && !this.disposed) {
          const job = this.jobs.shift()!;
          try {
            await this.callbacks.write(job.mutation, job.expectedStep);
          } catch (error) {
            if (!this.disposed) this.callbacks.error(error);
            this.jobs = this.jobs.filter((queued) => queued.expectedStep !== job.expectedStep);
          }
        }
        if (this.disposed) break;
        // Refresh Firestore's version-aware cache before releasing optimistic input values.
        await this.callbacks.synchronize();
        if (!this.jobs.length) {
          this.pending = {};
          if (!this.disposed) this.callbacks.pending(null);
          break;
        }
      }
    } catch (error) {
      if (!this.disposed) {
        this.callbacks.error(error);
        this.pending = {};
        this.callbacks.pending(null);
      }
    } finally {
      this.running = false;
      if (this.jobs.length && !this.disposed) void this.drain();
    }
  }
}
