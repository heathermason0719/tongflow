import { useState } from "react";
import { useTranslations } from "use-intl";
import {
    chooseFcpExportDirectory,
    exportFcpProject,
} from "../../lib/file/fcp-export";
import { Button } from "../../ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";

export function FcpExportDialog({
    open,
    onOpenChange,
    fileKeys,
    defaultName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fileKeys: string[];
    defaultName: string;
}) {
    const t = useTranslations("Workspace.nodes.fcpExport");
    const [name, setName] = useState(defaultName);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");
    const [result, setResult] = useState<{
        folder: string;
        xmlFile: string;
        count: number;
    } | null>(null);
    const run = async () => {
        setError("");
        setResult(null);
        setBusy(true);
        setStatus(t("checking"));
        try {
            // Must be the first await after the click (Chrome user activation).
            const parent = await chooseFcpExportDirectory();
            setResult(
                await exportFcpProject(
                    name,
                    [...fileKeys],
                    parent,
                    (completed, total) =>
                        setStatus(t("progress", { completed, total })),
                ),
            );
            setStatus("");
        } catch (e) {
            setStatus("");
            if ((e as DOMException).name !== "AbortError")
                setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog
            open={open}
            onOpenChange={(value) => {
                if (!busy) onOpenChange(value);
            }}
        >
            <DialogContent
                data-testid="fcp-export-dialog"
                className="nodrag"
                onPointerDown={(e) => e.stopPropagation()}
            >
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                    <DialogDescription>
                        {t("description", { count: fileKeys.length })}
                    </DialogDescription>
                </DialogHeader>
                <Label htmlFor="fcp-project-name">{t("name")}</Label>
                <Input
                    id="fcp-project-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                />
                <p className="text-sm text-muted-foreground">
                    {t("locationHint")}
                </p>
                {status && (
                    <output data-testid="fcp-export-progress">{status}</output>
                )}
                {error && (
                    <p role="alert" className="text-sm text-red-600">
                        {error}
                    </p>
                )}
                {result && (
                    <output
                        data-testid="fcp-export-success"
                        className="text-sm break-all space-y-2"
                    >
                        <p>{t("success", { count: result.count })}</p>
                        <p>
                            {result.folder}/{result.xmlFile}
                        </p>
                        <p>{t("importHint")}</p>
                    </output>
                )}
                <DialogFooter>
                    <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => onOpenChange(false)}
                    >
                        {t("close")}
                    </Button>
                    <Button
                        disabled={busy || !name.trim() || !fileKeys.length}
                        onClick={() => void run()}
                    >
                        {busy ? t("exporting") : t("chooseAndExport")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
