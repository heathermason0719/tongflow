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

async function serve(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> },
    head = false,
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

        const source = driver.openRead
            ? await driver.openRead(fileKey)
            : await (async () => {
                  const buffer = await driver.readFile(fileKey);
                  return {
                      size: buffer.length,
                      stream: (start: number, end: number) =>
                          new ReadableStream<Uint8Array>({
                              start(controller) {
                                  controller.enqueue(
                                      new Uint8Array(
                                          buffer.subarray(start, end + 1),
                                      ),
                                  );
                                  controller.close();
                              },
                          }),
                  };
              })();
        const ext = path.extname(fileKey).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
            "Content-Length": String(source.size),
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

        const range =
            !head && !request.headers.has("if-range")
                ? request.headers.get("range")
                : null;
        let start = 0,
            end = source.size - 1;
        if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            const first = match?.[1] ? Number(match[1]) : undefined;
            const last = match?.[2] ? Number(match[2]) : undefined;
            if (
                !match ||
                (first === undefined && last === undefined) ||
                (first !== undefined && !Number.isSafeInteger(first)) ||
                (last !== undefined && !Number.isSafeInteger(last)) ||
                !source.size ||
                (first === undefined && !last)
            ) {
                return new NextResponse(null, {
                    status: 416,
                    headers: {
                        ...headers,
                        "Content-Range": `bytes */${source.size}`,
                        "Content-Length": "0",
                    },
                });
            }
            start = first ?? Math.max(0, source.size - (last ?? 0));
            end =
                first === undefined
                    ? source.size - 1
                    : Math.min(last ?? end, end);
            if (start > end || start >= source.size) {
                return new NextResponse(null, {
                    status: 416,
                    headers: {
                        ...headers,
                        "Content-Range": `bytes */${source.size}`,
                        "Content-Length": "0",
                    },
                });
            }
            headers["Content-Range"] = `bytes ${start}-${end}/${source.size}`;
            headers["Content-Length"] = String(end - start + 1);
        }
        return new NextResponse(
            head || !source.size
                ? null
                : source.stream(start, end, request.signal),
            {
                status: range ? 206 : 200,
                headers,
            },
        );
    } catch (_error) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ path: string[] }> },
) {
    return serve(request, context);
}

export async function HEAD(
    request: NextRequest,
    context: { params: Promise<{ path: string[] }> },
) {
    return serve(request, context, true);
}
