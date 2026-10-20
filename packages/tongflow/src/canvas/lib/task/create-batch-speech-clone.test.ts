import { describe, expect, it } from "vitest";
import { resolvedSpecForNodeType } from "../../../core/abi/node-feature-registry";
import { buildPrompts, collectHandleValues } from "../../../core/abi/resolve";
import { createFlowStore } from "../../../core/store/flow-store";
import { isValidFlowConnection } from "../../../core/workflow/connection-rules";
import { createBatchSpeechClone } from "./create-batch-speech-clone";

const segments = ["人工修改第一段。", "第二段。", "第三段。"];
function fixture(reviewed = true) {
    const store = createFlowStore();
    const source = store.getState().addNode({
        type: "textNode",
        data: { texts: ["原稿。"] },
    });
    const splitId = store.getState().addNode({
        type: "splitTextNode",
        data: {
            feature: "split-text",
            outputPending: false,
            segmentDraft: {
                source: "原稿。",
                proposal: ["模型第一段。", "第二段。", "第三段。"],
                segments,
                reviewed,
            },
            liveOutput: { texts: segments },
        },
    });
    store.getState().setEdges([
        {
            id: "source-to-split",
            source,
            target: splitId,
            sourceHandle: "out:textNode",
            targetHandle: "in:text",
        },
    ]);
    store.getState().expands(
        splitId,
        segments.map((text) => ({ type: "textNode", data: { texts: [text] } })),
    );
    return { store, splitId };
}

describe("batch clone from an adopted split draft", () => {
    it("creates one node and a correctly addressed edge carrying all segments", () => {
        const { store, splitId } = fixture();
        const cloneId = createBatchSpeechClone(store.getState, splitId);
        expect(cloneId).toBeTruthy();
        const graph = store.getState();
        const link = graph.edges.find(
            (e) => e.source === splitId && e.target === cloneId,
        );
        expect(link).toMatchObject({
            sourceHandle: "out:texts",
            targetHandle: "in:text",
        });
        expect(
            isValidFlowConnection(
                {
                    source: link!.source,
                    target: link!.target,
                    sourceHandle: link!.sourceHandle ?? null,
                    targetHandle: link!.targetHandle ?? null,
                },
                graph.nodes,
                graph.edges.filter((e) => e.id !== link!.id),
            ),
        ).toBe(true);

        const spec = resolvedSpecForNodeType("textGenSpeechCloneNode")!;
        const read = () =>
            buildPrompts({
                spec,
                configValues: {},
                handleValues: collectHandleValues(
                    cloneId!,
                    spec,
                    store.getState().nodes,
                    store.getState().edges,
                ),
            });
        expect(read().map((p) => p.text)).toEqual(segments);

        const voice = store.getState().addNode({
            type: "audioNode",
            data: { fileKeys: ["voice.wav"] },
        });
        store.getState().setEdges([
            ...store.getState().edges,
            {
                id: "voice-to-clone",
                source: voice,
                target: cloneId!,
                sourceHandle: "out:audioNode",
                targetHandle: "in:ref_audio",
            },
        ]);
        expect(read()).toEqual(
            segments.map((text) => ({
                text,
                ref_audio: "voice.wav",
            })),
        );
        // Reopening or clicking twice cannot create duplicate clone nodes.
        expect(createBatchSpeechClone(store.getState, splitId)).toBe(cloneId);
        expect(
            store
                .getState()
                .nodes.filter((n) => n.type === "textGenSpeechCloneNode"),
        ).toHaveLength(1);
    });

    it("waits for adoption, ignores pending outputs, and never triggers generation", () => {
        const { store, splitId } = fixture(false);
        expect(createBatchSpeechClone(store.getState, splitId)).toBeUndefined();
        expect(
            store
                .getState()
                .nodes.some((n) => n.type === "textGenSpeechCloneNode"),
        ).toBe(false);
        const split = store.getState().nodes.find((n) => n.id === splitId)!;
        store.getState().updates(splitId, {
            ...split.data,
            segmentDraft: {
                ...(split.data.segmentDraft as object),
                reviewed: true,
            },
            outputPending: true,
        });
        expect(createBatchSpeechClone(store.getState, splitId)).toBeUndefined();
        expect(
            store
                .getState()
                .nodes.some((n) => n.type === "textGenSpeechCloneNode"),
        ).toBe(false);
    });

    it("creates one undoable graph change, without overwriting paragraph nodes", () => {
        const { store, splitId } = fixture();
        const before = store.getState();
        const originalNodeCount = before.nodes.length;
        const originalEdgeCount = before.edges.length;
        const cloneId = createBatchSpeechClone(store.getState, splitId);
        expect(store.getState().nodes.length).toBe(originalNodeCount + 1);
        expect(store.getState().edges.length).toBe(originalEdgeCount + 1);
        expect(
            store
                .getState()
                .nodes.filter((n) => n.type === "textNode")
                .flatMap((n) => (n.data.texts as string[]) ?? []),
        ).toContain("人工修改第一段。");
        store.getState().undo();
        expect(store.getState().nodes.some((n) => n.id === cloneId)).toBe(
            false,
        );
        expect(store.getState().edges.length).toBe(originalEdgeCount);
    });

    it("repairs an existing incomplete connection instead of duplicating the clone", () => {
        const { store, splitId } = fixture();
        const cloneId = createBatchSpeechClone(store.getState, splitId)!;
        const graph = store.getState();
        graph.setEdges(
            graph.edges.map((e) =>
                e.target === cloneId
                    ? { ...e, sourceHandle: null, targetHandle: null }
                    : e,
            ),
        );
        expect(createBatchSpeechClone(store.getState, splitId)).toBe(cloneId);
        expect(
            store.getState().edges.find((e) => e.target === cloneId),
        ).toMatchObject({ sourceHandle: "out:texts", targetHandle: "in:text" });
    });
});
