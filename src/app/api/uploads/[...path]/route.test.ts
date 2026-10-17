import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
    readFile: vi.fn(),
    publicUrl: vi.fn(),
    openRead: undefined as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock("@/lib/file/storage.server", () => ({ getStorage: () => storage }));

import { GET, HEAD } from "./route";

const bytes = Buffer.from("RIFF-existing-audio-bytes");

function get(query = "", file = "tasks/example/source.wav") {
    return GET(
        new NextRequest(`http://localhost/api/uploads/${file}${query}`),
        {
            params: Promise.resolve({ path: file.split("/") }),
        },
    );
}

describe("uploaded media downloads", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        storage.openRead = undefined;
        storage.readFile.mockResolvedValue(bytes);
        storage.publicUrl.mockResolvedValue(null);
    });

    it("keeps preview bytes and MIME available without forcing an attachment", async () => {
        const response = await get();
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("audio/wav");
        expect(response.headers.has("Content-Disposition")).toBe(false);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    });

    it("downloads identical bytes with a UTF-8 filename and the stored extension", async () => {
        const response = await get(
            `?download=${encodeURIComponent("中文旁白.mp3")}`,
        );
        expect(response.headers.get("Content-Disposition")).toBe(
            `attachment; filename="download.wav"; filename*=UTF-8''${encodeURIComponent("中文旁白.wav")}`,
        );
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    });

    it("streams attachments from remote storage instead of redirecting to a player", async () => {
        storage.publicUrl.mockResolvedValue(
            "https://storage.example/source.wav",
        );
        const response = await get("?download=audio.wav");
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Disposition")).toMatch(
            /^attachment;/,
        );
        expect(storage.publicUrl).not.toHaveBeenCalled();
        expect(storage.readFile).toHaveBeenCalledWith(
            "tasks/example/source.wav",
        );
    });

    it("retains remote redirects for preview requests", async () => {
        storage.publicUrl.mockResolvedValue(
            "https://storage.example/source.wav",
        );
        const response = await get();
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe(
            "https://storage.example/source.wav",
        );
        expect(storage.readFile).not.toHaveBeenCalled();
    });

    it("sanitizes download names and permits an empty download flag", async () => {
        for (const name of [
            "",
            '../bad\r\n"name.mp3',
            "C:\\folder\\clip.wav",
        ]) {
            const response = await get(`?download=${encodeURIComponent(name)}`);
            expect(response.status).toBe(200);
            const disposition = response.headers.get("Content-Disposition");
            expect(disposition).toMatch(/^attachment;/);
            expect(disposition).not.toMatch(/[\r\n\\]/);
        }
    });

    it("returns 404 without an attachment for a missing file", async () => {
        storage.readFile.mockRejectedValue(new Error("Missing file"));
        const response = await get("?download=audio.wav");
        expect(response.status).toBe(404);
        expect(response.headers.has("Content-Disposition")).toBe(false);
    });
});

describe("seekable media", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        storage.openRead = undefined;
        storage.readFile.mockResolvedValue(bytes);
        storage.publicUrl.mockResolvedValue(null);
    });
    it("returns only requested bytes, clamped ends and suffixes", async () => {
        storage.readFile.mockResolvedValue(bytes);
        storage.publicUrl.mockResolvedValue(null);
        for (const [range, start, end] of [
            ["bytes=0-3", 0, 3],
            ["bytes=5-", 5, bytes.length - 1],
            ["bytes=-4", bytes.length - 4, bytes.length - 1],
            ["bytes=2-9999", 2, bytes.length - 1],
        ] as const) {
            const response = await GET(
                new NextRequest("http://localhost/api/uploads/source.wav", {
                    headers: { Range: range },
                }),
                { params: Promise.resolve({ path: ["source.wav"] }) },
            );
            expect(response.status).toBe(206);
            expect(response.headers.get("Content-Length")).toBe(
                String(end - start + 1),
            );
            expect(response.headers.get("Content-Range")).toBe(
                `bytes ${start}-${end}/${bytes.length}`,
            );
            expect(Buffer.from(await response.arrayBuffer())).toEqual(
                bytes.subarray(start, end + 1),
            );
        }
    });
    it("reports unsatisfiable ranges without sending the media", async () => {
        for (const range of [
            "bytes=9999-",
            "bytes=9-2",
            "bytes=-0",
            "bytes=-",
            "bytes=0-1,4-5",
        ]) {
            const response = await GET(
                new NextRequest("http://localhost/api/uploads/source.wav", {
                    headers: { Range: range },
                }),
                { params: Promise.resolve({ path: ["source.wav"] }) },
            );
            expect(response.status).toBe(416);
            expect(response.headers.get("Content-Range")).toBe(
                `bytes */${bytes.length}`,
            );
            expect((await response.arrayBuffer()).byteLength).toBe(0);
        }
    });
    it("supports HEAD for download checks without sending an audio body", async () => {
        const response = await HEAD(
            new NextRequest(
                "http://localhost/api/uploads/source.wav?download=voice.wav",
                { method: "HEAD" },
            ),
            { params: Promise.resolve({ path: ["source.wav"] }) },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Length")).toBe(
            String(bytes.length),
        );
        expect(response.headers.get("Content-Disposition")).toMatch(
            /^attachment;/,
        );
        expect((await response.arrayBuffer()).byteLength).toBe(0);
    });
    it("uses the storage stream, propagates cancellation and never buffers the file", async () => {
        const cancelled = vi.fn();
        const stream = vi.fn(
            () => new ReadableStream<Uint8Array>({ cancel: cancelled }),
        );
        storage.openRead = vi
            .fn()
            .mockResolvedValue({ size: 100000000, stream });
        const request = new NextRequest(
            "http://localhost/api/uploads/source.wav",
            {
                headers: { Range: "bytes=20-43" },
            },
        );
        const response = await GET(request, {
            params: Promise.resolve({ path: ["source.wav"] }),
        });
        expect(response.status).toBe(206);
        expect(response.headers.get("Content-Length")).toBe("24");
        expect(stream).toHaveBeenCalledWith(20, 43, request.signal);
        expect(storage.readFile).not.toHaveBeenCalled();
        await response.body?.cancel();
        expect(cancelled).toHaveBeenCalledOnce();
    });
    it("checks streaming storage with HEAD without opening the byte stream", async () => {
        const stream = vi.fn();
        storage.openRead = vi
            .fn()
            .mockResolvedValue({ size: 100000000, stream });
        const response = await HEAD(
            new NextRequest("http://localhost/api/uploads/source.wav", {
                method: "HEAD",
            }),
            {
                params: Promise.resolve({ path: ["source.wav"] }),
            },
        );
        expect(response.headers.get("Content-Length")).toBe("100000000");
        expect(stream).not.toHaveBeenCalled();
        expect(storage.readFile).not.toHaveBeenCalled();
    });
});
