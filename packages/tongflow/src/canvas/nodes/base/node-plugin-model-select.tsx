"use client";

import { useNodeId } from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { useTranslations } from "use-intl";
import type { BaseNodeData } from "../../../core";
import useFlow from "../../hooks/use-flow";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
    loadPluginModelCatalog,
    useNodePluginModels,
} from "../../hooks/use-plugins-registry";
import { useResolvedPluginId } from "./node-plugin-id-select";
import { NodePluginSelect } from "./node-plugin-select";

type NodePluginModelSelectProps = {
    nodeSlot: string;
    data: BaseNodeData;
};

/**
 * Model selector for router-style plugins that declare per-slot model lists
 * (`TONGFLOW_SLOT_MODELS`, optionally extended live via
 * `TONGFLOW_MODEL_CATALOG` — re-checked each time the dropdown opens). Renders
 * nothing when the active plugin declares no models, so single-model plugins
 * are visually unchanged. The selection is stored as `data.pluginModel` and
 * travels top-level (like `pluginId`) through the create-task API and workflow
 * export.
 */
export function NodePluginModelSelect({
    nodeSlot,
    data,
}: NodePluginModelSelectProps) {
    const id = useNodeId()!;
    const updates = useFlow((s) => s.updates);
    const t = useTranslations("Workspace.nodes.base");

    const { resolved: pluginId } = useResolvedPluginId(nodeSlot, data);
    const models = useNodePluginModels(nodeSlot, pluginId);

    const current = String(data.pluginModel ?? "").trim();
    const compatible = pluginId === "tongflow-api-openai";
    const resolved = models.includes(current) ? current : (models[0] ?? "");

    // Persist the default (or replace a stale model after a plugin switch)
    // after paint, mirroring the pluginId default write in
    // useNodePluginResolver.
    useEffect(() => {
        if (compatible) return;
        if (resolved === current) return;
        // Programmatic normalization — must not create (or invalidate) undo
        // history, or it re-fires after every undo and breaks the chain.
        updates(id, { ...data, pluginModel: resolved }, { history: false });
    }, [id, data, current, resolved, updates, compatible]);

    const options = useMemo(
        () => models.map((m) => ({ value: m, label: m })),
        [models],
    );

    if (compatible) {
        const listId = `models-${id}`;
        return (
            <Card className="p-3 space-y-2">
                <Label htmlFor={`model-${id}`}>{t("pluginModelTitle")}</Label>
                <Input
                    id={`model-${id}`}
                    aria-label={t("pluginModelTitle")}
                    list={listId}
                    value={String(data.pluginModel ?? "")}
                    placeholder={t("pluginModelServiceDefault")}
                    onChange={(event) =>
                        updates(id, {
                            ...data,
                            pluginModel: event.target.value,
                        })
                    }
                />
                <datalist id={listId}>
                    {models.map((model) => (
                        <option key={model} value={model} />
                    ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                    {t("pluginModelCompatibleHint")}
                </p>
            </Card>
        );
    }

    if (options.length === 0) return null;

    return (
        <NodePluginSelect
            value={resolved}
            onValueChange={(value) =>
                updates(id, { ...data, pluginModel: value })
            }
            options={options}
            title={t("pluginModelTitle")}
            onOpenChange={(open) => {
                if (open) void loadPluginModelCatalog(pluginId);
            }}
        />
    );
}
