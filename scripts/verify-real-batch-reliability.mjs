/** Explicit private backup input only. Never reads the current browser profile,
 * never invokes models, and keeps real scripts/audio/screenshots under .tongflow.
 * Usage: node scripts/verify-real-batch-reliability.mjs /absolute/private/backup
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd(),
    backup = process.argv[2];
assert.ok(
    backup && path.isAbsolute(backup),
    "Supply an explicit private backup directory",
);
const snapshot = JSON.parse(
    fs.readFileSync(path.join(backup, "live-memory-backup.json"), "utf8"),
);
const original = snapshot.memoryFlow;
assert.ok(original?.nodes?.length && original.edges);
const originalClone = original.nodes.find(
    (n) => n.data.feature === "text-gen-speech-clone",
);
assert.equal(originalClone?.data.speechResults?.length, 16);
const originalRows = originalClone.data.speechResults;
assert.ok(originalRows.every((r) => r.status === "COMPLETED" && r.audio));
const output = fs.mkdtempSync(
    path.join(root, ".tongflow/reliability/real-browser-"),
);
const data = path.join(output, "data"),
    downloads = path.join(output, "downloads");
fs.mkdirSync(data);
fs.mkdirSync(downloads);
fs.copyFileSync(
    path.join(backup, "tongflow.db"),
    path.join(data, "tongflow.db"),
);
fs.symlinkSync(path.join(backup, "uploads"), path.join(data, "uploads"), "dir");
fs.writeFileSync(
    path.join(data, "settings.json"),
    JSON.stringify({
        OPENAI_API_KEY: "inert-offline-test",
        OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
        DASHSCOPE_API_KEY: "inert-offline-test",
        DASHSCOPE_BASE_URL: "http://127.0.0.1:9",
    }),
    { mode: 0o600 },
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const save = (name, value) =>
    fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
const report = {
    status: "running",
    kind: "existing real WAVs; no model generation",
    checks: {},
    files: [],
};
let app,
    browser,
    page,
    proxy,
    slowNextDownload = false,
    failNextDownload = false,
    failNextSave = false;
let attemptedGeneration = 0;

async function port() {
    const socket = net.createServer();
    await new Promise((r) => socket.listen(0, "127.0.0.1", r));
    const value = socket.address().port;
    await new Promise((r) => socket.close(r));
    return value;
}
async function button(text, scope = "body") {
    await page.waitForFunction(
        ({ text, scope }) =>
            [...document.querySelectorAll(`${scope} button`)].some(
                (b) => b.textContent.trim() === text && !b.disabled,
            ),
        { timeout: 30000 },
        { text, scope },
    );
    for (const el of await page.$$(`${scope} button`))
        if (
            await el.evaluate(
                (b, expected) => b.textContent.trim() === expected,
                text,
            )
        ) {
            await el.click();
            return;
        }
    throw Error(`Missing button: ${text}`);
}
async function graph() {
    await pause(650);
    return page.evaluate(() => ({
        nodes: JSON.parse(localStorage.getItem("nodes")),
        edges: JSON.parse(localStorage.getItem("edges")),
    }));
}
async function seed(flow) {
    const base = new URL(page.url()).origin;
    await page.goto(`${base}/api/feature/list`);
    await page.evaluate((flow) => {
        localStorage.setItem("nodes", JSON.stringify(flow.nodes));
        localStorage.setItem("edges", JSON.stringify(flow.edges));
        localStorage.setItem(
            "workflowMeta",
            JSON.stringify({ id: null, name: "", description: "" }),
        );
    }, flow);
    await page.goto(`${base}/workspace`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".react-flow__node");
}
async function focus(id) {
    await page.click('button[aria-label="Fit View"]');
    await pause(500);
    const box = await (
        await page.$(`.react-flow__node[data-id="${id}"]`)
    ).boundingBox();
    await page.mouse.move(100, 180);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(
        100 + 900 - box.x - box.width / 2,
        180 + 550 - box.y - box.height / 2,
        { steps: 15 },
    );
    await page.mouse.up({ button: "middle" });
    await page.mouse.move(900, 550);
    await page.mouse.wheel({ deltaY: -350 });
    await pause(450);
}
async function saveDialog() {
    let title;
    for (const candidate of await page.$$("button")) {
        if (
            await candidate.evaluate((el) =>
                ["新创意", "真实16段配音恢复验收"].includes(
                    el.textContent.trim(),
                ),
            )
        ) {
            title = candidate;
            break;
        }
    }
    assert.ok(title, "Workflow title button must be visible");
    await title.hover();
    await (await page.waitForSelector("div.absolute ::-p-text(保存)")).click();
    await page.waitForSelector('[role="dialog"] input');
}
async function successfulSave() {
    const response = page.waitForResponse(
        (r) =>
            /\/api\/workspace\/(save|\d+)$/.test(new URL(r.url()).pathname) &&
            ["POST", "PUT"].includes(r.request().method()),
    );
    const start = Date.now();
    await button("保存", '[role="dialog"]');
    const saved = await response;
    assert.equal(saved.status(), 200);
    const body = await saved.json();
    save(
        "actual-private-save-request.json",
        JSON.parse(saved.request().postData()),
    );
    await page.waitForSelector('[role="dialog"]', { hidden: true });
    return { ...body, durationMs: Date.now() - start };
}
function critical(flow) {
    return flow.nodes
        .map((n) => ({
            id: n.id,
            texts: n.data.texts,
            segmentDraft: n.data.segmentDraft,
            manualTextOverride: n.data.manualTextOverride,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
}
try {
    const backendPort = await port();
    const log = fs.openSync(path.join(output, "server.log"), "a");
    app = spawn(
        process.execPath,
        [
            "node_modules/next/dist/bin/next",
            "start",
            "-H",
            "127.0.0.1",
            "-p",
            String(backendPort),
        ],
        {
            cwd: root,
            env: {
                ...process.env,
                TONGFLOW_DATA_DIR: data,
                TONGFLOW_AUTH_TOKEN: "",
                NEXT_TELEMETRY_DISABLED: "1",
                PYTHON: path.join(
                    root,
                    "data/.tongflow/plugin-venv/bin/python",
                ),
            },
            stdio: ["ignore", log, log],
        },
    );
    fs.closeSync(log);
    for (let i = 0; ; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${backendPort}/workspace`)).ok)
                break;
        } catch {}
        assert.ok(i < 100 && app.exitCode === null);
        await pause(250);
    }
    // A proxy slows ONE real attachment without changing its bytes, so UI
    // interaction can be verified while a real download remains in progress.
    proxy = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (
            failNextDownload &&
            req.method === "HEAD" &&
            url.searchParams.has("download")
        ) {
            failNextDownload = false;
            res.writeHead(404);
            res.end();
            return;
        }
        if (
            failNextSave &&
            /\/api\/workspace\/(save|\d+)$/.test(url.pathname) &&
            ["POST", "PUT"].includes(req.method)
        ) {
            failNextSave = false;
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    error: "Synthetic save interruption; reference: QA-SAVE-RETRY",
                }),
            );
            return;
        }
        const slow =
            slowNextDownload &&
            req.method === "GET" &&
            url.searchParams.has("download");
        if (slow) slowNextDownload = false;
        const upstream = http.request(
            {
                host: "127.0.0.1",
                port: backendPort,
                method: req.method,
                path: req.url,
                headers: req.headers,
            },
            async (response) => {
                res.writeHead(response.statusCode, response.headers);
                if (!slow) {
                    response.pipe(res);
                    return;
                }
                try {
                    for await (const chunk of response) {
                        await pause(120);
                        if (!res.write(chunk))
                            await new Promise((r) => res.once("drain", r));
                    }
                    res.end();
                } catch {
                    res.destroy();
                }
            },
        );
        upstream.on("error", () => {
            if (!res.headersSent) res.writeHead(502);
            res.end();
        });
        req.pipe(upstream);
    });
    await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${proxy.address().port}`;
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
    await page.setCookie({ name: "NEXT_LOCALE", value: "zh", url: base });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const u = new URL(req.url());
        if (
            req.method() === "POST" &&
            ["/api/task/create", "/api/workflow/execute"].includes(u.pathname)
        ) {
            attemptedGeneration++;
            req.abort();
        } else if (
            ["http:", "https:"].includes(u.protocol) &&
            !["127.0.0.1", "localhost"].includes(u.hostname)
        )
            req.abort();
        else req.continue();
    });
    await page.goto(`${base}/api/feature/list`);
    const lost = structuredClone(original),
        clone = lost.nodes.find((n) => n.id === originalClone.id);
    delete clone.data.speechResults;
    delete clone.data.taskBatch;
    clone.data.liveOutput = {};
    clone.data.outputPending = false;
    for (const edge of lost.edges.filter((e) => e.source === clone.id)) {
        const target = lost.nodes.find((n) => n.id === edge.target);
        if (target?.type === "audioNode") target.data.fileKeys = [];
    }
    await seed(lost);
    await focus(clone.id);
    await page.click('[data-testid="recover-task-results"]');
    await page.waitForFunction(
        (id) => {
            const n = JSON.parse(localStorage.getItem("nodes") || "[]").find(
                (n) => n.id === id,
            );
            return (
                n?.data.speechResults?.length === 16 &&
                n.data.speechResults.every((r) => r.status === "COMPLETED")
            );
        },
        { timeout: 60000 },
        clone.id,
    );
    let current = await graph();
    const rows = current.nodes.find((n) => n.id === clone.id).data
        .speechResults;
    assert.deepEqual(
        rows.map((r) => [r.text, r.refAudio, r.audio]),
        originalRows.map((r) => [r.text, r.refAudio, r.audio]),
    );
    assert.deepEqual(critical(current), critical(original));
    report.checks.recoveredFromDatabase = {
        count: rows.length,
        exactTextVoiceAndAudioAssociation: true,
        noTaskCreation: attemptedGeneration === 0,
    };
    const range = await fetch(`${base}/api/uploads/${rows[0].audio}`, {
        headers: { Range: "bytes=0-43" },
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 44);
    report.checks.mediaRange = {
        status: 206,
        returnedBytes: 44,
        contentRange: range.headers.get("content-range"),
    };
    await page.screenshot({
        path: path.join(output, "01-private-recovered-results.png"),
    });
    await saveDialog();
    const name = await page.$('[role="dialog"] input');
    await name.evaluate((el) => {
        el.focus();
        el.select();
    });
    await page.keyboard.type("真实16段配音恢复验收");
    report.checks.saved = await successfulSave();
    await saveDialog();
    failNextSave = true;
    await button("保存", '[role="dialog"]');
    await page.waitForFunction(() =>
        document.body.textContent.includes("保存失败"),
    );
    assert.ok(await page.$('[role="dialog"] input'));
    const detail =
        (await page.$("button::-p-text(Details)")) ||
        (await page.$("button::-p-text(详情)"));
    if (detail) await detail.click();
    await page.waitForFunction(() =>
        document.body.textContent.includes("QA-SAVE-RETRY"),
    );
    report.checks.saveFailureThenRetry = {
        dialogRetained: true,
        diagnosticVisible: true,
        retry: await successfulSave(),
    };
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="speech-result-row"]');
    current = await graph();
    assert.deepEqual(critical(current), critical(original));
    // Replace only the isolated browser's canvas, then use the real library.
    await seed({
        nodes: [
            {
                id: "temporary",
                type: "textNode",
                data: { texts: ["临时测试画布"] },
                position: { x: 0, y: 0 },
            },
        ],
        edges: [],
    });
    await page.click('button[aria-label="我的工作流"]');
    await page.waitForSelector('[role="dialog"]');
    await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="dialog"] h3')].some(
            (h) => h.textContent.trim() === "真实16段配音恢复验收",
        ),
    );
    let savedCard;
    for (const card of await page.$$('[role="dialog"] div.group')) {
        if (
            await card.evaluate((el) =>
                [...el.querySelectorAll("h3")].some(
                    (h) => h.textContent.trim() === "真实16段配音恢复验收",
                ),
            )
        ) {
            savedCard = card;
            break;
        }
    }
    assert.ok(savedCard, "Saved workflow card must be present");
    await savedCard.hover();
    await pause(250);
    await (await savedCard.$("button")).click();
    await page.waitForSelector('[data-testid="speech-result-row"]');
    current = await graph();
    assert.deepEqual(
        current.nodes
            .find((n) => n.id === clone.id)
            .data.speechResults.map((r) => [r.text, r.refAudio, r.audio]),
        originalRows.map((r) => [r.text, r.refAudio, r.audio]),
    );
    assert.deepEqual(critical(current), critical(original));
    assert.deepEqual(
        current.edges.map((e) => [
            e.id,
            e.source,
            e.target,
            e.sourceHandle,
            e.targetHandle,
        ]),
        original.edges.map((e) => [
            e.id,
            e.source,
            e.target,
            e.sourceHandle,
            e.targetHandle,
        ]),
    );
    report.checks.reopenedFromLibrary = {
        textsDraftEditsOrderAndEdgesPreserved: true,
        count: 16,
    };
    await focus(clone.id);
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
    });
    const started = [],
        completed = new Map();
    cdp.on("Browser.downloadWillBegin", (event) => started.push(event));
    cdp.on("Browser.downloadProgress", (event) => {
        if (["completed", "canceled"].includes(event.state))
            completed.set(event.guid, event);
    });
    async function beginDownload(index) {
        const before = started.length;
        const buttons = await page.$$(
            '[data-testid="speech-result-row"] button',
        );
        await buttons[index].click();
        for (let i = 0; started.length === before; i++) {
            assert.ok(i < 100);
            await pause(50);
        }
        return started[before];
    }
    async function finishDownload(event) {
        for (let i = 0; !completed.has(event.guid); i++) {
            assert.ok(i < 600, "Download did not finish");
            await pause(100);
        }
        assert.equal(completed.get(event.guid).state, "completed");
        return path.join(downloads, event.suggestedFilename);
    }
    for (let index = 0; index < rows.length; index++) {
        if (index === 4) {
            failNextDownload = true;
            const before = started.length;
            await (await page.$$('[data-testid="speech-result-row"] button'))[
                index
            ].click();
            await page.waitForFunction(() =>
                [
                    ...document.querySelectorAll(
                        '[data-testid="speech-result-row"] [role="alert"]',
                    ),
                ].some((e) => e.textContent.includes("404")),
            );
            assert.equal(started.length, before);
            report.checks.downloadFailureAndRetry = {
                failedIndex: index + 1,
                clear404: true,
                otherRowsEnabled: true,
            };
        }
        if (index === 7) slowNextDownload = true;
        const event = await beginDownload(index);
        if (index === 7) {
            assert.equal(completed.has(event.guid), false);
            const heartbeat = await page.evaluate(async () => {
                const start = performance.now();
                await new Promise(requestAnimationFrame);
                const result = await fetch("/api/workspace/list");
                return {
                    elapsedMs: performance.now() - start,
                    status: result.status,
                };
            });
            assert.equal(heartbeat.status, 200);
            assert.ok(heartbeat.elapsedMs < 5000);
            assert.equal(completed.has(event.guid), false);
            const split = current.nodes.find((n) => n.type === "splitTextNode");
            await focus(split.id);
            await button(
                "审阅与编辑",
                `.react-flow__node[data-id="${split.id}"]`,
            );
            const editor = await page.$(
                '[data-testid="draft-editor"] textarea',
            );
            const text = await editor.evaluate((el) => el.value);
            await editor.evaluate((el) => {
                el.focus();
                el.setSelectionRange(3, 3);
            });
            await editor.type("离线交互验证");
            assert.equal(
                await editor.evaluate((el) => el.value),
                `${text.slice(0, 3)}离线交互验证${text.slice(3)}`,
            );
            await editor.evaluate((el) => {
                el.focus();
                el.setSelectionRange(3, 3 + "离线交互验证".length);
            });
            await page.keyboard.press("Backspace");
            assert.equal(await editor.evaluate((el) => el.value), text);
            await button("采用当前稿件", '[data-testid="draft-editor"]');
            await button("完成编辑", '[data-testid="draft-editor"]');
            await page.waitForSelector('[data-testid="draft-editor"]', {
                hidden: true,
            });
            report.checks.interactiveDuringDownload = {
                downloadWasInProgress: true,
                heartbeat,
                midTextEditingAndAdoption: true,
            };
            await focus(clone.id);
        }
        const destination = await finishDownload(event),
            source = path.join(backup, "uploads", rows[index].audio);
        const sourceBytes = fs.readFileSync(source),
            downloaded = fs.readFileSync(destination);
        assert.equal(sha(downloaded), sha(sourceBytes));
        const probe = JSON.parse(
            execFileSync(
                process.env.FFPROBE || "/usr/local/bin/ffprobe",
                [
                    "-v",
                    "error",
                    "-show_entries",
                    "format=format_name,duration",
                    "-of",
                    "json",
                    destination,
                ],
                { encoding: "utf8" },
            ),
        );
        execFileSync(
            process.env.FFMPEG || "/usr/local/bin/ffmpeg",
            ["-v", "error", "-i", source, "-f", "null", "-"],
            { stdio: ["ignore", "ignore", "pipe"] },
        );
        execFileSync(
            process.env.FFMPEG || "/usr/local/bin/ffmpeg",
            ["-v", "error", "-i", destination, "-f", "null", "-"],
            { stdio: ["ignore", "ignore", "pipe"] },
        );
        report.files.push({
            segment: index + 1,
            bytes: sourceBytes.length,
            sourceSha256: sha(sourceBytes),
            downloadedSha256: sha(downloaded),
            format: probe.format.format_name,
            duration: Number(probe.format.duration),
            sourceAndDownloadFullyDecoded: true,
        });
        console.log(`Verified existing WAV ${index + 1}/16`);
    }
    const playback = await page.$eval(
        '[data-testid="speech-result-row"] audio',
        async (audio) => {
            await audio.play();
            await new Promise((r) => setTimeout(r, 250));
            const time = audio.currentTime;
            audio.pause();
            audio.currentTime = Math.min(3, audio.duration / 2);
            await audio.play();
            await new Promise((r) => setTimeout(r, 250));
            audio.pause();
            return {
                duration: audio.duration,
                initialTime: time,
                seekedTime: audio.currentTime,
                error: audio.error?.code,
            };
        },
    );
    assert.ok(
        playback.duration > 0 &&
            playback.initialTime > 0 &&
            playback.seekedTime > 0 &&
            !playback.error,
    );
    report.checks.playbackAndSeek = playback;
    assert.equal(attemptedGeneration, 0);
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.equal(report.files.length, 16);
    report.checks.noGenerationRequests = true;
    report.status = "passed";
    await page.screenshot({
        path: path.join(output, "02-private-downloaded-and-responsive.png"),
    });
    save("results-private.json", report);
    console.log(
        JSON.stringify(
            {
                output,
                status: report.status,
                checks: Object.keys(report.checks),
                downloaded: report.files.length,
            },
            null,
            2,
        ),
    );
} catch (error) {
    report.status = "failed";
    report.error = String(error);
    save("results-private.json", report);
    if (page) {
        await page
            .screenshot({ path: path.join(output, "failure-private.png") })
            .catch(() => {});
        fs.writeFileSync(
            path.join(output, "failure-private-dom.txt"),
            await page.evaluate(() => document.body.innerText).catch(String),
        );
    }
    throw error;
} finally {
    if (browser) {
        await Promise.race([browser.close(), pause(5000)]);
        if (browser.process()?.exitCode === null) browser.process().kill();
    }
    if (proxy) {
        proxy.closeAllConnections();
        await new Promise((r) => proxy.close(r));
    }
    if (app) app.kill("SIGTERM");
}
process.exit(process.exitCode ?? 0);
