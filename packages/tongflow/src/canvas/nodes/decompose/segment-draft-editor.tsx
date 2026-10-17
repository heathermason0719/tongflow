import { useNodeId } from "@xyflow/react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import {
    canAdoptDraft,
    draftDifference,
    type SegmentDraft,
} from "../../../core";
import useFlow from "../../hooks/use-flow";
import { updateSplitDraft } from "../../lib/task/publish-output";
import { Button } from "../../ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "../../ui/dialog";

export function SegmentDraftEditor({
    draft,
    pending,
}: {
    draft: SegmentDraft;
    pending: boolean;
}) {
    const t = useTranslations("Workspace.nodes.segmentDraft");
    const nodeId = useNodeId();
    const [open, setOpen] = useState(false);
    const editors = useRef(new Map<number, HTMLTextAreaElement>());
    const modelDiff = draftDifference(draft.source, draft.proposal);
    const currentDiff = draftDifference(draft.source, draft.segments);
    const save = (
        segments: string[] | ((current: string[]) => string[]),
        reviewed = false,
    ) => {
        if (!nodeId || pending) return;
        const node = useFlow.getState().nodes.find((n) => n.id === nodeId);
        // Always patch the newest draft, including edits made since this render.
        const current = node?.data.segmentDraft as SegmentDraft | undefined;
        if (current)
            updateSplitDraft(nodeId, {
                ...current,
                segments: reviewed
                    ? [...current.segments]
                    : typeof segments === "function"
                      ? segments(current.segments)
                      : segments,
                reviewed,
            });
    };
    const move = (index: number, delta: number) =>
        save((current) => {
            const segments = [...current];
            [segments[index], segments[index + delta]] = [
                segments[index + delta],
                segments[index],
            ];
            return segments;
        });
    const reviewButton = (
        <Button
            data-testid="adopt-segment-draft"
            disabled={pending || !canAdoptDraft(draft) || draft.reviewed}
            onClick={() => save([...draft.segments], true)}
        >
            {t(draft.reviewed ? "adopted" : "adopt")}
        </Button>
    );
    return (
        <div className="space-y-2 nodrag nowheel" data-testid="segment-draft">
            <output className="block text-sm font-medium">
                {t(draft.reviewed ? "ready" : "needsReview", {
                    count: draft.segments.length,
                })}
            </output>
            {modelDiff.changed && (
                <p
                    role="alert"
                    className="text-sm text-amber-700 dark:text-amber-400"
                >
                    {t("modelChanged")}
                </p>
            )}
            <div
                className="max-h-48 overflow-auto space-y-2 text-sm whitespace-pre-wrap"
                data-testid="draft-preview"
            >
                {draft.segments.map((text, i) => (
                    <p key={`${i}-${text}`}>
                        <strong>{i + 1}. </strong>
                        {text}
                    </p>
                ))}
            </div>
            <Button variant="outline" onClick={() => setOpen(true)}>
                {t("edit")}
            </Button>
            {reviewButton}
            <p className="text-xs text-muted-foreground">{t("retained")}</p>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent
                    className="sm:max-w-6xl max-h-[90vh] overflow-auto nodrag nowheel bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                    data-testid="draft-editor"
                >
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>{t("description")}</DialogDescription>
                    <div className="grid md:grid-cols-2 gap-6">
                        <section className="space-y-3 min-w-0">
                            <h3 className="font-medium">{t("original")}</h3>
                            <pre
                                data-testid="draft-original"
                                className="whitespace-pre-wrap break-words text-sm max-h-80 overflow-auto border rounded p-3"
                            >
                                {draft.source}
                            </pre>
                            <details open={modelDiff.changed}>
                                <summary>{t("modelComparison")}</summary>
                                <p className="text-sm my-2">
                                    {t(
                                        modelDiff.changed
                                            ? "changedRange"
                                            : "unchanged",
                                    )}
                                </p>
                                {modelDiff.changed && (
                                    <div
                                        className="text-sm whitespace-pre-wrap break-words border rounded p-3"
                                        data-testid="model-difference"
                                    >
                                        <p>
                                            {t("removed")}{" "}
                                            <del className="bg-red-100 text-red-900">
                                                {modelDiff.removed || t("none")}
                                            </del>
                                        </p>
                                        <p>
                                            {t("added")}{" "}
                                            <ins className="bg-green-100 text-green-900">
                                                {modelDiff.added || t("none")}
                                            </ins>
                                        </p>
                                    </div>
                                )}
                                <pre
                                    data-testid="model-proposal"
                                    className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-auto"
                                >
                                    {draft.proposal
                                        .map((s, i) => `${i + 1}. ${s}`)
                                        .join("\n\n")}
                                </pre>
                            </details>
                            <p className="text-sm">
                                {t(
                                    currentDiff.changed
                                        ? "draftChanged"
                                        : "unchanged",
                                )}
                            </p>
                        </section>
                        <section className="space-y-3 min-w-0">
                            <h3 className="font-medium">
                                {t("current", { count: draft.segments.length })}
                            </h3>
                            <fieldset disabled={pending} className="space-y-3">
                                {draft.segments.map((text, index) => (
                                    <div
                                        key={index}
                                        className="border rounded p-3 space-y-2"
                                        data-testid="draft-segment"
                                    >
                                        <label
                                            className="block text-sm"
                                            htmlFor={`draft-${nodeId}-${index}`}
                                        >
                                            {t("segment", { index: index + 1 })}
                                            <DraftTextarea
                                                id={`draft-${nodeId}-${index}`}
                                                aria-label={t("segment", {
                                                    index: index + 1,
                                                })}
                                                className="w-full min-h-28 rounded border p-2 bg-background"
                                                value={text}
                                                elementRef={(element) => {
                                                    if (element)
                                                        editors.current.set(
                                                            index,
                                                            element,
                                                        );
                                                    else
                                                        editors.current.delete(
                                                            index,
                                                        );
                                                }}
                                                onChange={(e) =>
                                                    save((segments) =>
                                                        segments.map((s, i) =>
                                                            i === index
                                                                ? e.target.value
                                                                : s,
                                                        ),
                                                    )
                                                }
                                            />
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={index === 0}
                                                onClick={() => move(index, -1)}
                                            >
                                                {t("up")}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={
                                                    index ===
                                                    draft.segments.length - 1
                                                }
                                                onClick={() => move(index, 1)}
                                            >
                                                {t("down")}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    const cursor =
                                                        editors.current.get(
                                                            index,
                                                        )?.selectionStart ?? 0;
                                                    if (
                                                        cursor <= 0 ||
                                                        cursor >= text.length
                                                    )
                                                        return;
                                                    save((segments) => [
                                                        ...segments.slice(
                                                            0,
                                                            index,
                                                        ),
                                                        segments[index].slice(
                                                            0,
                                                            cursor,
                                                        ),
                                                        segments[index].slice(
                                                            cursor,
                                                        ),
                                                        ...segments.slice(
                                                            index + 1,
                                                        ),
                                                    ]);
                                                }}
                                            >
                                                {t("split")}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={
                                                    index ===
                                                    draft.segments.length - 1
                                                }
                                                onClick={() =>
                                                    save((segments) => [
                                                        ...segments.slice(
                                                            0,
                                                            index,
                                                        ),
                                                        segments[index] +
                                                            segments[index + 1],
                                                        ...segments.slice(
                                                            index + 2,
                                                        ),
                                                    ])
                                                }
                                            >
                                                {t("merge")}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() =>
                                                    save((segments) =>
                                                        segments.filter(
                                                            (_, i) =>
                                                                i !== index,
                                                        ),
                                                    )
                                                }
                                            >
                                                {t("delete")}
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                <Button
                                    variant="outline"
                                    onClick={() =>
                                        save((segments) => [...segments, ""])
                                    }
                                >
                                    {t("add")}
                                </Button>
                            </fieldset>
                            {!canAdoptDraft(draft) && (
                                <p
                                    role="alert"
                                    className="text-sm text-amber-700"
                                >
                                    {t("empty")}
                                </p>
                            )}
                            <output className="block">
                                {t(draft.reviewed ? "ready" : "needsReview", {
                                    count: draft.segments.length,
                                })}
                            </output>
                            {reviewButton}
                            <Button
                                variant="outline"
                                onClick={() => setOpen(false)}
                            >
                                {t("close")}
                            </Button>
                        </section>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

/** Keep the typing buffer local: ReactFlow props arrive on its render schedule.
 * Binding directly to those delayed props resets the caret during mid-text input.
 */
function DraftTextarea({
    value,
    onChange,
    elementRef,
    ...props
}: {
    value: string;
    id: string;
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
    elementRef: (element: HTMLTextAreaElement | null) => void;
    "aria-label": string;
    className: string;
}) {
    const [text, setText] = useState(value);
    const element = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => {
        if (document.activeElement !== element.current) setText(value);
    }, [value]);
    return (
        <textarea
            {...props}
            value={text}
            ref={(node) => {
                element.current = node;
                elementRef(node);
            }}
            onChange={(event) => {
                setText(event.target.value);
                onChange(event);
            }}
        />
    );
}
