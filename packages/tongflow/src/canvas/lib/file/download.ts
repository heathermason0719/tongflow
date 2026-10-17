import { getCanvasHost, hostFetch } from "../../host";

/** Download bytes instead of navigating to a browser media player.
 * Blob URLs also support cross-origin media when its server allows fetching.
 */
export async function downloadFile(
    url: string,
    fileKey: string,
    suggestedName?: string,
): Promise<void> {
    const target = new URL(url, window.location.href);
    const filename =
        suggestedName ??
        decodeURIComponent(
            new URL(fileKey, window.location.href).pathname.split("/").pop() ||
                "audio",
        );
    // Local attachments go straight to Chrome's streaming download manager.
    // Avoid holding every multi-megabyte WAV twice (Blob + object URL) in JS.
    if (
        !getCanvasHost().fetch &&
        target.origin === window.location.origin &&
        target.pathname.startsWith("/api/uploads/")
    ) {
        target.searchParams.set("download", filename);
        const check = await hostFetch(target.href, {
            method: "HEAD",
            signal: AbortSignal.timeout(30_000),
        });
        if (!check.ok) throw new Error(`Download failed: HTTP ${check.status}`);
        const link = document.createElement("a");
        link.href = target.href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
    }
    const response = await hostFetch(url);
    if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    // URL paths exclude signed query strings, which are not file extensions.
    link.download = filename;
    link.href = objectUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser time to start consuming the download before releasing.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
