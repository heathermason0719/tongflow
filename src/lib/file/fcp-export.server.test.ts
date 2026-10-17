import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ openRead: vi.fn() }));
vi.mock("./storage.server", () => ({ getStorage: () => storage }));

import { prepareFcpAudioExport } from "./fcp-export.server";

const folder = mkdtempSync(path.join(os.tmpdir(), "tongflow-fcp-"));
function wav(streaming: boolean) {
    const frames = 2400,
        buffer = Buffer.alloc(44 + frames * 4);
    buffer.write("RIFF");
    buffer.writeUInt32LE(streaming ? 2147483583 : buffer.length - 8, 4);
    buffer.write("WAVEfmt ", 8);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(2, 22);
    buffer.writeUInt32LE(48000, 24);
    buffer.writeUInt32LE(192000, 28);
    buffer.writeUInt16LE(4, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(streaming ? 2147483547 : buffer.length - 44, 40);
    return buffer;
}
const ordinary = path.join(folder, "ordinary.wav"),
    streamed = path.join(folder, "streamed.wav");
writeFileSync(ordinary, wav(false));
writeFileSync(streamed, wav(true));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
describe("audio export preflight with actual ffprobe/ffmpeg", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });
    it("reads actual sample timing for ordinary and legacy streaming WAVs without rewriting", async () => {
        storage.openRead.mockImplementation(async (key: string) => ({
            localPath: key === "normal.wav" ? ordinary : streamed,
            size: wav(false).length,
        }));
        const result = await prepareFcpAudioExport("公开工程", [
            "streamed.wav",
            "normal.wav",
        ]);
        expect(
            result.clips.map((c) => [
                c.filename,
                c.duration,
                c.channels,
                c.sampleRate,
            ]),
        ).toEqual([
            ["01.wav", "1/20s", 2, 48000],
            ["02.wav", "1/20s", 2, 48000],
        ]);
        expect(readFileSync(streamed)).toEqual(wav(true));
        expect(readFileSync(ordinary)).toEqual(wav(false));
    });
    it("identifies the missing segment and stops without processing later sources", async () => {
        storage.openRead
            .mockResolvedValueOnce({
                localPath: ordinary,
                size: wav(false).length,
            })
            .mockRejectedValueOnce(
                Object.assign(new Error("private absolute source path"), {
                    code: "ENOENT",
                }),
            );
        await expect(
            prepareFcpAudioExport("x", [
                "first.wav",
                "missing.wav",
                "third.wav",
            ]),
        ).rejects.toThrow("第 2 段");
        expect(storage.openRead).toHaveBeenCalledTimes(2);
    });
    it("refuses unsupported audio formats before reading files", async () => {
        for (const extension of ["flac", "ogg", "oga", "opus"]) {
            await expect(
                prepareFcpAudioExport("FCP", [`unexpected.${extension}`]),
            ).rejects.toThrow("第 1 段无法导出：不是支持的本地音频文件");
        }
        expect(storage.openRead).not.toHaveBeenCalled();
    });
    it("allows Broadcast WAV extension without re-encoding the file", async () => {
        storage.openRead.mockResolvedValue({
            localPath: ordinary,
            size: wav(false).length,
        });
        const result = await prepareFcpAudioExport("FCP", ["recording.bwf"]);
        expect(result.clips[0]?.filename).toBe("01.bwf");
        expect(result.clips[0]?.duration).toBe("1/20s");
    });
    it("rejects corrupt and zero-length media", async () => {
        const broken = path.join(folder, "broken.wav");
        writeFileSync(broken, "not an audio file");
        storage.openRead.mockResolvedValue({ localPath: broken, size: 17 });
        await expect(
            prepareFcpAudioExport("x", ["broken.wav"]),
        ).rejects.toThrow("第 1 段无法导出：音频不可读取或格式损坏");
        storage.openRead.mockResolvedValue({ localPath: ordinary, size: 0 });
        await expect(prepareFcpAudioExport("x", ["empty.wav"])).rejects.toThrow(
            "音频文件为空",
        );
    });
});
