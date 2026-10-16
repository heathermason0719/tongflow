// Read-only preflight: run BEFORE stopping a self-hosted service.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const repositories = [
    ["TongFlow", root],
    ["OpenAI-compatible plugin", `${root}/plugins/tongflow-api-openai`],
];
const issues = [];
for (const [label, cwd] of repositories) {
    if (!existsSync(cwd)) continue;
    try {
        const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        const branch = git("branch", "--show-current");
        if (branch !== "main") issues.push(`${label}: 当前分支为 ${branch || "detached HEAD"}`);
        if (git("status", "--porcelain")) issues.push(`${label}: 存在未提交文件`);
        if (git("rev-list", "--count", "origin/main..HEAD") !== "0") issues.push(`${label}: 存在本地维护提交`);
    } catch {
        issues.push(`${label}: 无法确认 Git 状态或 origin/main 基线`);
    }
}
if (issues.length) {
    console.error("已停止自动升级：需要先保留并整合本地维护修改。");
    for (const issue of issues) console.error(`- ${issue}`);
    console.error("请按 docs/local-maintenance.md 同步两个仓库，再安排构建和重启。服务和数据尚未改动。");
    process.exitCode = 2;
} else {
    console.log("Git 升级前置检查通过。");
}
