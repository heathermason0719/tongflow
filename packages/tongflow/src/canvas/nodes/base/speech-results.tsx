import { useState } from "react";
import { useTranslations } from "use-intl";
import { type BaseNodeData, numberedAudioFilename } from "../../../core";
import { downloadFile } from "../../lib/file/download";
import { getFileUrl } from "../../lib/file/url";
import { Button } from "../../ui/button";

export interface SpeechResult {
    text: string;
    refAudio: string;
    status: string;
    audio?: string;
    error?: string;
}

export function SpeechResults({
    data,
    signature,
}: {
    data: BaseNodeData;
    signature: string;
}) {
    const t = useTranslations("Workspace.nodes.speechFlow");
    const [errors, setErrors] = useState<Record<number, string>>({});
    const [downloading, setDownloading] = useState<Set<number>>(new Set());
    const results = data.speechResults as SpeechResult[] | undefined;
    if (!results?.length) return null;
    const current = signature === data.speechInputSignature;
    return (
        <div
            className="mx-4 mb-4 max-h-[480px] overflow-y-auto space-y-2 nodrag nowheel"
            data-testid="speech-results"
            onPointerDown={(e) => e.stopPropagation()}
        >
            <p
                className={
                    current ? "text-sm font-medium" : "text-sm text-amber-600"
                }
            >
                {t(current ? "results" : "historicalResults")}
            </p>
            {results.map((row, i) => (
                <div
                    key={i}
                    className="p-3 border rounded-md space-y-2"
                    data-testid="speech-result-row"
                >
                    <p className="text-xs text-muted-foreground">
                        {i + 1} ·{" "}
                        {t(
                            row.status === "COMPLETED"
                                ? "completed"
                                : row.status === "FAILED" ||
                                    row.status === "CANCELLED"
                                  ? "failed"
                                  : "pending",
                        )}
                    </p>
                    <p className="text-sm whitespace-pre-wrap">{row.text}</p>
                    <p className="text-xs text-muted-foreground break-all">
                        {t("reference")}: {row.refAudio}
                    </p>
                    {row.audio && (
                        <>
                            <audio
                                controls
                                preload="none"
                                src={getFileUrl(row.audio)}
                                className="w-full"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={downloading.has(i)}
                                aria-busy={downloading.has(i)}
                                onClick={() => {
                                    setDownloading((current) =>
                                        new Set(current).add(i),
                                    );
                                    setErrors((current) => ({
                                        ...current,
                                        [i]: "",
                                    }));
                                    void downloadFile(
                                        getFileUrl(row.audio!),
                                        row.audio!,
                                        numberedAudioFilename(
                                            i,
                                            row.audio!,
                                            results.length,
                                        ),
                                    )
                                        .catch((e) =>
                                            setErrors((current) => ({
                                                ...current,
                                                [i]: String(e),
                                            })),
                                        )
                                        .finally(() =>
                                            setDownloading((current) => {
                                                const next = new Set(current);
                                                next.delete(i);
                                                return next;
                                            }),
                                        );
                                }}
                            >
                                {t("download")}
                            </Button>
                        </>
                    )}
                    {errors[i] && (
                        <p role="alert" className="text-xs text-red-600">
                            {errors[i]}
                        </p>
                    )}
                    {row.error && (
                        <p className="text-xs text-red-600">{row.error}</p>
                    )}
                </div>
            ))}
        </div>
    );
}
