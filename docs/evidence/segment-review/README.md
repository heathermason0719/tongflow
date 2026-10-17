# 分段工作稿审阅与编辑：离线验收

2026-10-17，在真实 Chrome 中操作 TongFlow 生产构建。使用独立数据库、浏览器
配置及本机模拟 OpenAI / Qwen 接口；参考声音由 macOS Tingting 本机合成，
文案为公开模拟故事。未调用真实百炼或其他付费模型，测试音是可播放的合成音。

本次验收脚本：[verify-speech-workflow.mjs](../../../scripts/verify-speech-workflow.mjs)。
完整结果见 [acceptance.json](acceptance.json)，共有 14 项检查通过。
较早的 `../speech-workflow/` 是上一轮基线证据，本目录反映新的审阅门槛。

| 验收要求 | 证据 |
| --- | --- |
| 模型改写、漏句仍完整显示 | [原稿、模型差异及编辑器](03-full-differing-proposal-for-review.png)、[第 14 段及采用入口](03b-last-segment-and-adoption.png) |
| 改字、删句、合并、光标拆段、调序、增删段落 | [人工编辑后的工作稿](06-human-edits-boundaries-and-order.png)、结果中的 `editAndRerun` |
| 保存后重开，文字和顺序保持 | [保存重开](08-saved-and-reloaded.png)、结果中的 `reopenedFromDatabase`、[真实保存请求](saved-workflow.json) |
| TTS 使用当前稿件和顺序 | [应用实际任务请求](actual-task-requests.json)、[模拟提供方收到的实际 HTTP 请求](provider-requests.json)、结果中的 `engine.currentDraft` / `engine.actualRequests` |
| 原稿保留、差异可识别、未采用时禁止配音 | `unreviewedBlocked`、`workflowReviewGate`、[整条工作流停止并提示审阅](10-unreviewed-workflow-stopped-before-tts.png) |
| 文档、声音复用、批量输出、播放下载及历史识别 | [必要回归结果](regression-summary.json)、`batch` / `playback` / `downloadedAllSegments` / `editsInvalidateReviewAndAudio` |

应用的任务请求与当前人工段落逐字、逐序比较；提供方请求还包含既有 Qwen
适配器的 `@voice1` 包装，段首尾空白按原有规则去除。第一批和改稿批次各 14 段；
从数据库重开后，再在段落中间连续插入文字并验证准确值，整条工作流继续使用
当前 14 段。模拟服务共收到 1 次文本拆分和 42 次音频合成请求。

整条工作流在人工稿未采用时返回明确的审阅提示，没有新增模型请求，工作稿
保持原样；采用后成功执行，拆分模型调用数量仍为 1。每批合成结果按输入顺序
关联文字、参考音频与输出音频；首批每段均实际播放、通过下载按钮下载并核对
字节哈希。改稿后旧配音显示为历史结果。

文档回归覆盖 TXT、Markdown、DOCX、63458 字长文和模拟 PDF；本地文档提取
没有调用模型，长文完整覆盖且有界分窗。整条工作流首次产生新分段后会先交给
用户审阅。WAV、M4A 下载均核对原始字节，并完成实际播放和完整解码检查。

工程检查：160 项 TypeScript 测试、93 项 SDK 测试、20 项 OpenAI 插件测试通过；
根项目类型检查、核心／React 18／React 19 类型检查、插件扫描、生产构建及修改
文件的 Biome 检查通过。[sha256.json](sha256.json) 记录本目录证据文件摘要。

复验方法见[中文使用说明](../../script-to-cloned-speech.zh.md)。真实模型的分段质量、
声音相似度、读音和时长由用户自行测试；本目录不把模拟音频作为真实复刻证明。
