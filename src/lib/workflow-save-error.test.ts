import { describe, expect, it } from "vitest";
import { workflowSaveFailure } from "./workflow-save-error";

describe("save failure diagnostics", () => {
    it("provides an actionable reference without exposing SQL payloads", () => {
        const error = new Error("insert query with PRIVATE_SCRIPT", {
            cause: { code: "SQLITE_BUSY", parameters: "PRIVATE_SCRIPT" },
        });
        const response = workflowSaveFailure(error);
        expect(response.code).toBe("SQLITE_BUSY");
        expect(response.requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(response.error).toContain(response.requestId);
        expect(JSON.stringify(response)).not.toContain("PRIVATE_SCRIPT");
    });
});
