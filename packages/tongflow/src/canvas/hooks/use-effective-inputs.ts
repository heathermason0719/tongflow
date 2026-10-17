import { useNodeId, useStore } from "@xyflow/react";
import type { NodeSlot } from "../../core";
import {
    buildPrompts,
    collectHandleValues,
    inputSignature,
    parseTargetHandleId,
} from "../../core";
import { useNodeAbiSpec } from "./use-node-abi-spec";

/** The preview and execute path resolve the same ABI fields from the live graph. */
export function useEffectiveInputs(
    feature: NodeSlot,
    config: Record<string, unknown>,
) {
    const nodeId = useNodeId() ?? "";
    const nodes = useStore((s) => s.nodes);
    const edges = useStore((s) => s.edges);
    const spec = useNodeAbiSpec(feature);
    const values = collectHandleValues(nodeId, spec, nodes, edges);
    const prompts = buildPrompts({
        spec,
        configValues: config,
        handleValues: values,
    });
    const sources = (field: string) =>
        edges
            .filter(
                (e) =>
                    e.target === nodeId &&
                    parseTargetHandleId(e.targetHandle) === field,
            )
            .map((e) => nodes.find((n) => n.id === e.source))
            .filter((n) => n !== undefined);
    return {
        values,
        prompts,
        sources,
        signature: inputSignature(nodeId, nodes, edges),
    };
}
