import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../api/task";
import { recoverBatch } from "./batch-recovery";

const record = (
    id: string,
    text: string,
    extra: Partial<TaskRecord> = {},
): TaskRecord => ({
    id,
    nodeId: "voice",
    feature: "text-gen-speech-clone",
    pluginId: "clone",
    prompt: { text, ref_audio: "ref.wav" },
    status: "completed",
    progress: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
});
const expected = {
    feature: "text-gen-speech-clone",
    pluginId: "clone",
    prompts: [
        { text: "甲", ref_audio: "ref.wav" },
        { text: "乙", ref_audio: "ref.wav" },
    ],
};

describe("durable batch recovery", () => {
    it("recovers legacy completed records in current input order without submitting tasks", () => {
        const recovered = recoverBatch(
            [record("second", "乙"), record("first", "甲")],
            expected,
        )!;
        expect(recovered.matchesCurrent).toBe(true);
        expect(recovered.entries.map((e) => [e.taskId, e.batchIndex])).toEqual([
            ["first", 0],
            ["second", 1],
        ]);
    });
    it("requires the same voice, model and full set for legacy results", () => {
        expect(recoverBatch([record("a", "甲")], expected)).toBeUndefined();
        expect(
            recoverBatch(
                [record("b", "乙", { model: "other" }), record("a", "甲")],
                expected,
            ),
        ).toBeUndefined();
        expect(
            recoverBatch(
                [
                    record("b", "乙", {
                        prompt: { text: "乙", ref_audio: "old.wav" },
                    }),
                    record("a", "甲"),
                ],
                expected,
            ),
        ).toBeUndefined();
    });
    it("uses distinct records for repeated paragraphs", () => {
        const input = {
            ...expected,
            prompts: [expected.prompts[0], expected.prompts[0]],
        };
        expect(
            recoverBatch(
                [record("new", "甲"), record("old", "甲")],
                input,
            )?.entries.map((e) => e.taskId),
        ).toEqual(["old", "new"]);
        expect(recoverBatch([record("one", "甲")], input)).toBeUndefined();
    });
    it("restores only the latest durable batch and preserves failed or running states", () => {
        const records = [
            record("b", "乙", {
                batchId: "new",
                batchIndex: 1,
                status: "processing",
            }),
            record("a", "甲", {
                batchId: "new",
                batchIndex: 0,
                status: "failed",
            }),
            record("old", "甲", { batchId: "old", batchIndex: 0 }),
        ];
        expect(
            recoverBatch(records, expected)?.entries.map((e) => e.taskId),
        ).toEqual(["a", "b"]);
        expect(
            recoverBatch(records, {
                ...expected,
                prompts: [expected.prompts[1], expected.prompts[0]],
            })?.matchesCurrent,
        ).toBe(false);
    });
});
