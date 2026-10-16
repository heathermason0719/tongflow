import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractCompatibleKey } from "./provider-credentials";

describe("OpenAI-compatible service credentials", () => {
    it("preserves an opaque provider key including padding without requiring an OpenAI prefix", () => {
        const opaque = `${randomUUID()}.${randomUUID()}==`;
        const uppercase = `A${randomUUID().replaceAll("-", "").toUpperCase()}==`;
        expect(extractCompatibleKey(`  ${opaque}  `)).toBe(opaque);
        expect(extractCompatibleKey(uppercase)).toBe(uppercase);
    });
    it("accepts copied shell assignments and preserves the complete value", () => {
        const opaque = `${randomUUID()}.${randomUUID()}==`;
        const prefixed = ["sk", randomUUID()].join("-");
        expect(
            extractCompatibleKey(`export DASHSCOPE_API_KEY="${opaque}"`),
        ).toBe(opaque);
        expect(extractCompatibleKey(`OPENAI_API_KEY='${prefixed}'`)).toBe(
            prefixed,
        );
    });
    it("does not mistake empty values, prose or a multi-line command for a key", () => {
        for (const raw of [
            "",
            "  ",
            "OPENAI_API_KEY=",
            "Here is a key",
            "key-one\nkey-two",
        ]) {
            expect(extractCompatibleKey(raw)).toBe("");
        }
    });
});
