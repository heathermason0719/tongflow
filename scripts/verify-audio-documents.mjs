/** Real Chrome acceptance against a production build and an isolated data root.
 * Set PUPPETEER_MODULE to an installed puppeteer-core module (or install it).
 * Provider responses are simulated locally; this script makes no paid calls.
 * Existing audio stays local and evidence is written under ignored .tongflow/.
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
const output = fs.mkdtempSync(
    path.join(root, ".tongflow/audio-documents/browser-"),
);
const fixtures = path.join(root, "tests/fixtures/documents");
const qaData = path.join(output, "data");
const shots = path.join(output, "screenshots");
const downloads = path.join(output, "downloads");
for (const dir of [qaData, shots, downloads, path.join(output, "extracted")])
    fs.mkdirSync(dir, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const write = (name, value) =>
    fs.writeFileSync(
        path.join(output, name),
        `${JSON.stringify(value, null, 2)}\n`,
    );
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const calls = [];
const records = { offlineProvider: true, documents: [], audio: [], output };
let browser;
let page;
let app;

const mock = http.createServer(async (req, res) => {
    try {
        assert.equal(req.method, "POST");
        assert.equal(req.url, "/v1/chat/completions");
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks));
        const content = payload.messages.at(-1).content;
        let answer;
        if (Array.isArray(content)) {
            const media = content[1];
            assert.equal(
                media.type,
                "file",
                "Only PDFs may reach the provider in document tests",
            );
            assert.match(
                media.file.file_data,
                /^data:application\/pdf;base64,/,
            );
            calls.push({
                kind: "pdf",
                model: payload.model,
                inputType: media.type,
            });
            answer = fs.readFileSync(
                path.join(fixtures, "existing.pdf.expected.txt"),
                "utf8",
            );
        } else {
            const marker = "TEXT:\n";
            assert.ok(content.includes(marker));
            const text = content.slice(content.indexOf(marker) + marker.length);
            let texts = text
                .split(/\n\s*\n/u)
                .map((s) => s.trim())
                .filter(Boolean);
            if (texts.length > 100) {
                const grouped = [];
                let chunk = "";
                for (const paragraph of texts) {
                    if (
                        chunk &&
                        Array.from(`${chunk}\n\n${paragraph}`).length > 1000
                    ) {
                        grouped.push(chunk);
                        chunk = "";
                    }
                    chunk = chunk ? `${chunk}\n\n${paragraph}` : paragraph;
                }
                if (chunk) grouped.push(chunk);
                texts = grouped;
            }
            calls.push({
                kind: "split-text",
                sourceChars: Array.from(text).length,
                model: payload.model,
                sourceSha256: sha(Buffer.from(text)),
                segments: texts.length,
            });
            answer = JSON.stringify({ texts });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({ choices: [{ message: { content: answer } }] }),
        );
    } catch (error) {
        calls.push({ error: String(error) });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
    }
});

async function seed(nodes, edges = [], name = "音频与文档验收") {
    // Leave the canvas before replacing storage. Its pending debounced save
    // would otherwise race navigation and overwrite the seeded graph.
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/api/feature/list`, {
        waitUntil: "domcontentloaded",
    });
    await page.evaluate(
        ({ nodes, edges, name }) => {
            localStorage.setItem("nodes", JSON.stringify(nodes));
            localStorage.setItem("edges", JSON.stringify(edges));
            localStorage.setItem(
                "workflowMeta",
                JSON.stringify({
                    id: null,
                    name,
                    description: "合成样本，本地离线验收",
                }),
            );
        },
        { nodes, edges, name },
    );
    await page.goto(`${origin}/workspace`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`.react-flow__node[data-id="${nodes[0].id}"]`);
    await fitCanvas();
}

async function fitCanvas() {
    const button = await page.$('button[aria-label="Fit View"]');
    if (button) await button.click();
    await pause(400);
}

async function state() {
    await page.waitForFunction(() => {
        const nodes = JSON.parse(localStorage.getItem("nodes") || "[]");
        const ids = [...document.querySelectorAll(".react-flow__node")].map(
            (el) => el.dataset.id,
        );
        return (
            nodes.length === ids.length &&
            nodes.every((node) => ids.includes(node.id))
        );
    });
    return page.evaluate(() => ({
        nodes: JSON.parse(localStorage.getItem("nodes")),
        edges: JSON.parse(localStorage.getItem("edges")),
    }));
}

async function clickButton(nodeId, label) {
    const node = `.react-flow__node[data-id="${nodeId}"]`;
    await page.waitForFunction(
        ({ node, label }) =>
            [...document.querySelectorAll(`${node} button`)].some(
                (b) => b.textContent.trim() === label && !b.disabled,
            ),
        { timeout: 30000 },
        { node, label },
    );
    const buttons = await page.$$(`${node} button`);
    for (const button of buttons) {
        if (
            await button.evaluate(
                (el, expected) => el.textContent.trim() === expected,
                label,
            )
        ) {
            await button.click();
            return;
        }
    }
    throw new Error(`Missing ${label} button`);
}

async function task(nodeId, label, feature) {
    const creation = page.waitForResponse(
        (r) =>
            r.url().endsWith("/api/task/create") &&
            r.request().method() === "POST",
    );
    const [response] = await Promise.all([
        creation,
        clickButton(nodeId, label),
    ]);
    assert.equal(response.status(), 200);
    const submitted = JSON.parse(response.request().postData());
    assert.equal(submitted.feature, feature);
    const { taskId } = await response.json();
    await page.waitForFunction(
        async (id) => {
            const { tasks } = await (
                await fetch("/api/task/list", { cache: "no-store" })
            ).json();
            return tasks.some(
                (t) =>
                    t.id === id && ["completed", "failed"].includes(t.status),
            );
        },
        { polling: 250, timeout: 60000 },
        taskId,
    );
    const row = await page.evaluate(
        async (id) =>
            (await (await fetch("/api/task/list")).json()).tasks.find(
                (t) => t.id === id,
            ),
        taskId,
    );
    assert.equal(row.status, "completed", row.error);
    await page.waitForFunction(
        (id) =>
            JSON.parse(localStorage.getItem("edges") || "[]").some(
                (edge) => edge.source === id,
            ),
        {},
        nodeId,
    );
    write(`task-${taskId}.json`, { submitted, row });
    return {
        taskId,
        submitted,
        result:
            typeof row.result === "string"
                ? JSON.parse(row.result)
                : row.result,
    };
}

function findAudio(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory()
            ? findAudio(full)
            : /\.(wav|m4a)$/i.test(entry.name)
              ? [full]
              : [];
    });
}

try {
    await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const mockBase = `http://127.0.0.1:${mock.address().port}/v1`;
    fs.writeFileSync(
        path.join(qaData, "settings.json"),
        JSON.stringify({
            OPENAI_API_KEY: randomUUID(),
            OPENAI_BASE_URL: mockBase,
            OPENAI_CHAT_MODEL: "qwen-plus",
        }),
    );
    // Copy the already provisioned environment to keep package installation and
    // marker writes out of the user's existing environment during this test.
    fs.cpSync(
        path.join(root, "data/.tongflow/plugin-venv"),
        path.join(qaData, ".tongflow/plugin-venv"),
        { recursive: true, verbatimSymlinks: true },
    );
    const portServer = net.createServer();
    await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const port = portServer.address().port;
    await new Promise((resolve) => portServer.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    const appLog = fs.openSync(path.join(output, "server.log"), "a");
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
                TONGFLOW_AUTH_TOKEN: "",
                TONGFLOW_DATA_DIR: qaData,
                PYTHON: path.join(qaData, ".tongflow/plugin-venv/bin/python"),
                NEXT_TELEMETRY_DISABLED: "1",
            },
            stdio: ["ignore", appLog, appLog],
        },
    );
    fs.closeSync(appLog);
    for (let i = 0; ; i++) {
        try {
            if ((await fetch(`${base}/workspace`)).ok) break;
        } catch {
            /* starting */
        }
        assert.ok(
            i < 100 && app.exitCode === null,
            "Acceptance server failed to start",
        );
        await pause(200);
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
    page.on("console", (message) => {
        if (["warn", "error"].includes(message.type()))
            console.log(`Browser ${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => console.log(`Browser exception: ${error}`));
    await page.setViewport({ width: 1600, height: 1050 });
    await page.setCookie({ name: "NEXT_LOCALE", value: "zh", url: base });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const url = new URL(req.url());
        if (
            ["http:", "https:"].includes(url.protocol) &&
            !["localhost", "127.0.0.1"].includes(url.hostname)
        )
            req.abort();
        else req.continue();
    });
    await page.goto(`${base}/workspace`, { waitUntil: "networkidle0" });

    for (const filename of [
        "short.md",
        "short.txt",
        "short.docx",
        "long.txt",
        "existing.pdf",
    ]) {
        console.log(
            `Checking upload / extract / material / split: ${filename}`,
        );
        const expected = fs.readFileSync(
            path.join(fixtures, `${filename}.expected.txt`),
            "utf8",
        );
        await seed(
            [
                {
                    id: "upload",
                    type: "addFileNode",
                    position: { x: 0, y: 0 },
                    data: {},
                },
            ],
            [],
            `${filename} 上传验收`,
        );
        const uploadInput = await page.$('input[type="file"]');
        assert.match(await uploadInput.evaluate((el) => el.accept), /\.md/);
        const uploadResponse = page.waitForResponse(
            (r) =>
                r.url().endsWith("/api/upload") &&
                r.request().method() === "POST",
        );
        await uploadInput.uploadFile(path.join(fixtures, filename));
        const { fileKey } = await (await uploadResponse).json();
        assert.ok(fileKey.endsWith(path.extname(filename)));
        await page.waitForSelector(".react-flow__node-fileNode");
        await fitCanvas();
        await page.screenshot({
            path: path.join(shots, `${filename}-uploaded.png`),
        });

        await seed(
            [
                {
                    id: "document",
                    type: "fileNode",
                    position: { x: 0, y: 0 },
                    data: { fileKeys: [fileKey] },
                },
                {
                    id: "parse",
                    type: "fileGenTextNode",
                    position: { x: 400, y: 0 },
                    data: {
                        pluginId: "tongflow-api-openai",
                        fileKeys: [fileKey],
                    },
                },
            ],
            [
                {
                    id: "parse-edge",
                    source: "document",
                    sourceHandle: "out:fileNode",
                    target: "parse",
                    targetHandle: "in:document",
                },
            ],
            `${filename} 解析验收`,
        );
        const before = calls.length;
        const parsed = await task("parse", "解析文档", "parse-document");
        assert.equal(
            calls.length - before,
            filename.endsWith(".pdf") ? 1 : 0,
            "Local documents must never call a model",
        );
        await page.waitForFunction(
            () =>
                document.querySelectorAll(".react-flow__node-textNode").length >
                0,
        );
        let graph = await state();
        const textNode = graph.nodes.find((n) => n.type === "textNode");
        assert.equal(
            textNode.data.texts[0],
            expected,
            `${filename}: extracted text mismatch`,
        );
        fs.writeFileSync(
            path.join(output, "extracted", `${filename}.txt`),
            textNode.data.texts[0],
        );
        await fitCanvas();
        await page.screenshot({
            path: path.join(shots, `${filename}-extracted.png`),
        });
        await page.waitForFunction(
            async (id) =>
                (
                    await (await fetch("/api/material?type=text")).json()
                ).materials.some((m) => m.taskId === id),
            {},
            parsed.taskId,
        );
        const material = await page.evaluate(
            async (id) =>
                (
                    await (await fetch("/api/material?type=text")).json()
                ).materials.find((m) => m.taskId === id),
            parsed.taskId,
        );
        assert.equal(material.content.texts[0], expected);
        write(`material-${filename}.json`, material);

        const model =
            filename === "long.txt" ? "deepseek-v4.1-flash" : "qwen-plus";
        graph.nodes.push({
            id: "split",
            type: "splitTextNode",
            position: { x: 1250, y: 0 },
            data: {
                pluginId: "tongflow-api-openai",
                pluginModel: model,
                userPrompt:
                    "按自然段落分段，逐字保留原文、中文和标点；每段适合后续批量语音合成。",
            },
        });
        graph.edges.push({
            id: "split-edge",
            source: textNode.id,
            sourceHandle: "out:textNode",
            target: "split",
            targetHandle: "in:text",
        });
        await seed(
            graph.nodes,
            graph.edges,
            `${filename} → 智能分段（本地接口验收）`,
        );
        const split = await task("split", "执行", "split-text");
        assert.equal(split.submitted.prompt.text, expected);
        assert.equal(split.submitted.model, model);
        graph = await state();
        const splitOutputEdges = graph.edges.filter(
            (e) => e.source === "split",
        );
        assert.ok(
            splitOutputEdges.length,
            "Split output is not connected to a text asset",
        );
        const segments = splitOutputEdges.flatMap(
            (edge) => graph.nodes.find((n) => n.id === edge.target).data.texts,
        );
        assert.deepEqual(segments, split.result.texts);
        assert.equal(
            sha(Buffer.from(segments.join(""))),
            sha(Buffer.from(expected)),
            "Split text lost, rewrote, or reordered source characters",
        );
        if (filename === "long.txt") {
            assert.ok(segments.length > 50);
            assert.ok(segments.every((s) => Array.from(s).length <= 1000));
        }
        await fitCanvas();
        await page.screenshot({
            path: path.join(shots, `${filename}-split.png`),
        });
        write(`workflow-${filename}.json`, graph);
        if (filename === "long.txt") {
            const executable = {
                name: "长篇文档完整引擎验收",
                version: "1.0",
                inputs: [],
                outputs: [],
                dataNodes: [
                    {
                        id: "engine-source",
                        type: "fileNode",
                        dataType: "file",
                        isInput: false,
                        staticData: { fileKeys: [fileKey] },
                        level: 0,
                    },
                ],
                executableNodes: [
                    {
                        id: "engine-parse",
                        type: "fileGenTextNode",
                        feature: "parse-document",
                        pluginId: "tongflow-api-openai",
                        bindings: {
                            document: {
                                kind: "handle",
                                consumerShape: "scalar",
                                sources: [
                                    {
                                        fromNodeId: "engine-source",
                                        fromField: "fileKeys",
                                    },
                                ],
                            },
                        },
                        outputs: [
                            {
                                sourceField: "text",
                                nodeType: "textNode",
                                dataField: "texts",
                                expandEach: false,
                            },
                        ],
                        dependencies: ["engine-source"],
                        level: 1,
                    },
                    {
                        id: "engine-split",
                        type: "splitTextNode",
                        feature: "split-text",
                        pluginId: "tongflow-api-openai",
                        model: "qwen-plus",
                        bindings: {
                            text: {
                                kind: "handle",
                                consumerShape: "scalar",
                                sources: [
                                    {
                                        fromNodeId: "engine-parse",
                                        fromField: "text",
                                    },
                                ],
                            },
                            userPrompt: {
                                kind: "config",
                                value: "按原文顺序分段，每段不超过1000字。",
                            },
                        },
                        outputs: [
                            {
                                sourceField: "texts",
                                nodeType: "textNode",
                                dataField: "texts",
                                expandEach: true,
                            },
                        ],
                        dependencies: ["engine-parse"],
                        level: 2,
                    },
                ],
                executionLevels: [
                    ["engine-source"],
                    ["engine-parse"],
                    ["engine-split"],
                ],
                dataNodeEdges: [],
                originalFlow: graph,
            };
            const engine = await page.evaluate(
                async ({ executable, flow }) => {
                    const saved = await fetch("/api/workspace/save", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: executable.name,
                            flow,
                            executable,
                        }),
                    });
                    if (!saved.ok)
                        throw new Error("Engine workflow save failed");
                    const { workflowId } = await saved.json();
                    const created = await fetch("/api/workflow/execute", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ workflowId }),
                    });
                    if (!created.ok) throw new Error(await created.text());
                    const { taskId } = await created.json();
                    const stream = await fetch(
                        `/api/task/wait?taskId=${taskId}`,
                    );
                    const raw = await stream.text();
                    const events = raw
                        .split("\n\n")
                        .filter((s) => s.startsWith("data: "))
                        .map((s) => JSON.parse(s.slice(6)));
                    return { workflowId, taskId, events };
                },
                { executable, flow: graph },
            );
            write("long-engine-workflow.json", { executable, ...engine });
            const done = engine.events.find(
                (event) => event.status === "WORKFLOW_COMPLETED",
            );
            assert.ok(
                done,
                "Long workflow engine did not complete successfully",
            );
            assert.equal(
                sha(Buffer.from(done.data.outputs["engine-parse"].text)),
                sha(Buffer.from(expected)),
            );
            assert.equal(
                sha(
                    Buffer.from(
                        done.data.outputs["engine-split"].texts.join(""),
                    ),
                ),
                sha(Buffer.from(expected)),
            );
            records.longEngineWorkflow = {
                workflowId: engine.workflowId,
                taskId: engine.taskId,
                exactExtractedTextMatch: true,
                splitCoverageMatch: true,
            };
        }
        records.documents.push({
            filename,
            uploadKey: fileKey,
            parseTaskId: parsed.taskId,
            textMaterialId: material.id,
            exactTextMatch: true,
            textSha256: sha(Buffer.from(expected)),
            characters: Array.from(expected).length,
            splitTaskId: split.taskId,
            model,
            segments: segments.length,
            maxSegmentCharacters: Math.max(
                ...segments.map((s) => Array.from(s).length),
            ),
            providerCallsDuringExtraction: filename.endsWith(".pdf") ? 1 : 0,
        });
        write("results.json", records);
    }

    const audioCandidates = findAudio(path.join(root, "data/uploads")).sort(
        (a, b) => fs.statSync(a).size - fs.statSync(b).size,
    );
    const audioFiles = [
        audioCandidates.find(
            (p) =>
                p.includes(`${path.sep}tasks${path.sep}`) && p.endsWith(".wav"),
        ),
        audioCandidates.find((p) => p.endsWith(".m4a")),
    ].filter(Boolean);
    assert.ok(
        audioFiles.length,
        "An existing local audio file is required; this script never generates one",
    );
    const cdp = await browser.target().createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
    });
    for (const source of audioFiles) {
        const fileKey = path.relative(path.join(root, "data/uploads"), source);
        const dest = path.join(qaData, "uploads", fileKey);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(source, dest);
        console.log(
            `Checking existing audio playback and actual download: ${path.extname(source)}`,
        );
        await seed([
            {
                id: "audio",
                type: "audioNode",
                position: { x: 0, y: 0 },
                data: { fileKeys: [fileKey] },
            },
        ]);
        await page.waitForFunction(() => {
            const a = document.querySelector("audio");
            return a?.readyState >= 1 && a.duration > 0;
        });
        const playback = await page.$eval("audio", async (a) => {
            await a.play();
            return {
                duration: Number.isFinite(a.duration)
                    ? a.duration
                    : "unknown (streaming WAV header)",
                readyState: a.readyState,
                error: a.error?.message || null,
            };
        });
        await page.waitForFunction(
            () => document.querySelector("audio").currentTime > 0.2,
        );
        await page.$eval("audio", (a) => a.pause());
        const urlBefore = page.url();
        const pagesBefore = (await browser.pages()).length;
        const complete = new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("Browser download timeout")),
                30000,
            );
            const listener = (event) => {
                if (event.state === "completed") {
                    clearTimeout(timer);
                    cdp.off("Browser.downloadProgress", listener);
                    resolve(event);
                } else if (event.state === "canceled") {
                    clearTimeout(timer);
                    reject(new Error("Browser download canceled"));
                }
            };
            cdp.on("Browser.downloadProgress", listener);
        });
        const menu = await page.$(
            '.react-flow__node-audioNode button[aria-haspopup="menu"]',
        );
        assert.ok(menu, "Audio action menu missing");
        await menu.click();
        await page.waitForSelector('[role="menuitem"]');
        await page.screenshot({
            path: path.join(
                shots,
                `${path.extname(source).slice(1)}-download-menu.png`,
            ),
        });
        const item = (await page.$$('[role="menuitem"]'))[0];
        assert.equal(
            await item.evaluate((el) => el.textContent.trim()),
            "下载",
        );
        await item.click();
        const event = await complete;
        const saved = path.join(downloads, path.basename(source));
        assert.ok(
            fs.existsSync(saved),
            "Browser did not create the expected file",
        );
        assert.equal(sha(fs.readFileSync(saved)), sha(fs.readFileSync(source)));
        assert.equal(page.url(), urlBefore);
        assert.equal(
            (await browser.pages()).length,
            pagesBefore,
            "Download opened a new tab",
        );
        const probe = JSON.parse(
            execFileSync(
                "ffprobe",
                [
                    "-v",
                    "error",
                    "-show_format",
                    "-show_streams",
                    "-of",
                    "json",
                    saved,
                ],
                { encoding: "utf8" },
            ),
        );
        execFileSync(
            "ffmpeg",
            ["-v", "error", "-i", saved, "-f", "null", "-"],
            { stdio: "pipe" },
        );
        await page.screenshot({
            path: path.join(
                shots,
                `${path.extname(source).slice(1)}-downloaded.png`,
            ),
        });
        records.audio.push({
            sourceFileKey: fileKey,
            downloadedFile: saved,
            sourceSha256: sha(fs.readFileSync(source)),
            downloadedSha256: sha(fs.readFileSync(saved)),
            bytes: fs.statSync(saved).size,
            unchangedTabCount: pagesBefore,
            playback,
            downloadEvent: event,
            probe,
            fullDecodePassed: true,
        });
        const attachment = await fetch(
            `${base}/api/uploads/${fileKey}?download=${encodeURIComponent("中文旁白.mp3")}`,
        );
        assert.match(
            attachment.headers.get("content-disposition"),
            /^attachment;/,
        );
        assert.equal(
            sha(Buffer.from(await attachment.arrayBuffer())),
            sha(fs.readFileSync(source)),
        );
        records.audio.at(-1).contentDisposition = attachment.headers.get(
            "content-disposition",
        );
        write("results.json", records);
    }

    const audioKey = records.audio[0].sourceFileKey;
    await page.evaluate(async (fileKey) => {
        const response = await fetch("/api/material", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "验收已有音频",
                type: "audio",
                content: { fileKeys: [fileKey] },
            }),
        });
        if (!response.ok) throw new Error("Audio material save failed");
    }, audioKey);
    await seed([
        {
            id: "library",
            type: "addAudioNode",
            position: { x: 0, y: 0 },
            data: { activeTab: "library" },
        },
    ]);
    await page.waitForFunction(() =>
        document.body.textContent.includes("验收已有音频"),
    );
    const libraryItem = await page.waitForSelector("p::-p-text(验收已有音频)");
    await libraryItem.click();
    await page.waitForSelector(".react-flow__node-audioNode audio");
    await fitCanvas();
    await page.screenshot({
        path: path.join(shots, "audio-library-reused.png"),
    });
    records.audioLibraryReused = true;

    await seed([
        {
            id: "qwen-clone",
            type: "textGenSpeechCloneNode",
            position: { x: 0, y: 0 },
            data: { pluginId: "tongflow-api-qwen-audio" },
        },
        {
            id: "qwen-audio",
            type: "textGenAudioNode",
            position: { x: 500, y: 0 },
            data: { pluginId: "tongflow-api-qwen-audio" },
        },
    ]);
    await page.waitForFunction(
        () =>
            [
                ...document.querySelectorAll(
                    '.react-flow__node button[role="combobox"]',
                ),
            ].filter((e) => e.textContent === "Qwen Audio").length === 2,
    );
    assert.equal(
        await page.$$eval('input[aria-label="模型"]', (els) => els.length),
        0,
    );
    await page.screenshot({
        path: path.join(shots, "qwen-audio-regression.png"),
    });
    records.qwenAudioUiUnchanged = true;
    // Bounded long-document windows deliberately use multiple requests.
    // Extraction/text integrity was checked above for every whole document.
    assert.equal(calls.filter((c) => c.kind === "pdf").length, 1);
    const splits = calls.filter((c) => c.kind === "split-text");
    assert.ok(splits.length >= 6);
    assert.ok(splits.every((c) => c.sourceChars <= 8000));
    assert.ok(calls.every((c) => !c.error));
    records.providerCalls = calls;
    records.status = "passed";
    write("results.json", records);
    console.log(
        JSON.stringify(
            {
                status: records.status,
                documents: records.documents,
                audioCount: records.audio.length,
                output,
            },
            null,
            2,
        ),
    );
} catch (error) {
    records.status = "failed";
    records.error = String(error.stack || error);
    records.providerCalls = calls;
    write("results.json", records);
    if (page) {
        await page
            .screenshot({ path: path.join(shots, "failure.png") })
            .catch(() => {});
        fs.writeFileSync(
            path.join(output, "failure-dom.txt"),
            await page.evaluate(() => document.body.innerText).catch(String),
        );
    }
    console.error(error);
    console.error(`Evidence: ${output}`);
    process.exitCode = 1;
} finally {
    // Chrome can finish its work while its automation pipe lingers on macOS.
    // Bound cleanup to this script's own browser, after all assertions settle.
    if (browser) {
        await Promise.race([browser.close(), pause(5000)]);
        if (browser.process()?.exitCode === null) browser.process().kill();
    }
    if (app) app.kill("SIGTERM");
    mock.closeAllConnections();
    await new Promise((resolve) => mock.close(resolve));
}
// Do not let an idle automation transport keep this command alive. The catch
// above preserves a failing assertion's nonzero status.
process.exit(process.exitCode ?? 0);
