# 本地百炼兼容维护

这是本地自托管安装的维护说明，不增加产品功能。

## 两个独立仓库

| 仓库 | 本地维护分支 | 官方基线 |
| --- | --- | --- |
| TongFlow 主仓库 | `local/bailian-compat` | `be171c969659cd9aa5d25f5082b21004bad9c6cf` |
| `plugins/tongflow-api-openai` | `local/bailian-compat` | `d18ba1e` |

配套 OpenAI 插件的维护提交为 `03fbcd826b45ecf9a737abdeaadd299a3fff8876`。
该插件是独立 Git 仓库，
不是主仓库的子模块。主仓库忽略 `plugins/*`，因此必须分别备份、同步和提交。
两个仓库的 `origin` 均为用户自己的 Fork：`heathermason0719/tongflow` 与
`heathermason0719/tongflow-api-openai`。官方仓库保存在 `upstream`，且其 Push 地址已禁用。
两个 `local/bailian-compat` 分支均保留原维护基线并跟踪各自 Fork 的同名分支。

音频下载和文档处理在独立开发分支维护：主仓库 `fix/audio-download-documents`，
OpenAI 插件 `fix/local-document-extraction`。使用本轮最终版本时须同时保留这两个分支，
不能只恢复旧的兼容基线。功能范围、使用方法和离线浏览器验收见
[音频下载与文档处理](audio-and-documents.zh.md)。

文案到多段复刻配音的后续开发分支为主仓库 `feat/reusable-voice-workflow`、
OpenAI 插件 `feat/speech-safe-splitting`，均以上述维护分支为基线。
使用方法和验证边界见[完整文案到复刻配音](script-to-cloned-speech.zh.md)。

主仓库保存兼容 Key 的完整提取、模型 ID 编辑及提交逻辑、多语言说明和回归测试。
插件仓库保存兼容端点直接使用指定模型的修复、配置说明与两项离线回归。
Key、工作台 SQLite 数据、上传内容、生产构建和浏览器证据继续留在 Git 忽略目录。
测试仅在运行时生成无凭据效力的合成输入。

## 未来同步官方版本

先检查两个仓库的 `git status`，将未提交工作单独提交或妥善备份。
安排维护窗口，先关闭服务，以私有权限备份 `data/` 并记录两个仓库的 Commit Hash。
`data/` 包含本地明文凭据，不可提交或公开。工作树干净后，为两个仓库各建备份分支；
备份分支只是 Git 引用，不能代替工作台数据备份。例如在每个仓库执行：

```bash
git branch backup/before-upstream-YYYYMMDD
git switch <正在使用的本地维护或功能分支>
git fetch upstream
git merge upstream/main
```

日期后缀请使用未占用的名称。主仓库和 OpenAI 插件仓库分别执行这些步骤。
使用 Merge 保留已有维护提交和官方历史；出现冲突时逐项保留兼容行为，
或使用 `git merge --abort` 回到合并前状态。不要使用 `reset --hard`、
强制检出或重新克隆覆盖当前目录。主仓库最初是浅克隆；若 Git 提示历史不足，
先在主仓库运行 `git fetch --unshallow upstream`，再继续正常合并，不要允许无关历史合并。

合并后先检查模型 ID 不会被 GPT 默认值覆盖、兼容 Key 不会被截断、
兼容服务不需要提供 `/models`，并确认 Qwen Audio 凭据和插件保持原样。
不需要更新 Qwen Audio 时不要操作其仓库。

在 TongFlow 根目录验证：

```bash
export PATH="$PWD/.tongflow/tools/node_modules/.bin:$PATH"
export PYTHON="$PWD/data/.tongflow/plugin-venv/bin/python"
pnpm test
pnpm typecheck
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$PWD/sdk" "$PYTHON" -m unittest discover -s plugins/tongflow-api-openai/tests -v
pnpm verify:plugins
```

若官方改动了锁文件或 SDK 依赖，先按新的声明更新项目内依赖及插件独立环境，
不要更新全局依赖。依赖安装、本地测试与构建不授权真实付费模型调用。

待依赖与本地检查通过，执行 `pnpm build`，然后使用桌面启动器或
`./.tongflow/service.py start` 启动。验证 localhost 工作台及原有工作流。
真实模型验收需另行告知用户并遵守当时的调用授权范围。

## 现有升级脚本

安装时创建的 `.tongflow/upgrade.sh` 不受 Git 跟踪，原逻辑会先停服并直接
`git pull --ff-only`，且只更新主仓库和 Qwen Audio，未整合 OpenAI 插件补丁。
该方式不适用于当前两个本地维护分支。

本轮在该脚本停服前加入已跟踪的 `scripts/check-local-upgrade.mjs`。
发现维护分支、本地提交、未提交文件或无法确认官方基线时，它返回退出码 2，
在任何停服、数据备份或拉取前结束。它不会自动 Merge、Rebase 或 Push。
当前安装应遵循上面的显式合并流程，不要绕过保护直接自动升级。

如果重新部署到另一份安装，须同时恢复 `.tongflow` 中的本地管理脚本，
并确认升级脚本在停服前调用此前置检查；它不是主仓库默认自带的升级入口。
