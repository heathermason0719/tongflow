import type { BatchTaskEntry } from "../../hooks/use-task";
import type { TaskRecord } from "../api/task";

export interface SavedTaskBatch {
    signature: string;
    entries: BatchTaskEntry[];
}

function canonical(value: unknown): string {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return JSON.stringify(
            Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
            ),
        );
    }
    return JSON.stringify(value);
}

/** Records arrive newest first. Batch metadata is authoritative; legacy rows
 * can be recovered only by matching every expected business input exactly. */
export function recoverBatch(
    records: TaskRecord[],
    expected: {
        feature: string;
        pluginId: string;
        model?: string;
        params?: Record<string, unknown>;
        prompts: Record<string, unknown>[];
    },
):
    | { entries: BatchTaskEntry[]; matchesCurrent: boolean; signature?: string }
    | undefined {
    const candidates = records.filter(
        (row) =>
            row.feature === expected.feature &&
            row.pluginId === expected.pluginId,
    );
    if (!candidates.length) return undefined;
    let chosen: TaskRecord[];
    const latest = candidates[0];
    if (latest.batchId) {
        chosen = candidates
            .filter((row) => row.batchId === latest.batchId)
            .sort((a, b) => (a.batchIndex ?? 0) - (b.batchIndex ?? 0));
    } else {
        if (!expected.prompts.length) return undefined;
        const used = new Set<string>();
        chosen = [];
        // Allocate newest matching records, including distinct duplicate inputs.
        for (let i = expected.prompts.length - 1; i >= 0; i--) {
            const row = candidates.find(
                (candidate) =>
                    !candidate.batchId &&
                    !used.has(candidate.id) &&
                    canonical(candidate.prompt) ===
                        canonical(expected.prompts[i]) &&
                    (candidate.model || "") === (expected.model || "") &&
                    canonical(candidate.params ?? {}) ===
                        canonical(expected.params ?? {}),
            );
            if (!row) return undefined;
            used.add(row.id);
            chosen.unshift(row);
        }
    }
    const entries = chosen.map((row, index) => ({
        taskId: row.id,
        batchIndex: index,
        config: {
            nodeId: row.nodeId,
            feature: row.feature,
            pluginId: row.pluginId,
            ...(row.model ? { model: row.model } : {}),
            ...(row.params ? { params: row.params } : {}),
            ...(row.batchId ? { batchId: row.batchId } : {}),
            prompt: row.prompt,
        },
    }));
    const matchesCurrent =
        chosen.length === expected.prompts.length &&
        chosen.every(
            (row, i) =>
                canonical(row.prompt) === canonical(expected.prompts[i]) &&
                (row.model || "") === (expected.model || "") &&
                canonical(row.params ?? {}) ===
                    canonical(expected.params ?? {}),
        );
    return {
        entries,
        matchesCurrent,
        signature: latest.inputSignature ?? undefined,
    };
}
