import { v4 } from "uuid";
import { canAdoptDraft, segmentDraft } from "../../../core/abi/segment-draft";
import type { FlowCoreState } from "../../../core/store/flow-store";

/**
 * Create one editable clone node for an adopted split draft, with a real
 * ABI-to-ABI text connection. Nothing is executed or sent to a model.
 */
export function createBatchSpeechClone(
    getFlow: () => FlowCoreState,
    splitId: string,
): string | undefined {
    const flow = getFlow();
    const split = flow.nodes.find((n) => n.id === splitId);
    const draft = split && segmentDraft(split.data);
    if (
        split?.type !== "splitTextNode" ||
        split.data.outputPending === true ||
        !draft?.reviewed ||
        !canAdoptDraft(draft)
    ) {
        return;
    }

    const existing = flow.edges.find(
        (edge) =>
            edge.source === splitId &&
            flow.nodes.some(
                (node) =>
                    node.id === edge.target &&
                    (node.type === "textGenSpeechCloneNode" ||
                        node.type === "textGenSpeechCloneComposeNode"),
            ),
    );
    if (existing) {
        // Repair legacy links made without ABI handle identifiers.
        if (
            existing.sourceHandle !== "out:texts" ||
            existing.targetHandle !== "in:text"
        ) {
            flow.commitHistory();
            flow.setEdges(
                flow.edges.map((e) =>
                    e.id === existing.id
                        ? {
                              ...e,
                              sourceHandle: "out:texts",
                              targetHandle: "in:text",
                          }
                        : e,
                ),
            );
        }
        return existing.target;
    }

    // Put the clone to the right of the segment previews, without moving
    // the author's existing draft nodes or their manual layout.
    const siblingIds = new Set(
        flow.edges.filter((e) => e.source === splitId).map((e) => e.target),
    );
    const siblings = flow.nodes.filter((n) => siblingIds.has(n.id));
    const x =
        Math.max(split.position.x, ...siblings.map((n) => n.position.x)) + 750;
    const y = siblings.length
        ? siblings.reduce((sum, n) => sum + n.position.y, 0) / siblings.length
        : split.position.y;

    // addNode captures a single undo snapshot; setEdges completes the same
    // user action without taking an additional history snapshot.
    const cloneId = flow.addNode(
        { type: "textGenSpeechCloneNode", data: {} },
        { x, y },
    );
    const current = getFlow();
    current.setEdges([
        ...current.edges,
        {
            id: v4(),
            type: "custom-edge",
            source: splitId,
            target: cloneId,
            sourceHandle: "out:texts",
            targetHandle: "in:text",
        },
    ]);
    return cloneId;
}
