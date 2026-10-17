import {
    getAbiNodeBySlot,
    inputSignature,
    resolveAbiOutputMappings,
} from "../../../core";
import useFlow from "../../hooks/use-flow";
import { applyResolvedOutputRoutes, computeOutputView } from "./payload";

/** Atomically replace a producer channel, preserving data-node shells and wires. */
export function publishOutput(
    nodeId: string,
    payload: Record<string, unknown>,
    signature: string,
) {
    const flow = useFlow.getState();
    const producer = flow.nodes.find((n) => n.id === nodeId);
    if (
        !producer ||
        signature !== inputSignature(nodeId, flow.nodes, flow.edges)
    )
        return;
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
