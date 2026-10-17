import { dispatchTask } from "@ext/task-dispatch";
import { inArray } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { isTerminalStatus } from "tongflow";
import { getDb, tasks } from "@/db";
import { jsonStringifyForSse } from "@/lib/json-sse";
import { getScope, runWithScope } from "@/lib/runtime/scope.server";
import { batchDispatchQueue } from "@/lib/task/batch-dispatch-queue";
import { onTaskEvent, type TaskEvent } from "@/lib/task/emitter";
import { taskRecordEvent } from "@/lib/task/task-record-event";

/** One connection per batch; task events and durable snapshots share a stream. */
export async function GET(request: NextRequest) {
    const ids = [
        ...new Set(
            request.nextUrl.searchParams
                .get("ids")
                ?.split(",")
                .filter(Boolean) ?? [],
        ),
    ];
    if (!ids.length)
        return new Response("Task ids are required", { status: 400 });
    const scope = await getScope();
    const db = await getDb();
    const read = () => db.select().from(tasks).where(inArray(tasks.id, ids));
    const initial = await read();
    if (initial.length !== ids.length)
        return new Response("Task not found", { status: 404 });
    const encoder = new TextEncoder();
    const frame = (event: TaskEvent) =>
        encoder.encode(`data: ${jsonStringifyForSse(event)}\n\n`);
    const allTerminal = initial.every((row) =>
        ["completed", "failed", "cancelled"].includes(row.status),
    );
    if (allTerminal) {
        return new Response(
            initial
                .map(
                    (row) =>
                        `data: ${jsonStringifyForSse(taskRecordEvent(row))}\n\n`,
                )
                .join(""),
            { headers: headers() },
        );
    }
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            let closed = false;
            let polling = false;
            const terminal = new Set<string>();
            const unsubscribes: (() => void)[] = [];
            let poll: ReturnType<typeof setInterval> | undefined;
            let heartbeat: ReturnType<typeof setInterval> | undefined;
            const close = () => {
                if (closed) return;
                closed = true;
                if (poll) clearInterval(poll);
                if (heartbeat) clearInterval(heartbeat);
                unsubscribes.forEach((unsubscribe) => unsubscribe());
                request.signal.removeEventListener("abort", close);
                try {
                    controller.close();
                } catch {
                    /* Already cancelled by the reader. */
                }
            };
            cleanup = close;
            const emit = (event: TaskEvent) => {
                if (closed || terminal.has(event.id)) return;
                if (isTerminalStatus(event.status)) terminal.add(event.id);
                try {
                    controller.enqueue(frame(event));
                } catch {
                    close();
                    return;
                }
                if (terminal.size === ids.length) close();
            };
            for (const id of ids) unsubscribes.push(onTaskEvent(id, emit));
            for (const row of initial) emit(taskRecordEvent(row));
            poll = setInterval(async () => {
                if (closed || polling) return;
                polling = true;
                try {
                    for (const row of await read()) emit(taskRecordEvent(row));
                } catch {
                    /* The stream remains connected; next snapshot retries. */
                } finally {
                    polling = false;
                }
            }, 2000);
            heartbeat = setInterval(() => {
                if (!closed) {
                    try {
                        controller.enqueue(encoder.encode(": ping\n\n"));
                    } catch {
                        close();
                    }
                }
            }, 10000);
            request.signal.addEventListener("abort", close, { once: true });
            // A disconnect only stops observation. Execution remains owned by
            // the dispatcher; completed/running records are never re-submitted.
            for (const row of initial) {
                if (row.status === "pending") {
                    batchDispatchQueue.enqueue(`${scope}:${row.id}`, () =>
                        runWithScope(scope, () => dispatchTask(row.id)),
                    );
                }
            }
            if (request.signal.aborted) close();
        },
        cancel() {
            cleanup();
        },
    });
    return new Response(body, { headers: headers() });
}

function headers() {
    return {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    };
}
