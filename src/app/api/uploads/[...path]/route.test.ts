import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
    readFile: vi.fn(),
    publicUrl: vi.fn(),
}));
vi.mock("@/lib/file/storage.server", () => ({ getStorage: () => storage }));

import { GET } from "./route";

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
