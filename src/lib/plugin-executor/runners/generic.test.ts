import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), notifyTask: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("@/lib/plugins/plugin-python-env.server", () => ({
    ensurePluginPython: async () => "unused-python",
}));
vi.mock("@/lib/plugins/plugins-registry.server", () => ({
    getPluginConfig: () => ({
        localSubdir: "test",
        methodsByNodeSlot: { "split-text": "split_text" },
    }),
}));
vi.mock("@/lib/plugins/python-lite", () => ({ PYTHON_UTF8_ENV: {} }));
vi.mock("@/lib/runtime/paths.server", () => ({
    pluginsDir: () => "/unused",
    resourcesDir: () => "/unused",
}));
vi.mock("@/lib/runtime/scope.server", () => ({
    getScope: async () => "",
    scopedDataDirFor: () => "/unused",
}));
vi.mock("@/lib/settings/env-store.server", () => ({
    withStoredEnv: async () => ({}),
}));
vi.mock("@/lib/task/emitter", () => ({ notifyTask: mocks.notifyTask }));

import { execPlugin } from "./generic";

describe("UTF-8 plugin output pipes", () => {
    beforeEach(() => vi.clearAllMocks());

    it("retains long Chinese output and emoji across byte boundaries and drains pipes after exit", async () => {
        const child = Object.assign(new EventEmitter(), {
            stdin: new PassThrough(),
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            kill: vi.fn(),
        });
        mocks.spawn.mockReturnValue(child);
        const inputFinished = finished(child.stdin, { readable: false });
        const result = execPlugin({
            pluginId: "test",
            nodeSlot: "split-text",
            taskId: "utf8-test",
            input: { text: "长篇中文。" },
            signal: new AbortController().signal,
        });
        await inputFinished;
        const text = "中文、标点与自然段落🙂。\n\n".repeat(6000);
        const output = Buffer.from(
            JSON.stringify({ success: true, texts: [text] }),
        );
        // Force every seven-byte pipe chunk to split multibyte characters.
        for (let i = 0; i < output.length; i += 7) {
            child.stdout.write(output.subarray(i, i + 7));
            if (i === 7) child.emit("exit", 0); // Stdio still has bytes to drain.
        }
        const progress = Buffer.from(
            '@@TF_PROGRESS@@{"message":"正在处理中文🙂","percent":75}\n',
        );
        for (const byte of progress) child.stderr.write(Buffer.from([byte]));
        child.stdout.end();
        child.stderr.end();
        await Promise.all([finished(child.stdout), finished(child.stderr)]);
        child.emit("close", 0);
        expect(await result).toEqual({ success: true, texts: [text] });
        expect(mocks.notifyTask).toHaveBeenCalledWith(
            "utf8-test",
            expect.any(String),
            { message: "正在处理中文🙂", percent: 75 },
        );
    });
});
