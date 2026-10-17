import {
    collectHandleValues,
    getAbiNodeBySlot,
    inputSignature,
    resolveAbiOutputMappings,
    resolvedSpecForNodeType,
    type SegmentDraft,
} from "../../../core";
import useFlow from "../../hooks/use-flow";
import { applyResolvedOutputRoutes, computeOutputView } from "./payload";

/** Atomically replace a producer channel, preserving data-node shells and wires. */
export function publishOutput(
    nodeId: string,
    payload: Record<string, unknown>,
    signature: string,
    sourceText?: string,
) {
    const flow = useFlow.getState();
    const producer = flow.nodes.find((n) => n.id === nodeId);
    if (!producer) return;
    if (signature !== inputSignature(nodeId, flow.nodes, flow.edges)) {
        if (producer.data.activeInputSignature === signature)
            flow.updates(
                nodeId,
                { ...producer.data, outputPending: false },
                { history: false },
            );
        return;
    }
    if (producer.type === "splitTextNode" && Array.isArray(payload.texts)) {
        const spec = resolvedSpecForNodeType(producer.type);
        const source =
            sourceText ??
            (spec
                ? collectHandleValues(nodeId, spec, flow.nodes, flow.edges).text
                : "");
        const texts = payload.texts.filter(
            (s): s is string => typeof s === "string",
        );
        updateSplitDraft(nodeId, {
            source: typeof source === "string" ? source : "",
            proposal: [...texts],
            segments: [...texts],
            reviewed: false,
        });
        return;
    }
    writeOutput(nodeId, payload, signature);
}

/** All edits publish one ordered channel, invalidating downstream audio identity. */
export function updateSplitDraft(nodeId: string, draft: SegmentDraft) {
    const flow = useFlow.getState();
    const node = flow.nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "splitTextNode") return;
    flow.updates(nodeId, {
        ...node.data,
        segmentDraft: draft,
        liveOutput: { texts: [...draft.segments] },
        outputPending: false,
    });
    // While editing, consumers are withheld. Materialize previews once upon
    // adoption rather than rebuilding sibling nodes for every keystroke.
    if (!draft.reviewed) return;
    const current = useFlow.getState();
    writeOutput(
        nodeId,
        { texts: draft.segments },
        inputSignature(nodeId, current.nodes, current.edges),
    );
    useFlow.getState().autoLayout([nodeId], { history: false });
}

function writeOutput(
    nodeId: string,
    payload: Record<string, unknown>,
    signature: string,
) {
    const flow = useFlow.getState();
    const producer = flow.nodes.find((n) => n.id === nodeId);
    if (!producer) return;
    const abi = getAbiNodeBySlot(String(producer.data.feature));
    if (!abi) return;
    const routes = resolveAbiOutputMappings(abi);
    const generation = { producerId: nodeId, signature };
    flow.updates(
        nodeId,
        {
            ...producer.data,
            outputPending: false,
            outputGeneration: generation,
            liveOutput: Object.fromEntries(
                Object.entries(computeOutputView(routes, payload)).map(
                    ([key, channel]) => [key, channel.values],
                ),
            ),
        },
        { history: false },
    );
    // Clear surplus old segments/results without deleting nodes, wires or assets.
    const childIds = new Set(
        flow.edges.filter((e) => e.source === nodeId).map((e) => e.target),
    );
    useFlow.getState().setNodes(
        useFlow.getState().nodes.map((node) => {
            const route = routes.find((r) => r.nodeType === node.type);
            return childIds.has(node.id) &&
                route &&
                node.data.manualTextOverride !== true
                ? {
                      ...node,
                      data: {
                          ...node.data,
                          [route.dataField]: [],
                          outputGeneration: generation,
                      },
                  }
                : node;
        }),
    );
    applyResolvedOutputRoutes(nodeId, payload, routes, (source, items) =>
        useFlow.getState().expands(
            source,
            items.map((item) => ({
                ...item,
                data: { ...item.data, outputGeneration: generation },
            })),
        ),
    );
}
