import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

let sqlite: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/db", async () => ({
    ...(await import("@/db/schema")),
    getDb: async () => db,
}));

import { handleTaskCompletion } from "./completion";

describe("document text materials", () => {
    beforeEach(async () => {
        sqlite = new Database(":memory:");
        db = drizzle(sqlite, { schema });
        migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
        await db.insert(schema.tasks).values({
            id: "document-task",
            nodeId: "parse",
            feature: "parse-document",
            pluginId: "tongflow-api-openai",
            prompt: "{}",
            status: "processing",
        });
    });

    afterEach(() => sqlite.close());

    it("saves exact Chinese document text once and survives completion replay", async () => {
        const text = "  中文：“保留标点、空行和顺序！”🙂\r\n\r\n第二段。\r\n";
        const output = { success: true, feature: "parse-document", text };
        expect(
            await handleTaskCompletion("document-task", "COMPLETED", output),
        ).toMatchObject({ success: true, savedMaterials: 1 });
        expect(
            await handleTaskCompletion("document-task", "COMPLETED", output),
        ).toMatchObject({ success: true, savedMaterials: 0 });
        const materials = await db.select().from(schema.materials);
        expect(materials).toHaveLength(1);
        expect(materials[0]).toMatchObject({
            taskId: "document-task",
            type: "text",
            deleted: false,
        });
        expect(JSON.parse(materials[0].content)).toEqual({ texts: [text] });
        const [task] = await db.select().from(schema.tasks);
        expect(task.status).toBe("completed");
        expect(task.progress).toBe(100);
        expect(JSON.parse(task.result || "{}").text).toBe(text);
    });

    it("keeps a failed document out of the text library", async () => {
        const result = await handleTaskCompletion("document-task", "FAILED", {
            error: "Invalid DOCX",
        });
        expect(result).toMatchObject({ success: true, savedMaterials: 0 });
        expect(await db.select().from(schema.materials)).toHaveLength(0);
    });
});
