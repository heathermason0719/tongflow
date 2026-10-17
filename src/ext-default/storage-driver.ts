import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { nanoid } from "nanoid";
import type { StorageDriver } from "@/lib/file/storage.server";
import { scopedDataDir } from "@/lib/runtime/scope.server";

/**
 * Default storage driver: files on the local disk under the scoped uploads
 * directory (`<scopedDataDir>/uploads/`) — the historical behavior. A
 * cloud shell substitutes e.g. an object-storage driver via
 * `src/ext/storage-driver.ts`.
 */

async function uploadsRoot(): Promise<string> {
    return path.join(await scopedDataDir(), "uploads");
}

export const storageDriver: StorageDriver = {
    async saveFile(data, ext, taskId) {
        const root = await uploadsRoot();
        const dir = taskId ? path.join(root, "tasks", taskId) : root;
        await mkdir(dir, { recursive: true });

        const filename = ext ? `${nanoid()}.${ext}` : nanoid();
        const filePath = path.join(dir, filename);
        await writeFile(filePath, data);

        // The fileKey is the path relative to the uploads root.
        return path.relative(root, filePath);
    },

    async readFile(fileKey) {
        return readFile(await resolveFile(fileKey));
    },

    async openRead(fileKey) {
        const resolved = await resolveFile(fileKey);
        const info = await stat(resolved);
        if (!info.isFile()) throw new Error("Not a file");
        return {
            size: info.size,
            stream: (start, end, signal) =>
                Readable.toWeb(
                    createReadStream(resolved, { start, end, signal }),
                ) as ReadableStream<Uint8Array>,
        };
    },
};

async function resolveFile(fileKey: string) {
    const root = await uploadsRoot();
    const normalized = fileKey.replace(/^\/+/, "").replace(/\\/g, "/");
    const resolved = path.resolve(
        root,
        ...normalized.split("/").filter(Boolean),
    );
    if (!resolved.startsWith(`${root}${path.sep}`))
        throw new Error("Invalid file key");
    return resolved;
}
