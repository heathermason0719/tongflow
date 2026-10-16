/**
 * GET /api/uploads/[...path]
 * Serve uploaded files via the storage driver (local disk by default).
 */

import path from "node:path";
import { type NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/file/storage.server";

const MIME_TYPES: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".json": "application/json",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: Remove HTTP header control characters from suggested filenames.
const UNSAFE_FILENAME_CHARACTERS = /[\x00-\x1f\x7f"<>:|?*]/g;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> },
) {
    try {
        const { path: pathSegments } = await params;
        const fileKey = pathSegments.join("/");
        const driver = getStorage();
        const download = request.nextUrl.searchParams.get("download");

        // Remote drivers can hand out a directly-fetchable URL (e.g. a
        // presigned object-storage URL) so media bytes bypass the app.
        // An attachment response must carry its own headers, including when
        // the storage backend normally redirects to a signed media URL.
        const directUrl =
            download === null ? await driver.publicUrl?.(fileKey) : null;
        if (directUrl) {
            return NextResponse.redirect(directUrl, {
                status: 302,
                // Shorter than the signed URL's TTL so cached redirects
                // never point at an expired signature.
                headers: { "Cache-Control": "private, max-age=3300" },
            });
        }

        const buffer = await driver.readFile(fileKey);
        const ext = path.extname(fileKey).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
        };
        if (download !== null) {
            // Keep the stored extension: a suggested name must not rename a
            // WAV into an MP3. Strip paths, controls and header delimiters.
            const suggested = path.posix.basename(download.replace(/\\/g, "/"));
            const stem =
                path
                    .parse(suggested)
                    .name.replace(UNSAFE_FILENAME_CHARACTERS, "_")
                    .slice(0, 120) || "download";
            const filename = `${stem}${ext}`;
            const encoded = encodeURIComponent(filename).replace(
                /['()*]/g,
                (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
            );
            headers["Content-Disposition"] =
                `attachment; filename="download${ext}"; filename*=UTF-8''${encoded}`;
            headers["Cache-Control"] = "private, no-store";
        }

        return new NextResponse(new Uint8Array(buffer), {
            headers,
        });
    } catch (_error) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
}
