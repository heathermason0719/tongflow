/**
 * Task API client
 */

import { apiGet, apiPost } from "./client";

/** A persisted task row as returned by the task list API. */
export interface TaskRecord {
    id: string;
    nodeId: string;
    pluginId: string;
    model?: string | null;
    params?: Record<string, unknown> | null;
    batchId?: string | null;
    batchIndex?: number | null;
    inputSignature?: string | null;
    feature: string;
    prompt: Record<string, unknown>;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    progress: number;
    result?: unknown;
    error?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateTaskRequest {
    feature: string;
    pluginId: string;
    /** Selected model for router-style plugins; omitted otherwise. */
    model?: string;
    /** Advanced parameters (plugin's `TONGFLOW_SLOT_PARAMS` keys); omitted
     * when the node runs on plugin defaults. */
    params?: Record<string, unknown>;
    prompt: Record<string, unknown>;
    nodeId: string;
    workflowId?: number;
    batchId?: string;
    batchIndex?: number;
    inputSignature?: string;
}

export interface CreateTaskResponse {
    taskId: string;
}

/**
 * Create task
 */
export async function createTask(
    config: CreateTaskRequest,
    options?: { showErrorToast?: boolean },
): Promise<CreateTaskResponse> {
    return await apiPost<CreateTaskResponse>(
        "/api/task/create",
        config,
        options,
    );
}

export interface ListTasksResponse {
    tasks: TaskRecord[];
}

/**
 * Get task list
 */
export async function listTasks(
    page = 1,
    pageSize = 20,
): Promise<ListTasksResponse> {
    return await apiGet<ListTasksResponse>(
        `/api/task/list?page=${page}&pageSize=${pageSize}`,
    );
}

export interface UpdateStatusRequest {
    taskId: string;
    status: string;
    data?: Record<string, unknown>;
}

export interface UpdateStatusResponse {
    success: boolean;
    taskUpdated?: boolean;
    skipped?: boolean;
}

/**
 * Update task status (frontend safety net, for single tasks)
 * Do not save assets; only update task status
 */
export async function updateTaskStatus(
    request: UpdateStatusRequest,
): Promise<UpdateStatusResponse> {
    return await apiPost<UpdateStatusResponse>(
        "/api/task/update-status",
        request,
        // The server already owns terminal state. A backup write failing must
        // never turn a successful model task into sixteen timeout error toasts.
        { showErrorToast: false },
    );
}
