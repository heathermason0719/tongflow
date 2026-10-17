import type { Edge, Node } from "@xyflow/react";
import { resolvedSpecForNodeType } from "./node-feature-registry";
import { canAdoptDraft, segmentDraft } from "./segment-draft";

// Bounded, non-security fingerprint. Storing whole ancestor texts on every
// segment would exhaust browser storage on long documents. Two independent
// 32-bit streams plus length track content; this is not an authorization hash.
function fingerprint(value: string): string {
    let a = 0x811c9dc5;
    let b = 0x9e3779b9;
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x85ebca6b);
    }
    return `inputs-v1-${value.length}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

/** Persisted, deterministic identity of the inputs, never of cached results. */
export function inputSignature(
    nodeId: string,
    nodes: ReadonlyArray<Node>,
    edges: ReadonlyArray<Edge>,
    visiting = new Set<string>(),
): string {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || visiting.has(nodeId)) return "missing-or-cycle";
    const seen = new Set(visiting).add(nodeId);
    const spec = resolvedSpecForNodeType(node.type);
    const config = spec
        ? Object.entries(spec.fields)
              .filter(
                  ([, f]) =>
                      f.kind === "config" || (f.kind === "handle" && f.manual),
              )
              .map(([key]) => [key, node.data[key]])
        : [node.data.texts, node.data.fileKeys];
    return fingerprint(
        JSON.stringify([
            node.type,
            segmentDraft(node.data),
            config,
            node.data.pluginId,
            node.data.pluginModel,
            node.data.pluginParams,
            edges
                .filter(
                    (e) =>
                        e.target === nodeId &&
                        node.data.manualTextOverride !== true,
                )
                .map((e) => [
                    e.source,
                    e.sourceHandle,
                    e.targetHandle,
                    inputSignature(e.source, nodes, edges, seen),
                    // A producer can return different segmentation for unchanged
                    // config. Consumers identify the actual channel they read.
                    (
                        nodes.find((n) => n.id === e.source)?.data.liveOutput as
                            | Record<string, unknown>
                            | undefined
                    )?.[e.sourceHandle?.replace(/^out:/, "") ?? ""],
                ]),
        ]),
    );
}

export interface OutputGeneration {
    producerId: string;
    signature: string;
}

export function isOutputCurrent(
    node: Node,
    nodes: ReadonlyArray<Node>,
    edges: ReadonlyArray<Edge>,
): boolean {
    const draftParent =
        node.type === "textNode"
            ? edges
                  .filter((e) => e.target === node.id)
                  .map((e) => nodes.find((n) => n.id === e.source))
                  .find(
                      (n) =>
                          n?.type === "splitTextNode" && segmentDraft(n.data),
                  )
            : undefined;
    const parentDraft = draftParent && segmentDraft(draftParent.data);
    if (parentDraft)
        return (
            parentDraft.reviewed &&
            canAdoptDraft(parentDraft) &&
            draftParent.data.outputPending !== true
        );
    if (node.data.manualTextOverride === true) return true;
    const ownDraft = node.type === "splitTextNode" && segmentDraft(node.data);
    if (ownDraft)
        return (
            ownDraft.reviewed &&
            canAdoptDraft(ownDraft) &&
            node.data.outputPending !== true
        );
    const generation = node.data.outputGeneration as
        | OutputGeneration
        | undefined;
    if (generation) {
        const producer = nodes.find((n) => n.id === generation.producerId);
        const draft =
            producer?.type === "splitTextNode" && segmentDraft(producer.data);
        if (draft)
            return (
                draft.reviewed &&
                canAdoptDraft(draft) &&
                producer?.data.outputPending !== true
            );
        if (
            nodes.find((n) => n.id === generation.producerId)?.data
                .outputPending
        )
            return false;
        return (
            generation.signature ===
            inputSignature(generation.producerId, nodes, edges)
        );
    }
    // Historical parsed/split text cannot prove which input produced it.
    // Keep it visible and require one execution to establish its provenance.
    return !edges.some(
        (e) =>
            e.target === node.id &&
            ["splitTextNode", "fileGenTextNode"].includes(
                nodes.find((n) => n.id === e.source)?.type ?? "",
            ),
    );
}
