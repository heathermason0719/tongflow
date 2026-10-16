import { describe, expect, it } from "vitest";
import { resolvePluginModel } from "./plugin-model-selection";

describe("OpenAI-compatible model routing", () => {
    it("sends the selected endpoint model instead of replacing it with a GPT shortlist default", () => {
        expect(
            resolvePluginModel("tongflow-api-openai", " qwen-plus ", [
                "gpt-5-mini",
                "gpt-4.1",
            ]),
        ).toBe("qwen-plus");
    });
    it("omits the model when unset so OPENAI_CHAT_MODEL is honored by the plugin", () => {
        expect(
            resolvePluginModel("tongflow-api-openai", "", ["gpt-5-mini"]),
        ).toBeUndefined();
    });
    it("keeps existing router defaults and single-model audio behavior", () => {
        expect(
            resolvePluginModel("tongflow-router-openrouter", "missing", [
                "free",
                "other",
            ]),
        ).toBe("free");
        expect(
            resolvePluginModel("tongflow-router-openrouter", "other", [
                "free",
                "other",
            ]),
        ).toBe("other");
        expect(
            resolvePluginModel("tongflow-api-qwen-audio", "", []),
        ).toBeUndefined();
    });
});
