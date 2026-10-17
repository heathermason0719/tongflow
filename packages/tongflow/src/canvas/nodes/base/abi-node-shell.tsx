/**
 * ABI-driven node shell. Wires `useAbiExecution` to `BaseNodeShell` and
 * auto-renders `<AbiHandles>`. Node components only declare:
 *   - `feature` (the sourceSpec comes from the static node-type registry)
 *   - the form (passed from `useAbiForm` so the same instance feeds execution)
 *   - presentation: title / icon / executeLabel / children
 */

import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { BaseNodeData, NodeSlot } from "../../../core";
import { useAbiExecution } from "../../hooks/use-abi-execution";
import type { UseAbiFormReturn } from "../../hooks/use-abi-form";
import type { Task } from "../../hooks/use-task";
import { Button } from "../../ui/button";

import { AbiHandles } from "./abi-handles";
import { BaseNodeShell } from "./base-node-shell";

export interface AbiNodeShellProps<F extends NodeSlot> {
    feature: F;
    form: UseAbiFormReturn<F>;

    // ---- Chrome ----
    title?: string;
    icon?: ReactNode;
    headerActions?: ReactNode;

    // ---- Execute button ----
    executeLabel?: string;
    executeIcon?: ReactNode;
    /** Force-disable execute (e.g. required upstream not connected yet). */
    executeDisabled?: boolean;
    /** Treated as input node — execute button stays visible in execute mode. */
    isInputNode?: boolean;

    // ---- Misc ----
    selected?: boolean;
    count?: number;
    className?: string;
    children?: ReactNode;
    overlay?: ReactNode;
    /** Whether to auto-render AbiHandles. Default true. */
    autoHandles?: boolean;
    /** Whether to show plugin selector. Default true. */
    showPluginSelect?: boolean;
    /** Optional node.data passthrough for chrome (defaults to form state). */
    data?: BaseNodeData;
    /** Custom task update handler (forwarded to useAbiExecution). */
    onTaskUpdate?: (
        task: Task,
    ) => boolean | undefined | Promise<boolean | undefined>;
    /** Final-stage prompt transformer (forwarded to useAbiExecution). */
    transformPrompts?: (
        prompts: Record<string, unknown>[],
    ) => Record<string, unknown>[];
}

export function AbiNodeShell<F extends NodeSlot>({
    feature,
    form,
    title,
    icon,
    headerActions,
    executeLabel,
    executeIcon,
    executeDisabled,
    isInputNode,
    selected,
    count,
    className,
    children,
    overlay,
    autoHandles = true,
    showPluginSelect = true,
    data,
    onTaskUpdate,
    transformPrompts,
}: AbiNodeShellProps<F>) {
    const recoveryT = useTranslations("Workspace.nodes.speechFlow");
    const exec = useAbiExecution({
        feature,
        form,
        disabled: executeDisabled,
        onTaskUpdate,
        transformPrompts,
    });

    return (
        <BaseNodeShell
            selected={selected}
            count={count}
            data={data ?? (form.state as BaseNodeData)}
            overlay={overlay}
            className={className}
            title={title}
            icon={icon}
            headerActions={headerActions}
            loading={exec.loading}
            elapsedSeconds={exec.elapsedSeconds}
            progressLabel={exec.progressLabel}
            thinkingText={exec.thinkingText}
            isExecuteMode={exec.isExecuteMode}
            onExecute={exec.run}
            onCancel={exec.canCancel ? exec.cancel : undefined}
            executeLabel={executeLabel}
            executeIcon={executeIcon}
            executeDisabled={executeDisabled || !exec.canRun}
            isInputNode={isInputNode}
            feature={feature}
            showPluginSelect={showPluginSelect}
            missingPluginOpen={exec.missingPluginOpen}
            setMissingPluginOpen={exec.setMissingPluginOpen}
        >
            {children}
            {feature === "text-gen-speech-clone" && (
                <div className="mx-4 mb-4 nodrag space-y-2">
                    <Button
                        variant="outline"
                        disabled={exec.recovering || exec.loading}
                        onClick={() => void exec.recoverResults()}
                        data-testid="recover-task-results"
                    >
                        {recoveryT("recoverResults")}
                    </Button>
                    {exec.recoveryMessage && (
                        <p
                            role="alert"
                            className="text-sm"
                            data-testid="recovery-status"
                        >
                            {exec.recoveryMessage}
                        </p>
                    )}
                </div>
            )}
            {autoHandles && <AbiHandles feature={feature} />}
        </BaseNodeShell>
    );
}
