import { useNodeId } from "@xyflow/react";
import { Scissors } from "lucide-react";
import { memo } from "react";
import { useTranslations } from "use-intl";
import {
    canAdoptDraft,
    segmentDraft,
    type TongflowPluginNodeProps,
} from "../../../core";
import { useAbiForm } from "../../hooks/use-abi-form";
import { useEffectiveInputs } from "../../hooks/use-effective-inputs";
import useFlow from "../../hooks/use-flow";
import { createBatchSpeechClone } from "../../lib/task/create-batch-speech-clone";
import { Button } from "../../ui/button";
import { AbiNodeShell } from "../base/abi-node-shell";
import { NodeTextarea } from "../base/node-textarea";
import { SegmentDraftEditor } from "./segment-draft-editor";

const SplitTextNode = ({
    selected,
    data,
}: TongflowPluginNodeProps<"split-text", "splitTextNode">) => {
    const t = useTranslations("Workspace.nodes");
    const tBase = useTranslations("Workspace.nodes.base");
    const form = useAbiForm("split-text");
    const input = useEffectiveInputs("split-text", form.state);
    const nodeId = useNodeId();
    const params = data.pluginParams ?? {};
    const draft = segmentDraft(data);
    const patchParams = (patch: Record<string, unknown>) => {
        const flow = useFlow.getState();
        const node = flow.nodes.find((n) => n.id === nodeId);
        if (node)
            flow.updates(node.id, {
                ...node.data,
                pluginParams: {
                    ...(node.data.pluginParams as Record<string, unknown>),
                    ...patch,
                },
            });
    };

    return (
        <AbiNodeShell
            feature="split-text"
            form={form}
            selected={selected}
            data={data}
            title={t("titles.splitText")}
            icon={<Scissors className="h-5 w-5" />}
            executeLabel={tBase("execute")}
            executeDisabled={
                !input.prompts.some(
                    (p) => typeof p.text === "string" && p.text.trim(),
                )
            }
        >
            <div className="p-4 space-y-4">
                {draft && (
                    <>
                        <SegmentDraftEditor
                            draft={draft}
                            pending={data.outputPending === true}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            className="nodrag nowheel"
                            data-testid="create-batch-speech-clone"
                            disabled={
                                data.outputPending === true ||
                                !draft.reviewed ||
                                !canAdoptDraft(draft)
                            }
                            onClick={() => {
                                if (nodeId)
                                    createBatchSpeechClone(
                                        useFlow.getState,
                                        nodeId,
                                    );
                            }}
                        >
                            {t("segmentDraft.bulkClone", {
                                count: draft.segments.length,
                            })}
                        </Button>
                    </>
                )}
                <p className="text-xs text-muted-foreground">
                    {t("speechFlow.splitHint")}
                </p>
                {(!data.pluginId ||
                    data.pluginId === "tongflow-api-openai") && (
                    <div
                        className="space-y-2 nodrag nowheel"
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <label className="block text-sm">
                            {t("speechFlow.splitMode")}
                            <select
                                className="w-full rounded border p-1 bg-background"
                                value={String(params.split_mode ?? "speech")}
                                onChange={(e) =>
                                    patchParams({ split_mode: e.target.value })
                                }
                            >
                                <option value="speech">
                                    {t("speechFlow.forSpeech")}
                                </option>
                                <option value="general">
                                    {t("speechFlow.general")}
                                </option>
                            </select>
                        </label>
                        {params.split_mode !== "general" && (
                            <>
                                <label className="block text-sm">
                                    {t("speechFlow.profile")}
                                    <select
                                        className="w-full rounded border p-1 bg-background"
                                        value={String(
                                            params.speech_profile ??
                                                "qwen-audio-3.1",
                                        )}
                                        onChange={(e) =>
                                            patchParams({
                                                speech_profile: e.target.value,
                                            })
                                        }
                                    >
                                        <option value="qwen-audio-3.1">
                                            Qwen Audio 3.1 TTS-Next
                                        </option>
                                        <option value="custom">
                                            {t("speechFlow.customProfile")}
                                        </option>
                                    </select>
                                </label>
                                {(
                                    [
                                        [
                                            "target_seconds",
                                            45,
                                            10,
                                            90,
                                            5,
                                            "targetSeconds",
                                        ],
                                        [
                                            "chars_per_second",
                                            4,
                                            1,
                                            10,
                                            0.5,
                                            "speechRate",
                                        ],
                                        [
                                            "max_segment_chars",
                                            400,
                                            40,
                                            2900,
                                            10,
                                            "maxChars",
                                        ],
                                    ] as const
                                ).map(
                                    ([
                                        key,
                                        fallback,
                                        min,
                                        max,
                                        step,
                                        label,
                                    ]) => (
                                        <label
                                            key={key}
                                            className="flex items-center justify-between gap-3 text-sm"
                                        >
                                            {t(`speechFlow.${label}`)}
                                            <input
                                                aria-label={t(
                                                    `speechFlow.${label}`,
                                                )}
                                                type="number"
                                                min={min}
                                                max={max}
                                                step={step}
                                                value={Number(
                                                    params[key] ?? fallback,
                                                )}
                                                className="w-24 rounded border p-1 bg-background"
                                                onChange={(e) => {
                                                    if (e.target.value)
                                                        patchParams({
                                                            [key]: Number(
                                                                e.target.value,
                                                            ),
                                                        });
                                                }}
                                            />
                                        </label>
                                    ),
                                )}
                                <p className="text-xs text-muted-foreground">
                                    {t("speechFlow.durationHint")}
                                </p>
                            </>
                        )}
                    </div>
                )}
                <p className="text-xs text-muted-foreground">
                    {input
                        .sources("text")
                        .map((n) => n.data.label || n.id)
                        .join(", ") || t("speechFlow.connectText")}
                </p>
                <NodeTextarea
                    rows={3}
                    placeholder={t("common.enterInstructions")}
                    {...form.bind("userPrompt")}
                    className="min-h-[80px]"
                />
            </div>
        </AbiNodeShell>
    );
};

export default memo(SplitTextNode);
