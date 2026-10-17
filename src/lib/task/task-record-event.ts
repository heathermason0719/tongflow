import type { TaskEvent } from "./emitter";

export function taskRecordEvent(row: {
    id: string;
    nodeId: string;
    status: string;
    result: string | null;
    error: string | null;
}): TaskEvent {
    let data: Record<string, unknown> = {};
    const raw = row.status === "completed" ? row.result : row.error;
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            data =
                parsed && typeof parsed === "object"
                    ? parsed
                    : { error: String(parsed) };
        } catch {
            data = { error: raw };
        }
    }
    if (
        row.status === "failed" &&
        typeof data.error !== "string" &&
        typeof data.message === "string"
    )
        data.error = data.message;
    return {
        id: row.id,
        nodeId: row.nodeId,
        status:
            (
                {
                    completed: "COMPLETED",
                    failed: "FAILED",
                    cancelled: "CANCELLED",
                    processing: "RUNNING",
                    pending: "PENDING",
                } as Record<string, string>
            )[row.status] ?? "PENDING",
        data,
    };
}
