import { describe, expect, it } from "vitest";
import { taskRecordEvent } from "./task-record-event";

describe("durable event replay", () => {
    it("replays actual audio and node association instead of a new task", () => {
        const event = taskRecordEvent({
            id: "done",
            nodeId: "voice",
            status: "completed",
            result: JSON.stringify({
                success: true,
                audio: { file_key: "existing.wav" },
            }),
            error: null,
        });
        expect(event).toEqual({
            id: "done",
            nodeId: "voice",
            status: "COMPLETED",
            data: { success: true, audio: { file_key: "existing.wav" } },
        });
    });
    it("preserves coded failures, legacy failures and cancellation", () => {
        const base = { id: "failed", nodeId: "voice", result: null };
        expect(
            taskRecordEvent({
                ...base,
                status: "failed",
                error: JSON.stringify({
                    message: "Provider failed",
                    errorCode: "provider_error",
                }),
            }).data,
        ).toEqual({
            message: "Provider failed",
            errorCode: "provider_error",
            error: "Provider failed",
        });
        expect(
            taskRecordEvent({
                ...base,
                status: "failed",
                error: "legacy message",
            }).data?.error,
        ).toBe("legacy message");
        expect(
            taskRecordEvent({ ...base, status: "cancelled", error: null })
                .status,
        ).toBe("CANCELLED");
    });
});
