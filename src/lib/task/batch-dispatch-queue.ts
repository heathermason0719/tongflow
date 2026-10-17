/** Keep the six-way execution of the old HTTP/1 batch path while observing
 * every result over one stream. Reconnects reuse the same queued dispatch. */
export class BatchDispatchQueue {
    private waiting: { id: string; run: () => Promise<void> }[] = [];
    private known = new Set<string>();
    private active = 0;
    constructor(private concurrency = 6) {}

    enqueue(id: string, run: () => Promise<void>) {
        if (this.known.has(id)) return;
        this.known.add(id);
        this.waiting.push({ id, run });
        this.pump();
    }

    private pump() {
        while (this.active < this.concurrency && this.waiting.length) {
            const job = this.waiting.shift();
            if (!job) return;
            this.active++;
            Promise.resolve()
                .then(job.run)
                .catch(() => {
                    // Dispatcher owns durable failure state and error events.
                })
                .finally(() => {
                    this.known.delete(job.id);
                    this.active--;
                    this.pump();
                });
        }
    }
}

const key = Symbol.for("tongflow.batch.dispatch.queue");
const state = globalThis as typeof globalThis & { [key]?: BatchDispatchQueue };
export const batchDispatchQueue = state[key] ?? new BatchDispatchQueue();
state[key] = batchDispatchQueue;
