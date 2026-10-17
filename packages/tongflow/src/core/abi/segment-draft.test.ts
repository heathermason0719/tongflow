import { describe, expect, it } from "vitest";
import { canAdoptDraft, draftDifference } from "./segment-draft";

describe("source comparison", () => {
    it("identifies deletions, additions, reordering and boundary-only changes", () => {
        expect(draftDifference("甲。乙。丙。", ["甲。丙。"])).toMatchObject({
            changed: true,
            removed: "乙。",
            added: "",
        });
        expect(draftDifference("甲。", ["甲。乙。"])).toMatchObject({
            changed: true,
            removed: "",
            added: "乙。",
        });
        expect(draftDifference("甲。乙。", ["乙。", "甲。"]).changed).toBe(
            true,
        );
        expect(draftDifference("甲。乙。", ["甲。", "乙。"]).changed).toBe(
            false,
        );
        expect(
            draftDifference("书。".repeat(40000), ["书。".repeat(40000)])
                .changed,
        ).toBe(false);
    });
    it("blocks empty drafts and blank paragraphs", () => {
        const draft = {
            source: "原稿",
            proposal: ["原稿"],
            segments: [],
            reviewed: false,
        };
        expect(canAdoptDraft(draft)).toBe(false);
        expect(canAdoptDraft({ ...draft, segments: ["人工稿", " "] })).toBe(
            false,
        );
        expect(canAdoptDraft({ ...draft, segments: ["人工稿"] })).toBe(true);
    });
});
