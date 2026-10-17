/** Durable authoring state: original, model proposal and editable draft. */
export interface SegmentDraft {
    source: string;
    proposal: string[];
    segments: string[];
    reviewed: boolean;
}

export function segmentDraft(
    data: Record<string, unknown>,
): SegmentDraft | undefined {
    const value = data.segmentDraft as SegmentDraft | undefined;
    return value &&
        typeof value.source === "string" &&
        Array.isArray(value.proposal) &&
        value.proposal.every((s) => typeof s === "string") &&
        Array.isArray(value.segments) &&
        value.segments.every((s) => typeof s === "string") &&
        typeof value.reviewed === "boolean"
        ? value
        : undefined;
}

export function canAdoptDraft(draft: SegmentDraft): boolean {
    return (
        draft.segments.length > 0 &&
        draft.segments.every((s) => s.trim().length > 0)
    );
}

/** Bounded comparison: highlight the entire changed range, including omissions.
 * Shared prefix/suffix stays unmarked. This never runs a quadratic LCS on books.
 */
export function draftDifference(source: string, segments: string[]) {
    const current = segments.join("");
    let start = 0;
    while (
        start < source.length &&
        start < current.length &&
        source[start] === current[start]
    )
        start++;
    let end = 0;
    while (
        end < source.length - start &&
        end < current.length - start &&
        source[source.length - end - 1] === current[current.length - end - 1]
    )
        end++;
    return {
        changed: source !== current,
        prefix: source.slice(0, start),
        removed: source.slice(start, source.length - end),
        added: current.slice(start, current.length - end),
        suffix: end ? source.slice(-end) : "",
    };
}
