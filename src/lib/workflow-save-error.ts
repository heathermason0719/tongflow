import { randomUUID } from "node:crypto";

/** Diagnostic reference without reflecting SQL parameters or private scripts. */
export function workflowSaveFailure(error: unknown) {
    const requestId = randomUUID();
    const cause =
        error instanceof Error
            ? (error as Error & { cause?: unknown }).cause
            : undefined;
    const code =
        cause && typeof cause === "object" && "code" in cause
            ? String(cause.code)
            : error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "WORKFLOW_SAVE_FAILED";
    return {
        error: `Workflow save failed (${code}); reference: ${requestId}`,
        code,
        requestId,
    };
}
