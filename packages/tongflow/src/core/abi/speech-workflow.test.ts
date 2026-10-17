import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { exportWorkflow } from "../workflow/exporter";
import { inputSignature } from "./input-lineage";
import { resolvedSpecForNodeType } from "./node-feature-registry";
import { buildPrompts, collectHandleValues } from "./resolve";

const node = (
    id: string,
    type: string,
    data: Record<string, unknown>,
): Node => ({ id, type, data, position: { x: 0, y: 0 } });
const edge = (source: string, target: string, field: string): Edge => ({
    id: `${source}-${target}`,
    source,
    target,
    targetHandle: `in:${field}`,
});

describe("reusable speech inputs", () => {
    it("identifies actual producer output and keeps fingerprints bounded for long scripts", () => {
        const nodes = [
            node("source", "textNode", { texts: ["长文。".repeat(30000)] }),
            node("split", "splitTextNode", {
                liveOutput: { texts: ["甲。", "乙。"] },
            }),
            node("clone", "textGenSpeechCloneNode", {}),
        ];
        const edges = [
            edge("source", "split", "text"),
            { ...edge("split", "clone", "text"), sourceHandle: "out:texts" },
        ];
        const first = inputSignature("clone", nodes, edges);
        expect(first.length).toBeLessThan(80);
        nodes[1].data.liveOutput = { texts: ["甲。乙。"] };
        expect(inputSignature("clone", nodes, edges)).not.toBe(first);
    });

    it("exports an explicitly edited parsed text as the effective source", () => {
        const nodes = [
            node("document", "fileNode", { fileKeys: ["source.txt"] }),
            node("parse", "fileGenTextNode", {
                feature: "parse-document",
                pluginId: "tongflow-api-openai",
            }),
            node("edited", "textNode", {
                texts: ["手工修改。"],
                manualTextOverride: true,
            }),
            node("split", "splitTextNode", { pluginId: "tongflow-api-openai" }),
        ];
        const edges = [
            edge("document", "parse", "document"),
            {
                ...edge("parse", "edited", "textNode"),
                sourceHandle: "out:text",
            },
            edge("edited", "split", "text"),
        ];
        const exported = exportWorkflow(nodes, edges);
        const split = exported.executableNodes.find((n) => n.id === "split")!;
        expect(split.bindings.text).toMatchObject({
            sources: [{ fromNodeId: "edited", fromField: "texts" }],
        });
        expect(
            exported.executableNodes.find((n) => n.id === "parse")?.outputs[0]
                .downstreamDataNodeId,
        ).toBeUndefined();
        expect(
            exported.dataNodes.find((n) => n.id === "edited")?.staticData
                ?.texts,
        ).toEqual(["手工修改。"]);
    });
    for (const type of [
        "textGenSpeechCloneNode",
        "textGenSpeechCloneComposeNode",
    ]) {
        it(`${type} resolves current text, connected voice, then the local upload after disconnect`, () => {
            const nodes = [
                node("text", "textNode", { texts: ["当前甲。", "当前乙。"] }),
                node("voice", "audioNode", { fileKeys: ["voice.wav"] }),
                node("clone", type, {
                    texts: ["旧文"],
                    ref_audio: "local.wav",
                }),
            ];
            let edges = [
                edge("text", "clone", "text"),
                edge("voice", "clone", "ref_audio"),
            ];
            const spec = resolvedSpecForNodeType(type)!;
            const resolve = () =>
                buildPrompts({
                    spec,
                    configValues: nodes[2].data,
                    handleValues: collectHandleValues(
                        "clone",
                        spec,
                        nodes,
                        edges,
                    ),
                });
            expect(resolve().map((p) => [p.text, p.ref_audio])).toEqual([
                ["当前甲。", "voice.wav"],
                ["当前乙。", "voice.wav"],
            ]);
            nodes[0].data.texts = ["修改后。"];
            expect(resolve()[0].text).toBe("修改后。");
            nodes[1].data.fileKeys = [];
            expect(resolve()[0].ref_audio).toBeNull();
            edges = edges.filter((e) => e.source !== "voice");
            expect(resolve()[0].ref_audio).toBe("local.wav");
            const exported = exportWorkflow(nodes, edges);
            expect(exported.executableNodes[0].bindings.ref_audio).toEqual({
                kind: "config",
                value: "local.wav",
            });
            edges = [];
            expect(resolve()).toEqual([]);
            expect(JSON.parse(JSON.stringify(nodes))[2].data.texts).toEqual([
                "旧文",
            ]);
        });
    }

    it("rejects stale and legacy split output, including after save and reopen", () => {
        const nodes = [
            node("source", "textNode", { texts: ["原文。"] }),
            node("split", "splitTextNode", { feature: "split-text" }),
            node("segment", "textNode", { texts: ["原文。"] }),
            node("clone", "textGenSpeechCloneNode", { ref_audio: "voice.wav" }),
        ];
        const edges = [
            edge("source", "split", "text"),
            edge("split", "segment", "textNode"),
            edge("segment", "clone", "text"),
        ];
        const spec = resolvedSpecForNodeType("textGenSpeechCloneNode")!;
        const values = () =>
            collectHandleValues(
                "clone",
                spec,
                JSON.parse(JSON.stringify(nodes)),
                edges,
            ).text;
        expect(values()).toEqual([]);
        nodes[2].data.outputGeneration = {
            producerId: "split",
            signature: inputSignature("split", nodes, edges),
        };
        expect(values()).toEqual(["原文。"]);
        nodes[0].data.texts = ["新原文。"];
        expect(values()).toEqual([]);
        expect(nodes[2].data.texts).toEqual(["原文。"]);
    });
});

describe("reviewed segment authoring", () => {
    const draft = {
        source: "原稿。保留。",
        proposal: ["模型改写。"],
        segments: ["第二段。", "人工第一段。"],
        reviewed: false,
    };
    const fixture = () => {
        const nodes = [
            node("source", "textNode", { texts: [draft.source] }),
            node("split", "splitTextNode", {
                feature: "split-text",
                pluginId: "tongflow-api-openai",
                segmentDraft: structuredClone(draft),
                liveOutput: { texts: ["历史缓存"] },
            }),
            node("materialized", "textNode", {
                texts: ["历史缓存"],
                outputGeneration: { producerId: "split", signature: "old" },
            }),
            node("clone", "textGenSpeechCloneNode", {
                ref_audio: "reference.wav",
            }),
        ];
        const edges = [
            edge("source", "split", "text"),
            { ...edge("split", "clone", "text"), sourceHandle: "out:texts" },
            edge("split", "materialized", "textNode"),
        ];
        const spec = resolvedSpecForNodeType("textGenSpeechCloneNode")!;
        const read = () =>
            buildPrompts({
                spec,
                configValues: nodes[3].data,
                handleValues: collectHandleValues("clone", spec, nodes, edges),
            });
        return { nodes, edges, read };
    };
    it("withholds differing proposals and uses adopted current order instead of cached output", () => {
        const { nodes, edges, read } = fixture();
        expect(read()).toEqual([]);
        const pending = exportWorkflow(nodes, edges);
        expect(
            pending.executableNodes.find((n) => n.id === "split")
                ?.reviewRequired,
        ).toBe(true);
        const state = nodes[1].data.segmentDraft as typeof draft;
        state.reviewed = true;
        expect(read().map((p) => p.text)).toEqual(draft.segments);
        const signature = inputSignature("clone", nodes, edges);
        state.segments.reverse();
        state.reviewed = false;
        expect(read()).toEqual([]);
        expect(inputSignature("clone", nodes, edges)).not.toBe(signature);
        state.reviewed = true;
        nodes[0].data.texts = ["新的原稿不覆盖人工稿。"];
        expect(read().map((p) => p.text)).toEqual(state.segments);
        expect(state.source).toBe(draft.source);
    });
    it("reads materialized siblings once in draft order, including new paragraphs", () => {
        const { nodes } = fixture();
        const state = nodes[1].data.segmentDraft as typeof draft;
        state.reviewed = true;
        state.segments.push("新增的第三段。");
        nodes.push(node("sibling", "textNode", { texts: ["旧的第二段"] }));
        const connections = [
            edge("source", "split", "text"),
            edge("split", "materialized", "textNode"),
            edge("split", "sibling", "textNode"),
            edge("sibling", "clone", "text"),
            edge("materialized", "clone", "text"),
        ];
        const spec = resolvedSpecForNodeType("textGenSpeechCloneNode")!;
        const prompts = buildPrompts({
            spec,
            configValues: nodes[3].data,
            handleValues: collectHandleValues(
                "clone",
                spec,
                nodes,
                connections,
            ),
        });
        expect(prompts.map((p) => p.text)).toEqual(state.segments);
        state.reviewed = false;
        expect(
            collectHandleValues("clone", spec, nodes, connections).text,
        ).toEqual([]);
    });
    it("exports adopted drafts as static inputs through direct or materialized edges", () => {
        const { nodes, edges } = fixture();
        (nodes[1].data.segmentDraft as typeof draft).reviewed = true;
        for (const source of ["split", "materialized"]) {
            const graph = edges.map((e) =>
                e.target === "clone" ? { ...e, source } : e,
            );
            const exported = exportWorkflow(nodes, graph);
            expect(exported.executableNodes.map((n) => n.id)).not.toContain(
                "split",
            );
            expect(
                exported.dataNodes.find((n) => n.id === "split")?.staticData
                    ?.texts,
            ).toEqual(draft.segments);
            expect(
                exported.executableNodes.find((n) => n.id === "clone")?.bindings
                    .text,
            ).toMatchObject({
                sources: [{ fromNodeId: "split", fromField: "texts" }],
            });
        }
    });
});
