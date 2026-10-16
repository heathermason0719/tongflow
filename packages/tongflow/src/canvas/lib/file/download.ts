import { hostFetch } from "../../host";

/** Download bytes instead of navigating to a browser media player.
 * Blob URLs also support cross-origin media when its server allows fetching.
 */
export async function downloadFile(
    url: string,
    fileKey: string,
): Promise<void> {
    const response = await hostFetch(url);
    if (!response.ok) {
        throw new Error(`Download failed: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    // URL paths exclude signed query strings, which are not file extensions.
    const pathname = new URL(fileKey, window.location.href).pathname;
    link.download = decodeURIComponent(pathname.split("/").pop() || "audio");
    link.href = objectUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser time to start consuming the download before releasing.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
