/** Chrome acceptance with real uploads, graph gestures, task/SSE, persistence,
 * and both execution paths. Provider responses are LOCAL SIMULATIONS.
 * No user audio, credentials, database, or paid provider is used.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
fs.mkdirSync(path.join(root, ".tongflow/speech-workflow"), { recursive: true });
const output = fs.mkdtempSync(
    path.join(root, ".tongflow/speech-workflow/browser-"),
);
const qaData = path.join(output, "data");
const shots = path.join(output, "screenshots");
const downloads = path.join(output, "downloads");
for (const dir of [qaData, shots, downloads])
    fs.mkdirSync(dir, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const write = (name, data) =>
    fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2));
const calls = [];
const reliabilityMode = process.env.TONGFLOW_QA_LONG_BATCH === "1";
let slowBatchCount = 0,
    mockActive = 0,
    maxMockActive = 0;
const taskRequests = [];
const records = {
    provider: "local simulation; NOT real Bailian generation",
    output,
    checks: {},
};
let browser, page, app;

function wav(index) {
    const frames = 24000;
    const bytes = Buffer.alloc(44 + frames * 2);
    bytes.write("RIFF");
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(24000, 24);
    bytes.writeUInt32LE(48000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++)
        bytes.writeInt16LE(
            Math.round(
                2000 * Math.sin((2 * Math.PI * (260 + index * 30) * i) / 24000),
            ),
            44 + i * 2,
        );
    return bytes;
}

const generated = new Map();
const mock = http.createServer(async (req, res) => {
    try {
        if (req.method === "GET" && generated.has(req.url)) {
            res.writeHead(200, { "Content-Type": "audio/wav" });
            res.end(generated.get(req.url));
            return;
        }
        assert.equal(req.method, "POST");
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        let response;
        if (req.url === "/v1/chat/completions") {
            const content = body.messages.at(-1).content;
            const source = content.slice(content.indexOf("TEXT:\n") + 6);
            // Deliberate model rewrite and omission must remain reviewable.
            const proposal = source
                .replace("第1站", "第一站（模型改写）")
                .replace("小林想了想，写下了昨天帮助邻居找回雨伞的经过。", "")
                .trim();
            calls.push({
                kind: "split",
                model: body.model,
                source,
                instruction: content.slice(0, content.indexOf("TEXT:\n")),
            });
            response = {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({ texts: [proposal] }),
                        },
                    },
                ],
            };
        } else {
            assert.equal(
                req.url,
                "/api/v1/services/audio/tts/SpeechSynthesizer",
            );
            assert.equal(body.model, "qwen-audio-3.1-tts-next");
            const refs = body.input.references;
            assert.equal(refs.length, 1);
            const referenceSha256 = sha(
                Buffer.from(refs[0].audio_data.split(",")[1], "base64"),
            );
            const index = calls.filter((c) => c.kind === "tts").length;
            const audio = wav(index);
            const key = `/generated/${index}.wav`;
            generated.set(key, audio);
            calls.push({
                kind: "tts",
                model: body.model,
                text_prompt: body.input.text_prompt,
                referenceSha256,
                outputSha256: sha(audio),
            });
            // Complete in a different order from the inputs.
            mockActive++;
            maxMockActive = Math.max(maxMockActive, mockActive);
            try {
                await pause(
                    reliabilityMode && index < slowBatchCount
                        ? 40000 + (index % 3) * 100
                        : index % 3 === 0
                          ? 650
                          : index % 3 === 1
                            ? 80
                            : 250,
                );
            } finally {
                mockActive--;
            }
            response = {
                output: {
                    audio: {
                        url: `http://127.0.0.1:${mock.address().port}${key}`,
                    },
                },
            };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
    } catch (error) {
        calls.push({ error: String(error) });
        res.writeHead(400);
        res.end(JSON.stringify({ error: String(error) }));
    }
});

async function graph() {
    await pause(700);
    return page.evaluate(() => ({
        nodes: JSON.parse(localStorage.getItem("nodes") || "[]"),
        edges: JSON.parse(localStorage.getItem("edges") || "[]"),
    }));
}
async function fitCanvas() {
    const button = await page.$('button[aria-label="Fit View"]');
    if (button) await button.click();
    await pause(350);
}
async function seed(nodes, edges = []) {
    const base = new URL(page.url()).origin;
    await page.goto(`${base}/api/feature/list`);
    await page.evaluate(
        ({ nodes, edges }) => {
            localStorage.setItem("nodes", JSON.stringify(nodes));
            localStorage.setItem("edges", JSON.stringify(edges));
            localStorage.setItem(
                "workflowMeta",
                JSON.stringify({
                    id: null,
                    name: "配音链路离线验收",
                    description: "公开合成样本，不含用户数据",
                }),
            );
        },
        { nodes, edges },
    );
    await page.goto(`${base}/workspace`, { waitUntil: "networkidle0" });
    await page.waitForSelector(`.react-flow__node[data-id="${nodes[0].id}"]`);
    await fitCanvas();
}
const node = (id, type, data, x = 0, y = 0) => ({
    id,
    type,
    data,
    position: { x, y },
});
const edge = (source, sourceHandle, target, targetHandle) => ({
    id: `${source}-${target}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: "custom-edge",
});
const selector = (id) => `.react-flow__node[data-id="${id}"]`;
async function clickText(text, scope = "body") {
    await page.waitForSelector(scope);
    for (const candidate of await page.$$(`${scope} button`)) {
        if (
            await candidate.evaluate(
                (el, expected) => el.textContent.trim() === expected,
                text,
            )
        ) {
            await candidate.click();
            return;
        }
    }
    const element = await page.waitForSelector(`${scope} ::-p-text(${text})`);
    await element.click();
}
async function button(id, label) {
    const scope = selector(id);
    await page.waitForFunction(
        ({ scope, label }) =>
            [...document.querySelectorAll(`${scope} button`)].some(
                (b) => b.textContent.trim() === label && !b.disabled,
            ),
        {},
        { scope, label },
    );
    for (const b of await page.$$(`${scope} button`))
        if (
            await b.evaluate(
                (el, text) => el.textContent.trim() === text,
                label,
            )
        ) {
            await b.click();
            return;
        }
    throw new Error(`Missing button: ${label}`);
}
async function task(id, label) {
    const [response] = await Promise.all([
        page.waitForResponse(
            (r) =>
                r.url().endsWith("/api/task/create") &&
                r.request().method() === "POST",
        ),
        button(id, label),
    ]);
    assert.equal(response.status(), 200);
    const { taskId } = await response.json();
    await page.waitForFunction(
        async (taskId) => {
            const { tasks } = await (
                await fetch("/api/task/list?limit=200")
            ).json();
            return tasks.some(
                (t) =>
                    t.id === taskId &&
                    ["completed", "failed"].includes(t.status),
            );
        },
        { polling: 200, timeout: 60000 },
        taskId,
    );
    const row = await page.evaluate(
        async (taskId) =>
            (await (await fetch("/api/task/list?limit=200")).json()).tasks.find(
                (t) => t.id === taskId,
            ),
        taskId,
    );
    assert.equal(row.status, "completed", row.error);
    await pause(700);
    return row;
}
async function connect(sourceId, sourceHandle, targetId, targetHandle) {
    await fitCanvas();
    const source = await page.$(
        `${selector(sourceId)} .react-flow__handle[data-handleid="${sourceHandle}"]`,
    );
    const target = await page.$(
        `${selector(targetId)} .react-flow__handle[data-handleid="${targetHandle}"]`,
    );
    assert.ok(source && target, "Connection handles must exist");
    const a = await source.boundingBox(),
        b = await target.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await page.mouse.up();
    await page.waitForFunction(
        ({ sourceId, targetId, targetHandle }) =>
            JSON.parse(localStorage.getItem("edges") || "[]").some(
                (e) =>
                    e.source === sourceId &&
                    e.target === targetId &&
                    e.targetHandle === targetHandle,
            ),
        {},
        { sourceId, targetId, targetHandle },
    );
}
async function shot(name) {
    await fitCanvas();
    const clone = await page.$(selector("clone"));
    if (clone && !name.startsWith("02")) {
        const box = await clone.boundingBox();
        const dx = 900 - box.x - box.width / 2;
        const dy = 550 - box.y - box.height / 2;
        await page.mouse.move(120, 180);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(120 + dx, 180 + dy, { steps: 15 });
        await page.mouse.up({ button: "middle" });
        await page.mouse.move(900, 550);
        await page.mouse.wheel({ deltaY: -450 });
        await pause(400);
    }
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

try {
    await new Promise((r) => mock.listen(0, "127.0.0.1", r));
    const mockBase = `http://127.0.0.1:${mock.address().port}`;
    fs.writeFileSync(
        path.join(qaData, "settings.json"),
        JSON.stringify({
            OPENAI_API_KEY: randomUUID(),
            OPENAI_BASE_URL: `${mockBase}/v1`,
            OPENAI_CHAT_MODEL: "qwen-plus",
            DASHSCOPE_API_KEY: randomUUID(),
            DASHSCOPE_BASE_URL: mockBase,
        }),
    );
    fs.cpSync(
        path.join(root, "data/.tongflow/plugin-venv"),
        path.join(qaData, ".tongflow/plugin-venv"),
        { recursive: true, verbatimSymlinks: true },
    );
    const freePort = net.createServer();
    await new Promise((r) => freePort.listen(0, "127.0.0.1", r));
    const port = freePort.address().port;
    await new Promise((r) => freePort.close(r));
    const base = `http://127.0.0.1:${port}`;
    const log = fs.openSync(path.join(output, "server.log"), "a");
    app = spawn(
        process.execPath,
        [
            "node_modules/next/dist/bin/next",
            "start",
            "-H",
            "127.0.0.1",
            "-p",
            String(port),
        ],
        {
            cwd: root,
            env: {
                ...process.env,
                PORT: String(port),
                TONGFLOW_DATA_DIR: qaData,
                TONGFLOW_AUTH_TOKEN: "",
                PYTHON: path.join(qaData, ".tongflow/plugin-venv/bin/python"),
                NEXT_TELEMETRY_DISABLED: "1",
            },
            stdio: ["ignore", log, log],
        },
    );
    fs.closeSync(log);
    for (let i = 0; ; i++) {
        try {
            if ((await fetch(`${base}/workspace`)).ok) break;
        } catch {}
        assert.ok(i < 100 && app.exitCode === null);
        await pause(250);
    }
    const moduleName = process.env.PUPPETEER_MODULE || "puppeteer-core";
    const puppeteer = (
        await import(
            path.isAbsolute(moduleName)
                ? pathToFileURL(moduleName).href
                : moduleName
        )
    ).default;
    browser = await puppeteer.launch({
        executablePath:
            process.env.CHROME_PATH ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
        userDataDir: path.join(output, "chrome"),
        args: ["--lang=zh-CN", "--autoplay-policy=no-user-gesture-required"],
    });
    page = (await browser.pages())[0];
    await page.setViewport({ width: 1800, height: 1200 });
    if (reliabilityMode)
        await page.evaluateOnNewDocument(() => {
            window.__qaToastMax = 0;
            window.addEventListener("DOMContentLoaded", () => {
                new MutationObserver(() => {
                    const count = [
                        ...document.querySelectorAll('[role="status"]'),
                    ].filter((el) =>
                        /^(任务完成|Task completed)$/.test(
                            el.textContent.trim(),
                        ),
                    ).length;
                    window.__qaToastMax = Math.max(window.__qaToastMax, count);
                }).observe(document.body, { childList: true, subtree: true });
            });
        });
    await page.setCookie({ name: "NEXT_LOCALE", value: "zh", url: base });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const url = new URL(req.url());
        if (url.pathname === "/api/task/create" && req.method() === "POST")
            taskRequests.push(JSON.parse(req.postData()));
        if (
            ["http:", "https:"].includes(url.protocol) &&
            !["127.0.0.1", "localhost"].includes(url.hostname)
        )
            req.abort();
        else req.continue();
    });
    await page.goto(`${base}/workspace`, { waitUntil: "networkidle0" });

    console.log(`Evidence: ${output}`);
    // Public synthetic speech produced entirely by macOS's installed voice.
    const refAiff = path.join(output, "reference.aiff"),
        reference = path.join(output, "reference.wav");
    execFileSync("say", [
        "-v",
        "Tingting",
        "-o",
        refAiff,
        "欢迎来到河边图书馆。今天我们一起听一个关于旧书和新朋友的故事。这是一段公开的测试声音。",
    ]);
    execFileSync("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-i",
        refAiff,
        "-ar",
        "24000",
        "-ac",
        "1",
        reference,
    ]);
    await seed([node("upload-voice", "addAudioNode", {})]);
    const uploaded = page.waitForResponse(
        (r) =>
            r.url().endsWith("/api/upload") && r.request().method() === "POST",
    );
    await (await page.$('input[type="file"]')).uploadFile(reference);
    const { fileKey: refKey } = await (await uploaded).json();
    await page.waitForSelector(".react-flow__node-audioNode audio");
    records.reference = {
        fileKey: refKey,
        sha256: sha(fs.readFileSync(reference)),
        origin: "macOS Tingting, local synthetic test voice",
    };
    await shot("01-independent-reference-upload");

    const paragraph = (i) =>
        `第${i}站，河边图书馆的志愿者打开窗户，让清晨的风穿过书架。小林把借来的旧书放在桌上，发现书页里夹着一张画有木桥的卡片。管理员告诉他，每位读者都可以在卡片背面写下一件值得记住的小事。小林想了想，写下了昨天帮助邻居找回雨伞的经过。傍晚，大家沿着河岸散步，远处传来孩子们读诗的声音。`;
    const source = `${Array.from({ length: reliabilityMode ? 10 : 9 }, (_, i) =>
        paragraph(i + 1),
    ).join("\n\n")}\n`;
    const sourceFile = path.join(output, "public-long-script.txt");
    fs.writeFileSync(sourceFile, source);
    await seed([node("upload-script", "addFileNode", {})]);
    const uploadedScript = page.waitForResponse(
        (r) =>
            r.url().endsWith("/api/upload") && r.request().method() === "POST",
    );
    await (await page.$('input[type="file"]')).uploadFile(sourceFile);
    const { fileKey: sourceKey } = await (await uploadedScript).json();
    await seed(
        [
            node("document", "fileNode", { fileKeys: [sourceKey] }),
            node(
                "parse",
                "fileGenTextNode",
                { pluginId: "tongflow-api-openai" },
                450,
            ),
        ],
        [edge("document", "out:fileNode", "parse", "in:document")],
    );
    console.log("Parsing uploaded document");
    const parsed = await task("parse", "解析文档");
    const extracted = (await graph()).nodes.find((n) => n.type === "textNode");
    assert.equal(extracted.data.texts[0], source);
    records.checks.documentExtraction = {
        taskId: parsed.id,
        chars: Array.from(source).length,
        sourceSha256: sha(Buffer.from(source)),
        exact: true,
    };
    await shot("02-extracted-source");

    // Connect split directly to speech, so cardinality changes flow without rewiring.
    const nodes = [
        node("document", "fileNode", { fileKeys: [sourceKey] }, -1000),
        node(
            "parse",
            "fileGenTextNode",
            (await graph()).nodes.find((n) => n.id === "parse").data,
            -500,
        ),
        node("text", "textNode", {
            ...extracted.data,
            label: "河边图书馆原文",
        }),
        node(
            "split",
            "splitTextNode",
            {
                pluginId: "tongflow-api-openai",
                pluginParams: { max_segment_chars: 180, target_seconds: 25 },
            },
            550,
        ),
        node(
            "voice",
            "audioNode",
            { fileKeys: [refKey], label: "此前上传的参考声音" },
            600,
            -550,
        ),
        node(
            "clone",
            "textGenSpeechCloneNode",
            {
                pluginId: "tongflow-api-qwen-audio",
                texts: ["这段历史文字绝不能发送"],
                label: "批量复刻配音",
            },
            1200,
        ),
    ];
    await seed(nodes, [
        edge("document", "out:fileNode", "parse", "in:document"),
        edge("parse", "out:text", "text", "in:textNode"),
        edge("text", "out:textNode", "split", "in:text"),
        edge("split", "out:texts", "clone", "in:text"),
    ]);
    console.log("Splitting and connecting reference");
    const splitTask = await task("split", "执行");
    let g = await graph();
    const segments = g.nodes.find((n) => n.id === "split").data.liveOutput
        .texts;
    assert.ok(segments.length >= 3);
    assert.notEqual(segments.join(""), source);
    assert.equal(
        g.nodes.find((n) => n.id === "split").data.segmentDraft.source,
        source,
    );
    assert.equal(
        g.nodes.find((n) => n.id === "split").data.segmentDraft.reviewed,
        false,
    );
    assert.equal(await page.$('[data-testid="effective-speech-text"]'), null);
    const beforeReview = calls.length;
    await button("split", "审阅与编辑");
    await page.waitForSelector('[data-testid="draft-editor"]');
    assert.equal(
        await page.$eval(
            '[data-testid="draft-original"]',
            (el) => el.textContent,
        ),
        source,
    );
    assert.ok(
        (
            await page.$eval(
                '[data-testid="model-difference"]',
                (el) => el.textContent,
            )
        ).includes("模型改写"),
    );
    const visibleProposal = await page.$$eval(
        '[data-testid="draft-segment"] textarea',
        (els) => els.map((el) => el.value),
    );
    assert.deepEqual(visibleProposal, segments);
    await pause(350);
    await page.screenshot({
        path: path.join(shots, "03-full-differing-proposal-for-review.png"),
    });
    await (await page.$$('[data-testid="draft-segment"]'))
        .at(-1)
        .scrollIntoView();
    await pause(250);
    await page.screenshot({
        path: path.join(shots, "03b-last-segment-and-adoption.png"),
    });
    await clickText("完成编辑", '[data-testid="draft-editor"]');
    // The normal speech action is disabled; no task or provider call is emitted.
    assert.equal(
        await page.$eval(
            selector("clone"),
            (el) =>
                [...el.querySelectorAll("button")].find(
                    (b) => b.textContent.trim() === "生成语音",
                )?.disabled,
        ),
        true,
    );
    await page.$eval(selector("clone"), (el) =>
        [...el.querySelectorAll("button")]
            .find((b) => b.textContent.trim() === "生成语音")
            .click(),
    );

    await pause(500);
    assert.equal(calls.length, beforeReview);
    records.checks.unreviewedBlocked = {
        completeProposalVisible: true,
        originalRetained: true,
        modelDiffVisible: true,
        noSpeechRequests: true,
    };
    await button("split", "采用当前稿件");
    assert.ok(segments.every((s) => Array.from(s).length <= 180));
    records.checks.split = {
        taskId: splitTask.id,
        source,
        segments,
        deliberatelyDifferent: true,
        chars: segments.map((s) => Array.from(s).length),
    };
    await fitCanvas();
    await connect("voice", "out:audioNode", "clone", "in:ref_audio");
    await page.waitForFunction(() =>
        document
            .querySelector('[data-testid="reference-source"]')
            .textContent.includes("此前上传"),
    );
    await shot("03-connected-reference-and-live-text");
    records.checks.connectedByMouse = true;

    // Drag the real edge endpoint onto the canvas, confirm deletion, then reconnect.
    g = await graph();
    const refEdge = g.edges.find(
        (e) => e.source === "voice" && e.target === "clone",
    );
    const targetUpdater = await page.$(
        `.react-flow__edge[data-id="${refEdge.id}"] .react-flow__edgeupdater-target`,
    );
    assert.ok(targetUpdater, "Edge reconnect target must exist");
    const updaterBox = await targetUpdater.boundingBox();
    await page.mouse.move(
        updaterBox.x + updaterBox.width / 2,
        updaterBox.y + updaterBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(450, 200, { steps: 25 });
    await page.mouse.up();
    await page.waitForSelector('[role="alertdialog"]');
    await clickText("删除", '[role="alertdialog"]');
    await page.waitForFunction(
        (id) =>
            !JSON.parse(localStorage.getItem("edges") || "[]").some(
                (e) => e.id === id,
            ),
        {},
        refEdge.id,
    );
    await shot("04-reference-disconnected");
    assert.ok(await page.$eval(`${selector("clone")} button`, () => true));
    await fitCanvas();
    await connect("voice", "out:audioNode", "clone", "in:ref_audio");
    records.checks.disconnectedAndReconnectedByMouse = true;

    console.log("Batch speech and downloads");
    const before = calls.filter((c) => c.kind === "tts").length;
    const firstTaskCount = taskRequests.length;
    if (reliabilityMode) slowBatchCount = segments.length;
    const longStart = Date.now();
    await button("clone", "生成语音");
    if (reliabilityMode) {
        await page.waitForFunction(
            (count) =>
                JSON.parse(localStorage.getItem("nodes") || "[]").find(
                    (n) => n.id === "clone",
                )?.data.taskBatch?.entries?.length === count,
            {},
            segments.length,
        );
        await pause(2000);
        await page.setOfflineMode(true);
        await pause(8000);
        await page.setOfflineMode(false);
        const createsBeforeReload = taskRequests.filter(
            (r) => r.feature === "text-gen-speech-clone",
        ).length;
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(selector("clone"));
        await page.waitForFunction(
            () =>
                JSON.parse(localStorage.getItem("nodes") || "[]").find(
                    (n) => n.id === "clone",
                )?.data.outputPending === true,
        );
        // Save from the real UI while the model requests are still in progress.
        const title = await page.waitForSelector("button::-p-text(新创意)");
        await title.hover();
        await clickText("保存", "div.absolute");
        await page.waitForSelector('[role="dialog"] input');
        const input = await page.$('[role="dialog"] input');
        await input.evaluate((el) => {
            el.focus();
            el.select();
        });
        await page.keyboard.type("长时批次断网恢复验收");
        const saveResponse = page.waitForResponse(
            (r) =>
                r.url().endsWith("/api/workspace/save") &&
                r.request().method() === "POST",
        );
        const savingAt = Date.now();
        await clickText("保存", '[role="dialog"]');
        const savedDuringRun = await saveResponse;
        assert.equal(savedDuringRun.status(), 200);
        assert.ok(Date.now() - savingAt < 5000);
        const persisted = JSON.parse(savedDuringRun.request().postData());
        assert.equal(
            persisted.flow.nodes.find((n) => n.id === "clone").data.taskBatch
                .entries.length,
            segments.length,
        );
        write("saved-inflight-workflow.json", persisted);
        assert.equal(
            taskRequests.filter((r) => r.feature === "text-gen-speech-clone")
                .length,
            createsBeforeReload,
        );
        records.checks.longBatchRecovery = {
            offlineSeconds: 8,
            reloadedDuringGeneration: true,
            savesDuringGeneration: true,
            noResubmissionAfterReload: true,
            saveMs: Date.now() - savingAt,
            taskCount: segments.length,
        };
    }
    await page.waitForFunction(
        (count) => {
            const clone = JSON.parse(
                localStorage.getItem("nodes") || "[]",
            ).find((n) => n.id === "clone");
            return (
                clone?.data.speechResults?.length === count &&
                clone.data.speechResults.every(
                    (r) => r.status === "COMPLETED" && r.audio,
                )
            );
        },
        { timeout: reliabilityMode ? 180000 : 90000 },
        segments.length,
    );
    if (reliabilityMode) {
        records.checks.longBatchRecovery.durationMs = Date.now() - longStart;
        records.checks.longBatchRecovery.maxMockConcurrency = maxMockActive;
        records.checks.longBatchRecovery.maxCompletionToasts =
            await page.evaluate(() => window.__qaToastMax);
        assert.ok(Date.now() - longStart > 30000);
        assert.ok(maxMockActive <= 6);
        assert.ok(records.checks.longBatchRecovery.maxCompletionToasts <= 1);
        assert.ok(
            !(await page.evaluate(() => document.body.textContent)).includes(
                "Request timed out",
            ),
        );
    }
    g = await graph();
    const clone = g.nodes.find((n) => n.id === "clone");
    assert.deepEqual(
        clone.data.speechResults.map((r) => r.text),
        segments,
    );
    const ttsCalls = calls.filter((c) => c.kind === "tts").slice(before);
    assert.deepEqual(
        taskRequests
            .slice(firstTaskCount)
            .filter((r) => r.feature === "text-gen-speech-clone")
            .map((r) => r.prompt.text),
        segments,
    );
    assert.equal(ttsCalls.length, segments.length);
    for (const segment of segments)
        assert.ok(ttsCalls.some((c) => c.text_prompt.includes(segment.trim())));
    assert.ok(
        ttsCalls.every((c) => c.referenceSha256 === records.reference.sha256),
    );
    const audioNode = g.nodes.find(
        (n) => n.type === "audioNode" && n.id !== "voice",
    );
    assert.equal(audioNode.data.fileKeys.length, segments.length);
    const associations = [];
    for (let i = 0; i < clone.data.speechResults.length; i++) {
        const row = clone.data.speechResults[i];
        assert.equal(audioNode.data.fileKeys[i], row.audio);
        const response = await fetch(`${base}/api/uploads/${row.audio}`);
        assert.equal(response.status, 200);
        const audioSha256 = sha(Buffer.from(await response.arrayBuffer()));
        assert.ok(
            ttsCalls.some(
                (c) =>
                    c.text_prompt.includes(row.text.trim()) &&
                    c.outputSha256 === audioSha256,
            ),
        );
        associations.push({
            segment: i + 1,
            audioSha256,
            textSha256: sha(Buffer.from(row.text)),
        });
    }
    records.checks.batch = {
        orderedResults: clone.data.speechResults,
        requests: ttsCalls,
        orderedAudioKeys: audioNode.data.fileKeys,
        oneReferenceForAll: true,
        associations,
    };
    await shot("05-batch-source-audio-correspondence");
    write("workflow-first-run.json", g);

    // Each audio element really decodes and plays; download bytes via the UI.
    const playback = await page.$$eval(
        '[data-testid="speech-result-row"] audio',
        async (elements) => {
            const out = [];
            for (const audio of elements) {
                await audio.play();
                // preload=none intentionally delays media loading. Wait for
                // the playback clock rather than an arbitrary 100 ms tick.
                const until = Date.now() + 5000;
                while (
                    audio.currentTime === 0 &&
                    !audio.error &&
                    Date.now() < until
                )
                    await new Promise((r) => setTimeout(r, 50));
                out.push({
                    duration: audio.duration,
                    time: audio.currentTime,
                    error: audio.error?.code,
                });
                audio.pause();
            }
            return out;
        },
    );
    assert.ok(
        playback.every((p) => p.duration > 0 && p.time > 0 && !p.error),
        JSON.stringify(playback),
    );
    records.checks.playback = playback;
    const client = await page.createCDPSession();
    await client.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
    });
    for (let i = 0; i < segments.length; i++) {
        const buttons = await page.$$(
            '[data-testid="speech-result-row"] button',
        );
        await buttons[i].click();
        for (
            let retry = 0;
            fs.readdirSync(downloads).filter((s) => s.endsWith(".wav")).length <
            i + 1;
            retry++
        ) {
            assert.ok(retry < 100);
            await pause(100);
        }
    }
    const downloadedHashes = fs
        .readdirSync(downloads)
        .map((f) => sha(fs.readFileSync(path.join(downloads, f))));
    assert.deepEqual(
        [...downloadedHashes].sort(),
        ttsCalls.map((c) => c.outputSha256).sort(),
    );
    records.checks.downloadedAllSegments = downloadedHashes;

    console.log("Editing the complete segment draft in the real browser");
    await fitCanvas();
    await button("split", "审阅与编辑");
    const draftScope = '[data-testid="draft-editor"]';
    const firstEditor = await page.$(`${draftScope} textarea`);
    const editedFirst =
        "人工修改的开头：今天改在傍晚集合。需要删除的测试句。大家一起听河流的声音。";
    await firstEditor.evaluate((el) => {
        el.focus();
        el.select();
    });
    await page.keyboard.press("Backspace");
    await firstEditor.type(editedFirst);
    // Delete one complete sentence through the text editor.
    await firstEditor.evaluate((el) => {
        const text = "需要删除的测试句。";
        const i = el.value.indexOf(text);
        el.focus();
        el.setSelectionRange(i, i + text.length);
    });
    await page.keyboard.press("Backspace");
    const edited = editedFirst.replace("需要删除的测试句。", "");
    assert.equal(await firstEditor.evaluate((el) => el.value), edited);
    // Merge a boundary, then split at the chosen cursor to establish a new one.
    await clickText(
        "合并下一段",
        `${draftScope} [data-testid="draft-segment"]`,
    );
    const merged = await page.$(`${draftScope} textarea`);
    await merged.evaluate((el, position) => {
        el.focus();
        el.setSelectionRange(position, position);
    }, edited.indexOf("大家"));
    await clickText(
        "在光标处分段",
        `${draftScope} [data-testid="draft-segment"]`,
    );
    await clickText("下移", `${draftScope} [data-testid="draft-segment"]`);
    const rows = await page.$$(`${draftScope} [data-testid="draft-segment"]`);
    await rows
        .at(-1)
        .$("button::-p-text(删除本段)")
        .then((b) => b.click());
    await clickText("新增段落", draftScope);
    const editors = await page.$$(`${draftScope} textarea`);
    await editors.at(-1).type("人工新增的结尾：下次见。 ");
    let updatedSegments = await page.$$eval(`${draftScope} textarea`, (els) =>
        els.map((el) => el.value),
    );
    assert.ok(updatedSegments.some((s) => s.includes("人工修改")));
    assert.ok(updatedSegments.every((s) => !s.includes("需要删除的测试句")));
    assert.ok(updatedSegments.at(-1).includes("人工新增"));
    assert.equal(updatedSegments[1], edited.slice(0, edited.indexOf("大家")));
    await pause(700);
    assert.equal(
        (await graph()).nodes.find((n) => n.id === "split").data.segmentDraft
            .reviewed,
        false,
    );
    await page.screenshot({
        path: path.join(shots, "06-human-edits-boundaries-and-order.png"),
    });
    assert.ok(
        (
            await page.$eval(
                '[data-testid="speech-results"]',
                (el) => el.textContent,
            )
        ).includes("历史配音"),
    );
    records.checks.editsInvalidateReviewAndAudio = true;
    await clickText("采用当前稿件", draftScope);
    await clickText("完成编辑", draftScope);
    await pause(700);
    const preview = await page.$$eval(
        '[data-testid="effective-speech-text"]',
        (els) => els.map((e) => e.childNodes[1].textContent),
    );
    assert.deepEqual(preview, updatedSegments);
    const updated = source;
    const editedSplit = { id: "not-rerun; current draft edited directly" };
    const secondTaskCount = taskRequests.length;
    const priorCount = calls.filter((c) => c.kind === "tts").length;
    await button("clone", "生成语音");
    await page.waitForFunction(
        (segments) => {
            const clone = JSON.parse(
                localStorage.getItem("nodes") || "[]",
            ).find((n) => n.id === "clone");
            return (
                clone?.data.speechResults?.length === segments.length &&
                clone.data.speechResults.every(
                    (r, i) =>
                        r.status === "COMPLETED" && r.text === segments[i],
                )
            );
        },
        { timeout: 60000 },
        updatedSegments,
    );
    const updatedCalls = calls
        .filter((c) => c.kind === "tts")
        .slice(priorCount);
    assert.equal(updatedCalls.length, updatedSegments.length);
    assert.deepEqual(
        taskRequests
            .slice(secondTaskCount)
            .filter((r) => r.feature === "text-gen-speech-clone")
            .map((r) => r.prompt.text),
        updatedSegments,
    );
    assert.ok(
        updatedSegments.every((s) =>
            updatedCalls.some((c) => c.text_prompt.includes(s.trim())),
        ),
    );
    records.checks.editAndRerun = {
        splitTask: editedSplit.id,
        updated,
        preview,
        requests: updatedCalls,
        exact: true,
    };
    await shot("07-updated-text-and-new-results");

    // Use the app's real Save dialog (exporter included), then its workflow library.
    console.log("Saving and reopening");
    const titleButton = await page.waitForSelector(
        reliabilityMode
            ? "button::-p-text(长时批次断网恢复验收)"
            : "button::-p-text(新创意)",
    );
    await titleButton.hover();
    await clickText("保存", "div.absolute");
    await page.waitForSelector('[role="dialog"]');
    const nameInput = await page.$('[role="dialog"] input');
    await nameInput.evaluate((el) => {
        el.focus();
        el.select();
    });
    await page.keyboard.type("公开配音链路验收");
    const savedResponse = page.waitForResponse(
        (r) =>
            /\/api\/workspace\/(save|\d+)$/.test(new URL(r.url()).pathname) &&
            ["POST", "PUT"].includes(r.request().method()),
    );
    await clickText("保存", '[role="dialog"]');
    const saved = await savedResponse;
    assert.equal(saved.status(), 200);
    const savedBody = await saved.json();
    const workflowId =
        savedBody.workflowId ??
        (await page.evaluate(
            () => JSON.parse(localStorage.getItem("workflowMeta")).id,
        ));
    const savePayload = JSON.parse(saved.request().postData());
    write("saved-workflow.json", savePayload);
    await page.reload({ waitUntil: "networkidle0" });
    await fitCanvas();
    g = await graph();
    assert.equal(g.nodes.find((n) => n.id === "text").data.texts[0], updated);
    assert.deepEqual(
        g.nodes
            .find((n) => n.id === "clone")
            .data.speechResults.map((r) => r.text),
        updatedSegments,
    );
    assert.ok(
        g.edges.some((e) => e.source === "voice" && e.target === "clone"),
    );
    records.checks.savedReloaded = {
        workflowId,
        connectionsAndResultsPreserved: true,
    };
    await shot("08-saved-and-reloaded");

    // Reopen from the database through the real workflow library.
    await seed([node("temporary", "textNode", { texts: ["临时画布"] })]);
    await page.click('button[aria-label="我的工作流"]');
    await page.waitForSelector('[role="dialog"]');
    await clickText("打开", '[role="dialog"]');
    await page.waitForSelector(selector("clone"));
    g = await graph();
    assert.deepEqual(
        g.nodes
            .find((n) => n.id === "clone")
            .data.speechResults.map((r) => r.text),
        updatedSegments,
    );
    const reopenedDraft = g.nodes.find((n) => n.id === "split").data
        .segmentDraft;
    assert.deepEqual(reopenedDraft.segments, updatedSegments);
    assert.equal(reopenedDraft.source, source);
    assert.equal(reopenedDraft.reviewed, true);
    records.checks.reopenedFromDatabase = { draft: reopenedDraft, exact: true };
    // Reopen, edit again and rerun without another LLM call.
    await fitCanvas();
    await button("split", "审阅与编辑");
    const reopenedEditor = await page.$(
        '[data-testid="draft-editor"] textarea',
    );
    const reopenValue = await reopenedEditor.evaluate((el) => el.value);
    await reopenedEditor.evaluate((el) => {
        el.focus();
        el.setSelectionRange(5, 5);
    });
    await reopenedEditor.type("再次打开后补充。");
    assert.equal(
        await reopenedEditor.evaluate((el) => el.value),
        `${reopenValue.slice(0, 5)}再次打开后补充。${reopenValue.slice(5)}`,
    );
    updatedSegments = await page.$$eval(
        '[data-testid="draft-editor"] textarea',
        (els) => els.map((el) => el.value),
    );
    await clickText("完成编辑", '[data-testid="draft-editor"]');
    const splitCountBeforeEngine = calls.filter(
        (c) => c.kind === "split",
    ).length;
    const engineCallStart = calls.length;

    // Execute from the real mode switch and confirmation dialog. This exercises
    // the app exporter, Python engine, and canvas SSE publisher together.
    console.log("Executing reopened workflow from the UI");
    await page.waitForSelector('[data-testid="draft-editor"]', {
        hidden: true,
    });
    const modeButtons = await page.$$("button[aria-pressed]");
    await modeButtons[1].click();
    await page.waitForFunction(
        () =>
            [
                ...document.querySelectorAll("button[aria-pressed]"),
            ][1]?.getAttribute("aria-pressed") === "true",
    );
    async function runWorkflowFromUi() {
        const play = await page.waitForSelector(
            "button:not([aria-pressed]):has(svg.lucide-play):not(.react-flow__node button)",
        );
        await play.click();
        await page.waitForSelector('[role="dialog"]');
        const executionResponse = page.waitForResponse(
            (r) =>
                r.url().endsWith("/api/workflow/execute") &&
                r.request().method() === "POST",
        );
        await clickText("确认执行", '[role="dialog"]');
        const execution = await executionResponse;
        assert.equal(execution.status(), 200);
        const { taskId: engineId } = await execution.json();
        await page.waitForFunction(
            async (id) => {
                const { tasks } = await (
                    await fetch("/api/task/list?limit=200")
                ).json();
                return tasks.some(
                    (t) =>
                        t.id === id &&
                        ["completed", "failed"].includes(t.status),
                );
            },
            { polling: 250, timeout: 90000 },
            engineId,
        );
        const engineTask = await page.evaluate(
            async (id) =>
                (
                    await (await fetch("/api/task/list?limit=200")).json()
                ).tasks.find((t) => t.id === id),
            engineId,
        );
        return { engineId, engineTask };
    }
    const blocked = await runWorkflowFromUi();
    assert.equal(blocked.engineTask.status, "failed");
    assert.ok(JSON.stringify(blocked.engineTask.error).includes("尚未采用"));
    await pause(1000);
    assert.equal(calls.length, engineCallStart);
    g = await graph();
    assert.deepEqual(
        g.nodes.find((n) => n.id === "split").data.segmentDraft.segments,
        updatedSegments,
    );
    assert.equal(
        g.nodes.find((n) => n.id === "split").data.outputPending,
        false,
    );
    records.checks.workflowReviewGate = {
        taskId: blocked.engineId,
        status: "failed with review prompt",
        providerCalls: 0,
        draftPreserved: true,
        error: blocked.engineTask.error,
    };
    await shot("10-unreviewed-workflow-stopped-before-tts");
    await fitCanvas();
    await button("split", "审阅与编辑");
    await clickText("采用当前稿件", '[data-testid="draft-editor"]');
    await clickText("完成编辑", '[data-testid="draft-editor"]');
    await page.waitForSelector('[data-testid="draft-editor"]', {
        hidden: true,
    });
    const { engineId, engineTask } = await runWorkflowFromUi();
    assert.equal(engineTask.status, "completed", engineTask.error);
    await pause(1000);
    g = await graph();
    assert.equal(
        g.nodes.find((n) => n.id === "clone").data.outputPending,
        false,
    );
    assert.deepEqual(
        g.nodes
            .find((n) => n.id === "clone")
            .data.speechResults.map((r) => r.text),
        updatedSegments,
    );
    assert.ok(
        g.nodes
            .find((n) => n.id === "clone")
            .data.speechResults.every((r) =>
                r.audio.startsWith(`tasks/${engineId}/`),
            ),
    );
    const engineRequests = calls
        .slice(engineCallStart)
        .filter((c) => c.kind === "tts");
    assert.equal(
        calls.filter((c) => c.kind === "split").length,
        splitCountBeforeEngine,
    );
    assert.equal(engineRequests.length, updatedSegments.length);
    engineRequests.forEach((r, i) =>
        assert.ok(r.text_prompt.includes(updatedSegments[i].trim())),
    );
    records.checks.engine = {
        noLlmRerun: true,
        currentDraft: updatedSegments,
        actualRequests: engineRequests,
        taskId: engineId,
        complete: true,
        usesAppExport: true,
        orderedRows: g.nodes.find((n) => n.id === "clone").data.speechResults,
    };
    write("workflow-engine-run.json", g);
    await shot("09-reopened-workflow-engine-results");
    assert.equal(errors.length, 0, errors.join("\n"));
    write("results.json", records);
    write("provider-requests.json", calls);
    write("actual-task-requests.json", taskRequests);
    console.log(
        JSON.stringify(
            {
                output,
                checks: Object.keys(records.checks),
                provider: records.provider,
            },
            null,
            2,
        ),
    );
} catch (error) {
    records.failure = String(error);
    write("results.json", records);
    write("provider-requests.json", calls);
    write("actual-task-requests.json", taskRequests);
    if (page) {
        await page
            .screenshot({ path: path.join(shots, "failure.png") })
            .catch(() => {});
        fs.writeFileSync(
            path.join(output, "failure-dom.txt"),
            await page.evaluate(() => document.body.innerText).catch(String),
        );
    }
    throw error;
} finally {
    if (browser) {
        await Promise.race([browser.close(), pause(5000)]);
        if (browser.process()?.exitCode === null) browser.process().kill();
    }
    if (app) app.kill("SIGTERM");
    mock.closeAllConnections();
    await new Promise((r) => mock.close(r));
}

process.exit(process.exitCode ?? 0);
