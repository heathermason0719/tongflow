import { describe, expect, it } from "vitest";
import { BatchDispatchQueue } from "./batch-dispatch-queue";

describe("batch dispatch queue", () => {
    it("bounds execution and does not duplicate queued or running jobs on reconnect", async () => {
        const queue = new BatchDispatchQueue(2);
        const releases: (() => void)[] = [];
        const starts: number[] = [];
        let active = 0,
            maxActive = 0;
        const run = (index: number) => async () => {
            starts.push(index);
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>((resolve) => releases.push(resolve));
            active--;
        };
        for (let i = 0; i < 5; i++) queue.enqueue(String(i), run(i));
        for (let i = 0; i < 5; i++) queue.enqueue(String(i), run(i));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(starts).toEqual([0, 1]);
        for (let round = 0; round < 5; round++) {
            releases.shift()?.();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        expect(starts).toEqual([0, 1, 2, 3, 4]);
        expect(maxActive).toBe(2);
    });
});
