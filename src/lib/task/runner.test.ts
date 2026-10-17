import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/workspace.schema";

const state = vi.hoisted(() => ({
    db: null as unknown,
    execute: vi.fn(),
    notify: vi.fn(),
    missing: vi.fn(),
}));
vi.mock("@/db", async () => ({
    ...(await import("@/db/workspace.schema")),
    getDb: () => state.db,
}));
vi.mock("@/lib/plugin-executor/execute", () => ({
    executePlugin: state.execute,
}));
vi.mock("@/lib/plugin-executor/prepare-asset-input.server", () => ({
    prepareAssetInput: (_: unknown, input: unknown) => input,
}));
vi.mock("@/lib/plugins/missing-env-key", () => ({
    findMissingRequiredKey: state.missing,
}));
vi.mock("@/lib/plugins/plugin-env-manifests.server", () => ({
    loadPluginEnvDecls: () => [],
}));
vi.mock("@/lib/settings/env-store.server", () => ({
    loadEnvStore: () => ({}),
}));
vi.mock("./completion", () => ({ handleTaskCompletion: vi.fn() }));
vi.mock("./engine-delegate.server", () => ({
    executeWorkflowViaEngine: vi.fn(),
}));
vi.mock("./emitter", () => ({
    notifyTask: state.notify,
    registerTask: () => new AbortController(),
    removeTask: vi.fn(),
}));

import { dispatchTask } from "./runner";

describe("durable dispatch ownership", () => {
    let sqlite: InstanceType<typeof Database>;
    let db: ReturnType<typeof drizzle<typeof schema>>;
    beforeEach(() => {
        vi.resetAllMocks();
        sqlite = new Database(":memory:");
        db = drizzle(sqlite, { schema });
        migrate(db, { migrationsFolder: "drizzle" });
        state.db = db;
        state.execute.mockResolvedValue({
            success: true,
            audio: { file_key: "public-test.wav" },
        });
    });
    afterEach(() => sqlite.close());
    function insert(
        id: string,
        status = "pending",
        feature = "text-gen-speech-clone",
    ) {
        db.insert(schema.tasks)
            .values({
                id,
                nodeId: "voice",
                feature,
                pluginId: "test-plugin",
                prompt: JSON.stringify({ text: "公开模拟文案" }),
                status,
            })
            .run();
    }
    function row(id: string) {
        return db
            .select()
            .from(schema.tasks)
            .all()
            .find((task) => task.id === id)!;
    }
    it("claims once, persists before completion, and never regenerates on replay", async () => {
        insert("done");
        state.notify.mockImplementation((id, status) => {
            if (status === "COMPLETED")
                expect(row(id).status).toBe("completed");
        });
        await Promise.all([
            dispatchTask("done"),
            dispatchTask("done"),
            dispatchTask("done"),
        ]);
        await dispatchTask("done");
        expect(state.execute).toHaveBeenCalledOnce();
        expect(JSON.parse(row("done").result!).audio.file_key).toBe(
            "public-test.wav",
        );
    });
    it("does not take ownership of already running or cancelled tasks", async () => {
        insert("running", "processing");
        insert("cancelled", "cancelled");
        await Promise.all([dispatchTask("running"), dispatchTask("cancelled")]);
        expect(state.execute).not.toHaveBeenCalled();
        expect(row("cancelled").status).toBe("cancelled");
    });
    it("persists preflight failures before publishing them for later recovery", async () => {
        insert("missing-key");
        state.missing.mockReturnValue({ key: "TEST_API_KEY" });
        state.notify.mockImplementation((id, status) => {
            if (status === "FAILED") expect(row(id).status).toBe("failed");
        });
        await dispatchTask("missing-key");
        expect(state.execute).not.toHaveBeenCalled();
        expect(JSON.parse(row("missing-key").error!).errorCode).toBe(
            "missing_api_key",
        );
    });
    it("settles invalid workflow records durably instead of leaving processing", async () => {
        insert("invalid-flow", "pending", "workflow");
        await dispatchTask("invalid-flow");
        expect(row("invalid-flow").status).toBe("failed");
        expect(JSON.parse(row("invalid-flow").error!).errorCode).toBe(
            "workflow_invalid",
        );
    });
});
