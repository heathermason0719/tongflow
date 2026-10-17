import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), fetch: vi.fn() }));
vi.mock("../api/client", () => ({ apiPost: mocks.prepare }));
vi.mock("../../host", () => ({ hostFetch: mocks.fetch }));
vi.mock("./url", () => ({
    getFileUrl: (key: string) => `/api/uploads/${key}`,
}));

import { exportFcpProject } from "./fcp-export";

interface TestDirectory {
    name: string;
    children: Map<string, TestDirectory>;
    files: Map<string, Uint8Array>;
    getDirectoryHandle(
        child: string,
        options?: { create?: boolean },
    ): Promise<TestDirectory>;
    getFileHandle: (filename: string) => Promise<unknown>;
    removeEntry(child: string): Promise<void>;
}
function directory(name = "destination"): TestDirectory {
    const children = new Map<string, TestDirectory>();
    const files = new Map<string, Uint8Array>();
    const handle: TestDirectory = {
        name,
        children,
        files,
        async getDirectoryHandle(
            child: string,
            options?: { create?: boolean },
        ) {
            if (!children.has(child)) {
                if (!options?.create)
                    throw new DOMException("Missing", "NotFoundError");
                children.set(child, directory(child));
            }
            return children.get(child)!;
        },
        async getFileHandle(filename: string) {
            return {
                async createWritable() {
                    const chunks: Uint8Array[] = [];
                    const stream = new WritableStream<Uint8Array>({
                        write(chunk) {
                            chunks.push(chunk);
                        },
                        close() {
                            files.set(
                                filename,
                                new Uint8Array(Buffer.concat(chunks)),
                            );
                        },
                    });
                    return Object.assign(stream, {
                        async write(text: string) {
                            const writer = stream.getWriter();
                            await writer.write(new TextEncoder().encode(text));
                            writer.releaseLock();
                        },
                        async close() {
                            const writer = stream.getWriter();
                            await writer.close();
                            writer.releaseLock();
                        },
                    });
                },
            };
        },
        async removeEntry(child: string) {
            children.delete(child);
        },
    };
    return handle;
}
describe("directory export", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.prepare.mockResolvedValue({
            name: "公开测试",
            clips: [1, 2, 3].map((i) => ({
                fileKey: `key${i}.wav`,
                filename: `0${i}.wav`,
                bytes: 3,
                duration: "1s",
                sampleRate: 48000,
                channels: 2,
            })),
        });
        mocks.fetch.mockImplementation(
            () => new Response(new Uint8Array([1, 2, 3])),
        );
    });
    it("writes exact independent bytes, XML last, and preserves earlier exports", async () => {
        const parent = directory();
        const first = await exportFcpProject(
            "公开测试",
            ["a", "b", "c"],
            parent as unknown as FileSystemDirectoryHandle,
            vi.fn(),
        );
        const second = await exportFcpProject(
            "公开测试",
            ["a", "b", "c"],
            parent as unknown as FileSystemDirectoryHandle,
            vi.fn(),
        );
        expect(first.folder).toBe("destination/公开测试");
        expect(second.folder).toBe("destination/公开测试 (2)");
        const output = parent.children.get("公开测试")!;
        expect([...output.children.get("Audio")!.files.keys()]).toEqual([
            "01.wav",
            "02.wav",
            "03.wav",
        ]);
        expect([...output.children.get("Audio")!.files.values()]).toEqual(
            [1, 2, 3].map(() => new Uint8Array([1, 2, 3])),
        );
        expect(
            new TextDecoder().decode(output.files.get("公开测试.fcpxml")),
        ).toContain('ref="a3"');
    });
    it("does not create a project when any source fails preflight", async () => {
        const parent = directory();
        mocks.prepare.mockRejectedValue(new Error("第 2 段不存在"));
        await expect(
            exportFcpProject(
                "x",
                ["a", "b"],
                parent as unknown as FileSystemDirectoryHandle,
                vi.fn(),
            ),
        ).rejects.toThrow("第 2 段");
        expect(parent.children.size).toBe(0);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("removes only this incomplete attempt after a truncated transfer", async () => {
        const parent = directory();
        parent.children.set("公开测试", directory("公开测试"));
        mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array([1])));
        await expect(
            exportFcpProject(
                "x",
                ["a"],
                parent as unknown as FileSystemDirectoryHandle,
                vi.fn(),
            ),
        ).rejects.toThrow("第 1 段文件不完整");
        expect([...parent.children.keys()]).toEqual(["公开测试"]);
    });
});
