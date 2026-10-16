"use client";

import { useNodeId } from "@xyflow/react";
import { ChevronRight, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import type {
    BaseNodeData,
    PluginParamEntry,
    PluginParamSpec,
} from "../../../core";
import { normalizePluginParams, samePluginParams } from "../../../core";
import useFlow from "../../hooks/use-flow";
import { resolvePluginModel } from "../../hooks/plugin-model-selection";
import {
    useNodePluginModels,
    useNodePluginParams,
} from "../../hooks/use-plugins-registry";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../ui/select";
import { Switch } from "../../ui/switch";
import { useResolvedPluginId } from "./node-plugin-id-select";

type NodePluginParamsProps = {
    nodeSlot: string;
    data: BaseNodeData;
};

function readParams(data: BaseNodeData): Record<string, unknown> {
    const raw = data.pluginParams;
    return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
}

/**
 * Collapsed "Advanced" section listing the run-time knobs the active plugin
 * declares for this slot (`TONGFLOW_SLOT_PARAMS`, optionally gated per router
 * model). Renders nothing for plugins that declare none. Choices live in
 * `data.pluginParams` as a diff against the declared defaults — an unset key
 * means "plugin default" — and travel top-level as `params` through the
 * create-task API and the workflow export, never inside the ABI prompt.
 */
export function NodePluginParams({ nodeSlot, data }: NodePluginParamsProps) {
    const id = useNodeId()!;
    const updates = useFlow((s) => s.updates);
    const t = useTranslations("Workspace.nodes.base");
    const [open, setOpen] = useState(false);

    const { resolved: pluginId } = useResolvedPluginId(nodeSlot, data);
    const models = useNodePluginModels(nodeSlot, pluginId);
    const currentModel = String(data.pluginModel ?? "").trim();
    const model = resolvePluginModel(pluginId, currentModel, models);
    const entries = useNodePluginParams(nodeSlot, pluginId, model);

    const values = useMemo(() => readParams(data), [data]);

    // Drop keys the active plugin/model no longer offers (after a switch) and
    // values that merely restate the default. Programmatic normalization —
    // never part of undo history, or it re-fires after every undo.
    useEffect(() => {
        const normalized = normalizePluginParams(entries, values);
        if (samePluginParams(normalized, data.pluginParams)) return;
        if (
            Object.keys(normalized).length === 0 &&
            data.pluginParams === undefined
        )
            return;
        const next: BaseNodeData = { ...data };
        if (Object.keys(normalized).length === 0) delete next.pluginParams;
        else next.pluginParams = normalized;
        updates(id, next, { history: false });
    }, [id, data, entries, values, updates]);

    const setParam = useCallback(
        (name: string, value: unknown) => {
            const next = { ...values };
            if (value === undefined) delete next[name];
            else next[name] = value;
            const normalized = normalizePluginParams(entries, next);
            const nextData: BaseNodeData = { ...data };
            if (Object.keys(normalized).length === 0)
                delete nextData.pluginParams;
            else nextData.pluginParams = normalized;
            updates(id, nextData);
        },
        [id, data, entries, values, updates],
    );

    const reset = useCallback(() => {
        const nextData: BaseNodeData = { ...data };
        delete nextData.pluginParams;
        updates(id, nextData);
    }, [id, data, updates]);

    if (entries.length === 0) return null;

    const changed = Object.keys(values).length;

    return (
        <Card className="p-3">
            <div className="space-y-2">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        className="nodrag flex flex-1 items-center gap-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
                        aria-expanded={open}
                    >
                        <ChevronRight
                            className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
                        />
                        <span>{t("pluginParamsTitle")}</span>
                        {changed > 0 && (
                            <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                                {changed}
                            </span>
                        )}
                    </button>
                    {changed > 0 && (
                        <button
                            type="button"
                            onClick={reset}
                            title={t("pluginParamsReset")}
                            aria-label={t("pluginParamsReset")}
                            className="nodrag rounded p-1 text-muted-foreground hover:text-foreground"
                        >
                            <RotateCcw className="size-3.5" />
                        </button>
                    )}
                </div>
                {open && (
                    <div className="space-y-2">
                        {entries.map((entry) => (
                            <ParamRow
                                key={entry.name}
                                entry={entry}
                                value={values[entry.name]}
                                onChange={(v) => setParam(entry.name, v)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
}

type ParamRowProps = {
    entry: PluginParamEntry;
    value: unknown;
    onChange: (value: unknown) => void;
};

function ParamRow({ entry, value, onChange }: ParamRowProps) {
    const t = useTranslations("Workspace.nodes.base");
    const { name, spec } = entry;
    const label = spec.label ?? name;
    const inline = spec.type === "boolean";
    // Once a value diverges from the declared default, keep the default in
    // view so the user always knows what "reset" goes back to.
    const changed = value !== undefined && spec.default !== undefined;
    return (
        <div
            className={
                inline ? "flex items-center justify-between gap-2" : "space-y-1"
            }
        >
            <Label
                className="flex items-baseline gap-1.5 text-xs text-muted-foreground"
                title={spec.description}
            >
                <span>{label}</span>
                {changed && (
                    <span className="text-[10px] text-muted-foreground/60">
                        {t("pluginParamDefault", {
                            value: String(spec.default),
                        })}
                    </span>
                )}
            </Label>
            <ParamControl spec={spec} value={value} onChange={onChange} />
        </div>
    );
}

type ParamControlProps = {
    spec: PluginParamSpec;
    value: unknown;
    onChange: (value: unknown) => void;
};

function ParamControl({ spec, value, onChange }: ParamControlProps) {
    const effective = value === undefined ? spec.default : value;
    switch (spec.type) {
        case "select": {
            const options = spec.options ?? [];
            const current = effective === undefined ? "" : String(effective);
            return (
                <Select
                    value={current}
                    onValueChange={(v) => {
                        const picked = options.find((o) => String(o) === v);
                        onChange(picked);
                    }}
                >
                    <SelectTrigger className="nodrag w-full" size="sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((o) => (
                            <SelectItem key={String(o)} value={String(o)}>
                                {String(o)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        }
        case "boolean":
            return (
                <Switch
                    className="nodrag"
                    checked={effective === true}
                    onCheckedChange={(checked) => onChange(checked)}
                />
            );
        case "number":
        case "integer":
            return (
                <Input
                    type="number"
                    className="nodrag h-8"
                    value={
                        typeof effective === "number" ? String(effective) : ""
                    }
                    min={spec.min}
                    max={spec.max}
                    step={spec.step ?? (spec.type === "integer" ? 1 : "any")}
                    onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") {
                            onChange(undefined);
                            return;
                        }
                        const n = Number(raw);
                        if (!Number.isFinite(n)) return;
                        onChange(spec.type === "integer" ? Math.round(n) : n);
                    }}
                />
            );
        case "text":
            return (
                <Input
                    type="text"
                    className="nodrag h-8"
                    value={typeof effective === "string" ? effective : ""}
                    onChange={(e) => {
                        const v = e.target.value;
                        onChange(v === "" ? undefined : v);
                    }}
                />
            );
        default:
            return null;
    }
}
