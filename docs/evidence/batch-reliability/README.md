# 长文批量配音可靠性验收

2026-10-17，真实 Chrome 与生产构建。既有真实音频来自此前完成的 16 个任务；
本次没有调用百炼或其他付费模型，没有重新生成这 16 段。

## 原因与修复

旧版每个任务占用一个 SSE 连接，多个播放器又预加载完整 WAV。媒体接口不支持
Range，也没有 Content-Length，浏览器连接长期被占用，保存与状态备份请求排队
到客户端 30 秒超时。数据库中的模型任务实际已完成。原下载实现还会把整份音频
读入 Blob，逐次保留对象 URL 30 秒，连续下载增加前端内存和连接压力。

[旧版隔离复现](baseline-reproduction.json) 使用同一份真实画布副本（保存请求约
192 KB）：浏览器保存 30001 ms 后中止，独立 HTTP 连接提交相同内容则返回 200；
请求音频前 44 字节却返回 4400684 字节、状态 200，无范围和长度头。
因此这次保存失败不是文案字数或 SQLite 无法写入造成。

修复为每批一个 SSE，断线后从持久化记录重放。任务保存批次编号、原顺序和输入
签名；派发前 SQLite 原子认领，已完成／运行中任务不会重复执行。并发保持最多
6 个。克隆节点提供「恢复已有结果」，旧记录按文字、声音、模型和参数匹配。
音频按需加载，磁盘流式返回、支持 Range/HEAD 和取消；本机下载交给浏览器，
每行独立错误与重试。保存失败保留对话框，返回错误及诊断编号。

## 真实已有音频验证

[完整校验清单](existing-audio-verification.json) 只公开段号、哈希和指标。
真实文案、声音、数据库、截图及文件路径均保留在本机 Git 忽略的 `.tongflow/`。

| 检查 | 实际结果 |
| --- | --- |
| 清除测试副本前端结果后恢复 | 从原数据库找回 16/16，逐项核对原文字、参考声音、音频与顺序，无任务创建 |
| 保存及我的工作流重开 | 约 299 ms 保存；原稿、人工稿、连线和全部结果一致 |
| 保存错误重试 | 注入 HTTP 500，错误与诊断可见、内容保留，重试约 238 ms 成功 |
| Range | 206，前 44 字节只返回 44 字节，长度与 Content-Range 正确 |
| 逐段下载 | Chrome 实际落盘 16/16；源文件和下载文件 SHA-256 全部相同，双方均经 FFmpeg 完整解码 |
| 单段失败重试 | 第 5 段注入 HEAD 404，行内报错、其他行可用，随后重试成功 |
| 下载期间响应 | 慢速传输仍进行时，心跳请求约 24 ms，编辑器中间插字、删除和采用成功 |
| 试听与拖动 | 实际播放推进，拖动后继续播放；无页面脚本异常 |

下载测试对音频使用可信备份的只读映射，在独立数据库和 Chrome 配置下执行。
未触碰现有工作流。复验脚本：
[verify-real-batch-reliability.mjs](../../../scripts/verify-real-batch-reliability.mjs)。

随后在用户原 Chrome 标签页实际更新到修复版：3000 端口保存请求 200、约 10 ms，
新增「长文配音工作流（已恢复16段）」（id=2），从「我的工作流」重新打开，
36 节点／34 连线／16 成功结果全部保留。原 27 条任务、旧工作流、25 个上传文件
及设置逐项核验未改变。终态批量／单任务重连均直接重放结果，没有创建新任务。
[运行现场指标](live-runtime-verification.json) 不含私人文案或音频路径。
旧 3036 测试监听已停止，当前入口为 `http://localhost:3000/workspace`。

## 模拟回归

以下为本机模拟提供方，输出是测试音，不能证明真实音色克隆质量。

- [验收结果](simulated-acceptance.json)：16 段、40 秒延迟、最多 6 路，整批约
  122 秒。中断网络 8 秒、生成中刷新、生成中保存后，全部完成，无重复提交，
  同批完成提示最多 1 个。保存耗时约 37 ms。
- [生成中的实际保存请求](saved-inflight-workflow.json) 保留任务编号及顺序。
  [应用请求](actual-task-requests.json)、[模拟提供方请求](provider-requests.json)
  可核对当前人工稿、顺序、参考声音哈希及输出哈希。
- [批量完成](05-batch-source-audio-correspondence.png)、
  [人工编辑](06-human-edits-boundaries-and-order.png)、
  [保存重开](08-saved-and-reloaded.png)。覆盖模型改写漏句仍可审阅、修改文字、删句、
  调整边界与顺序、未采用拦截、历史结果过期识别、再次配音和整条工作流执行。
- [文档与音频回归](document-audio-regression.json)：TXT、Markdown、DOCX、63458 字
  长文及模拟 PDF，WAV/M4A 实际播放和下载。TXT/MD/DOCX 本机提取不调用模型。

工程检查：177 项 TypeScript 测试通过，根项目和 core/React 18/React 19 类型检查
通过，生产构建和修改文件 Biome 检查通过。包含迁移后的 SQLite 原子派发、终态不重跑、持久化错误、队列并发与去重、
结果匹配、范围请求、流取消、HEAD 不读取音频和保存错误隐私检查。

复验：先 `pnpm build`，再设置 `PUPPETEER_MODULE` 为 Puppeteer Core 的绝对模块路径：

```bash
TONGFLOW_QA_LONG_BATCH=1 node scripts/verify-speech-workflow.mjs
node scripts/verify-audio-documents.mjs
node scripts/verify-real-batch-reliability.mjs /absolute/private/backup-directory
```

最后一个脚本要求明确传入含 `live-memory-backup.json`、`tongflow.db`、`uploads/`
的私有备份，禁止把备份或真实截图提交。中文操作说明见
[长批次等待、恢复与下载](../../script-to-cloned-speech.zh.md#长批次等待恢复与下载)。
