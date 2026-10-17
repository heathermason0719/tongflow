/** Private, existing-audio Chrome acceptance. No model calls. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const root = process.cwd(),
    backup = process.argv[2];
assert.ok(backup && path.isAbsolute(backup), "Supply explicit private backup");
const output = fs.mkdtempSync(path.join(root, ".tongflow/fcp-export/browser-"));
const data = path.join(output, "data"),
    destination = path.join(output, "exports"),
    downloads = path.join(output, "downloads");
for (const d of [data, destination, downloads]) fs.mkdirSync(d);
fs.copyFileSync(
    path.join(backup, "tongflow.db"),
    path.join(data, "tongflow.db"),
);
fs.symlinkSync(path.join(backup, "uploads"), path.join(data, "uploads"), "dir");
fs.writeFileSync(
    path.join(data, "settings.json"),
    JSON.stringify({
        OPENAI_API_KEY: "inert",
        OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
        DASHSCOPE_API_KEY: "inert",
        DASHSCOPE_BASE_URL: "http://127.0.0.1:9",
    }),
);
const db = new Database(path.join(backup, "tongflow.db"), { readonly: true });
const saved = db
    .prepare("SELECT flow FROM workflows WHERE name=?")
    .get("长文配音工作流（已恢复16段）");
db.close();
assert.ok(saved);
const flow = JSON.parse(saved.flow);
const audio = flow.nodes.find(
    (n) => n.type === "audioNode" && n.data.fileKeys?.length === 16,
);
const clone = flow.nodes.find(
    (n) => n.data.feature === "text-gen-speech-clone",
);
assert.ok(audio && clone);
assert.deepEqual(
    audio.data.fileKeys,
    clone.data.speechResults.map((r) => r.audio),
);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {
    status: "running",
    realExistingAudio: true,
    checks: {},
    files: [],
};
const save = (n, v) =>
    fs.writeFileSync(path.join(output, n), JSON.stringify(v, null, 2));
let app,
    browser,
    page,
    creates = 0;
async function click(text, scope = "body") {
    for (const b of await page.$$(`${scope} button`))
        if (await b.evaluate((b, t) => b.textContent.trim() === t, text)) {
            await b.click();
            return;
        }
    throw Error(`Missing button ${text}`);
}
async function focus(id) {
    await page.click('button[aria-label="Fit View"]');
    await pause(400);
    const b = await (
        await page.$(`.react-flow__node[data-id="${id}"]`)
    ).boundingBox();
    await page.mouse.move(100, 150);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(
        100 + 900 - b.x - b.width / 2,
        150 + 550 - b.y - b.height / 2,
        { steps: 15 },
    );
    await page.mouse.up({ button: "middle" });
    await pause(350);
}
async function pickDirectory() {
    const script = `ObjC.import("AppKit"); function run(argv) { const app=$.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0])); app.activateWithOptions(3); const se=Application("System Events"); delay(1.5); se.keystroke("g", {using:["command down","shift down"]}); delay(1); se.keystroke(argv[1]); delay(0.5); se.keyCode(36); delay(1); se.keyCode(36); delay(1); se.keyCode(36); }`;
    execFileSync(
        "osascript",
        [
            "-l",
            "JavaScript",
            "-e",
            script,
            String(browser.process().pid),
            destination,
        ],
        { timeout: 15000 },
    );
    // System Events resolves evaluated references by application name; Chrome
    // instances share that name. Keep the numeric process index in the entire
    // button specifier so only this QA browser grants its exports directory.
    const permission = `on run argv
set targetPid to (item 1 of argv) as integer
tell application "System Events"
repeat 25 times
set processIds to unix id of every application process
set chosen to 0
repeat with i from 1 to count processIds
if item i of processIds is targetPid then set chosen to i
end repeat
if chosen is 0 then error "Test Chrome stopped"
if exists window "允许此网站修改文件？" of application process chosen then
click button "允许" of group 1 of group 2 of group 1 of group 1 of group "允许此网站修改文件？" of window "允许此网站修改文件？" of application process chosen
return "test-directory write permission granted"
end if
delay 0.2
end repeat
end tell
end run`;
    execFileSync(
        "osascript",
        ["-e", permission, String(browser.process().pid)],
        { timeout: 15000 },
    );
}
async function exportOnce() {
    await focus(audio.id);
    await page.click(
        `.react-flow__node[data-id="${audio.id}"] button[aria-haspopup="menu"]`,
    );
    await page.waitForSelector('[data-testid="export-fcp-project"]');
    await page.click('[data-testid="export-fcp-project"]');
    await page.waitForSelector("#fcp-project-name");
    await page.$eval("#fcp-project-name", (e) => {
        Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
        ).set.call(e, "TongFlow_16段配音验收");
        e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(
        () =>
            document.querySelector("#fcp-project-name").value ===
            "TongFlow_16段配音验收",
    );
    await click("选择位置并导出", '[data-testid="fcp-export-dialog"]');
    await pause(800);
    await pickDirectory();
    await page.waitForSelector('[data-testid="fcp-export-success"]', {
        timeout: 180000,
    });
    const status = await page.$eval(
        '[data-testid="fcp-export-success"]',
        (e) => e.textContent,
    );
    await page.screenshot({
        path: path.join(
            output,
            `private-export-${fs.readdirSync(destination).length}.png`,
        ),
    });
    await click("关闭", '[data-testid="fcp-export-dialog"]');
    return status;
}
try {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const port = s.address().port;
    await new Promise((r) => s.close(r));
    const base = `http://127.0.0.1:${port}`,
        log = fs.openSync(path.join(output, "server.log"), "a");
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
            if ((await fetch(`${base}/workspace`)).ok) break;
        } catch {}
        assert.ok(i < 100 && app.exitCode === null);
        await pause(250);
    }
    const module = process.env.PUPPETEER_MODULE || "puppeteer-core";
    const puppeteer = (
        await import(
            path.isAbsolute(module) ? pathToFileURL(module).href : module
        )
    ).default;
    browser = await puppeteer.launch({
        executablePath:
            process.env.CHROME_PATH ||
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: false,
        userDataDir: path.join(output, "chrome"),
        args: ["--lang=zh-CN", "--autoplay-policy=no-user-gesture-required"],
    });
    fs.writeFileSync(
        path.join(output, "chrome-pid"),
        String(browser.process().pid),
    );
    page = (await browser.pages())[0];
    await page.setViewport({ width: 1800, height: 1200 });
    await page.setCookie({ name: "NEXT_LOCALE", value: "zh", url: base });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", (r) => {
        const u = new URL(r.url());
        if (
            r.method() === "POST" &&
            /\/api\/(task\/create|workspace\/execute)/.test(u.pathname)
        ) {
            creates++;
            r.abort();
        } else if (
            ["http:", "https:"].includes(u.protocol) &&
            !["127.0.0.1", "localhost"].includes(u.hostname)
        )
            r.abort();
        else r.continue();
    });
    await page.goto(`${base}/api/feature/list`);
    await page.evaluate((flow) => {
        localStorage.nodes = JSON.stringify(flow.nodes);
        localStorage.edges = JSON.stringify(flow.edges);
        localStorage.workflowMeta = JSON.stringify({
            id: 2,
            name: "长文配音工作流（已恢复16段）",
            description: "",
        });
    }, flow);
    await page.goto(`${base}/workspace`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".react-flow__node");
    await pause(1500);
    const before = await page.evaluate(() => ({
        nodes: localStorage.nodes,
        edges: localStorage.edges,
    }));
    console.log("Native Chrome export; private evidence:", output);
    await exportOnce();
    const afterExport = await page.evaluate(() => ({
        nodes: localStorage.nodes,
        edges: localStorage.edges,
    }));
    const fingerprint = (state) =>
        sha(
            Buffer.from(
                JSON.stringify({
                    nodes: JSON.parse(state.nodes).map((n) => ({
                        id: n.id,
                        type: n.type,
                        data: n.data,
                    })),
                    edges: JSON.parse(state.edges).map(
                        ({ selected, ...e }) => e,
                    ),
                }),
            ),
        );
    assert.equal(
        fingerprint(afterExport),
        fingerprint(before),
        "Export changed business data",
    );
    await exportOnce();
    report.checks.repeatedExports = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".react-flow__node");
    await page.click('button[aria-label="我的工作流"]');
    await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="dialog"] h3')].some(
            (h) => h.textContent.trim() === "长文配音工作流（已恢复16段）",
        ),
    );
    const card = await page.$$('[role="dialog"] div.group');
    for (const c of card)
        if (
            await c.evaluate((c) =>
                [...c.querySelectorAll("h3")].some(
                    (h) =>
                        h.textContent.trim() === "长文配音工作流（已恢复16段）",
                ),
            )
        ) {
            await c.hover();
            await (await c.$("button")).click();
            break;
        }
    await page.waitForSelector('[data-testid="speech-result-row"]');
    await exportOnce();
    report.checks.reopenedWorkflowExport = true;
    const directories = fs.readdirSync(destination).sort();
    assert.equal(directories.length, 3);
    for (const folder of directories) {
        const dir = path.join(destination, folder);
        assert.ok(
            fs.existsSync(path.join(dir, "TongFlow_16段配音验收.fcpxml")),
        );
        const filenames = fs.readdirSync(path.join(dir, "Audio")).sort();
        assert.deepEqual(
            filenames,
            Array.from(
                { length: 16 },
                (_, i) => `${String(i + 1).padStart(2, "0")}.wav`,
            ),
        );
    }
    const first = path.join(destination, directories[0]);
    for (let i = 0; i < 16; i++) {
        const filename = `${String(i + 1).padStart(2, "0")}.wav`,
            source = path.join(backup, "uploads", audio.data.fileKeys[i]),
            copy = path.join(first, "Audio", filename);
        const sourceSha256 = sha(fs.readFileSync(source));
        assert.equal(sourceSha256, sha(fs.readFileSync(copy)));
        execFileSync("ffmpeg", ["-v", "error", "-i", copy, "-f", "null", "-"], {
            stdio: "pipe",
        });
        report.files.push({
            segment: i + 1,
            filename,
            bytes: fs.statSync(copy).size,
            sourceSha256,
            exportSha256: sha(fs.readFileSync(copy)),
            fullDecode: true,
        });
    }
    await focus(clone.id);
    const cdp = await page.createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloads,
        eventsEnabled: true,
    });
    const row = (await page.$$('[data-testid="speech-result-row"]'))[6];
    await (await row.$("button")).click();
    for (let i = 0; !fs.existsSync(path.join(downloads, "07.wav")); i++) {
        assert.ok(i < 100);
        await pause(100);
    }
    assert.equal(
        sha(fs.readFileSync(path.join(downloads, "07.wav"))),
        report.files[6].sourceSha256,
    );
    report.checks.numberedSingleDownload = true;
    const after = await page.evaluate(() => ({
        nodes: localStorage.nodes,
        edges: localStorage.edges,
    }));
    // Reopening uses the saved graph; export itself never writes canvas data.
    assert.equal(
        JSON.parse(after.nodes).find((n) => n.id === clone.id).data
            .speechResults.length,
        16,
    );
    report.checks.originalResultsPreserved = true;
    report.checks.noGenerationRequests = creates === 0;
    assert.equal(creates, 0);
    assert.equal(errors.length, 0, errors.join("\n"));
    const invalid = await page.evaluate(async (keys) => {
        const r = await fetch("/api/export/fcp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "missing-test",
                fileKeys: [keys[0], "missing-export-test.wav", keys[1]],
            }),
        });
        return { status: r.status, error: (await r.json()).error };
    }, audio.data.fileKeys);
    assert.equal(invalid.status, 400);
    assert.ok(invalid.error.includes("第 2 段"));
    assert.equal(fs.readdirSync(destination).length, 3);
    report.checks.missingSourceRejected = true;
    report.checks.nativeDirectoryPicker = true;
    report.checks.browserDirectoryWrites = true;
    report.exportDirectory = first;
    report.status = "passed";
    save("results-private.json", report);
    console.log(
        JSON.stringify({
            status: report.status,
            output,
            checks: report.checks,
        }),
    );
} catch (error) {
    save("results-private.json", { ...report, error: String(error) });
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
    if (browser) await browser.close();
    if (app) app.kill("SIGTERM");
}
