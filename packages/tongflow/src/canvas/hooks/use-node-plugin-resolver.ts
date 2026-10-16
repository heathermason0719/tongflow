import { useNodeId, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { normalizePluginParams } from "../../core";
import { resolvePluginModel } from "./plugin-model-selection";
import {
    getNodePluginModels,
    getNodePluginParams,
    useNodePluginIds,
    usePluginsRegistry,
} from "./use-plugins-registry";

/**
 * Resolves the active plugin for a node given its ABI feature/nodeSlot.
 *
 * Responsibilities:
 * - Ensures the plugins registry is fetched (so `nodePluginMap` populates on canvas).
 * - Reads pluginOptions from the scanned registry (`nodePluginMap[feature]`).
 * - Persists a default `pluginId` into node data before paint so execution hooks
 *   always see a value (avoids run-before-effect race).
 * - Provides `resolveActivePluginId()` so the execution hook can hand the id
 *   to the create-task API as a top-level field.
 */
export function useNodePluginResolver(feature: string | undefined) {
    usePluginsRegistry();
    const nodeId = useNodeId();
    const { updateNodeData, getNode } = useReactFlow();
    const pluginOptions = useNodePluginIds(feature ?? "");
    // Head of nodePluginMap[slot] = the slot's default implementation (a plugin's
    // `@node_slot(..., default=True)` claim, else first in directory order).
    const defaultPluginIdFromRegistry = (pluginOptions[0] ?? "").trim();

    // Use a passive useEffect (rather than useLayoutEffect) so the default
    // plugin id write happens after paint. Synchronous writes during the
    // commit phase can fire while sibling components (e.g. SmartIsland) are
    // still rendering, surfacing as "setState while rendering" warnings.
    useEffect(() => {
        if (!nodeId || !feature) return;
        if (pluginOptions.length === 0) return;
        if (!defaultPluginIdFromRegistry) return;
        const n = getNode(nodeId);
        const d = n?.data as { pluginId?: string } | undefined;
        const current = (
            typeof d?.pluginId === "string" ? d.pluginId : ""
        ).trim();
        if (current && pluginOptions.includes(current)) return;
        updateNodeData(nodeId, { pluginId: defaultPluginIdFromRegistry });
    }, [
        nodeId,
        feature,
        defaultPluginIdFromRegistry,
        getNode,
        updateNodeData,
        pluginOptions,
    ]);

    const resolveActivePluginId = useCallback((): string => {
        if (!nodeId) return defaultPluginIdFromRegistry;
        const n = getNode(nodeId);
        const nodeData = (n?.data ?? undefined) as
            | { pluginId?: string }
            | undefined;
        const fromData = (
            typeof nodeData?.pluginId === "string" ? nodeData.pluginId : ""
        ).trim();
        const validData = !fromData
            ? ""
            : pluginOptions.length === 0
              ? fromData
              : pluginOptions.includes(fromData)
                ? fromData
                : "";
        return validData || defaultPluginIdFromRegistry;
    }, [nodeId, getNode, defaultPluginIdFromRegistry, pluginOptions]);

    /**
     * Compatible endpoints accept an explicit model id, or defer to service
     * configuration when empty. Other routers use `pluginModel` when it is one
     * of the active plugin's models (declared shortlist or live catalog), else
     * that plugin's default (first declared model). `undefined` when the
     * plugin declares none — the create-task API then omits the field entirely.
     */
    const resolveActiveModel = useCallback((): string | undefined => {
        if (!feature) return undefined;
        const pluginId = resolveActivePluginId();
        if (!pluginId) return undefined;
        const models = getNodePluginModels(feature, pluginId);
        const n = nodeId ? getNode(nodeId) : undefined;
        const fromData = String(
            (n?.data as { pluginModel?: string } | undefined)?.pluginModel ??
                "",
        ).trim();
        return resolvePluginModel(pluginId, fromData, models);
    }, [feature, nodeId, getNode, resolveActivePluginId]);

    /**
     * Advanced parameters for this run: the node's `pluginParams` filtered to
     * what the active plugin (and model) declares, minus values equal to the
     * declared default. `undefined` when nothing remains — the create-task API
     * then omits the field and the plugin runs on its own defaults.
     */
    const resolveActiveParams = useCallback(():
        | Record<string, unknown>
        | undefined => {
        if (!feature) return undefined;
        const pluginId = resolveActivePluginId();
        if (!pluginId) return undefined;
        const entries = getNodePluginParams(
            feature,
            pluginId,
            resolveActiveModel(),
        );
        if (entries.length === 0) return undefined;
        const n = nodeId ? getNode(nodeId) : undefined;
        const raw = (n?.data as { pluginParams?: unknown } | undefined)
            ?.pluginParams;
        const params = normalizePluginParams(
            entries,
            raw && typeof raw === "object" && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : undefined,
        );
        return Object.keys(params).length > 0 ? params : undefined;
    }, [feature, nodeId, getNode, resolveActivePluginId, resolveActiveModel]);

    return {
        pluginOptions,
        defaultPluginIdFromRegistry,
        resolveActivePluginId,
        resolveActiveModel,
        resolveActiveParams,
    };
}
