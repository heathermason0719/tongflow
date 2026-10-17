# FCP 剪辑工程导出：验收记录

验收环境：macOS、本机 Chrome 155.0.8059.82、Final Cut Pro 12.3、生产构建。
使用已恢复的「长文配音工作流（已恢复16段）」及其既有 16 份 WAV，没有重新
生成或调用任何付费模型。真实素材、数据库、原文、截图与原始 FCP 回读仅存本机
Git 忽略的 `.tongflow/fcp-export/`，本目录仅含脱敏结构、哈希和指标。

## 浏览器实际导出

[浏览器验收](browser-acceptance.json) 对应
[verify-fcp-export.mjs](../../../scripts/verify-fcp-export.mjs)：

- 使用独立 Chrome 配置、数据库副本和可信备份中的真实音频；屏蔽模型任务创建
  与工作流执行请求。浏览器实际点击音频节点菜单、输入名称、选择原生保存位置、
  确认目录写入权限，通过 File System Access 写入真实磁盘文件。
- 相同位置连续导出两次，重新加载页面并从「我的工作流」打开后再次导出。
  得到三个独立目录，同名自动加序号，没有覆盖之前的输出。
- 每套目录均含一个 FCPXML 和 `Audio/01.wav` 至 `16.wav`。逐份 SHA-256 与原素材
  相同；首套全部通过 FFmpeg 完整解码。后两套也逐份核对相同哈希。
- 原工作稿、原声音、历史配音及有序结果不变，没有页面脚本异常。第 7 段通过
  原下载按钮实际下载为 `07.wav`，字节哈希与工程中的第 7 份素材一致。
- 缺失第 2 段时服务端返回 400 和明确段号，已有三个导出目录不变。

[导出 XML](exported-16-clips.fcpxml) 是实际结果的结构证据，含相对媒体引用，
本目录不附带私人音频；完整可用工程保留在本机验收输出位置。

## 真实 Final Cut Pro 导入与回读

在专门新建的 `TongFlow导出验收.fcpbundle` 中导入 Chrome 实际导出的 FCPXML，
打开项目时间线，再通过 FCP「文件 → 导出 XML」得到 1.14 版本的回读文件。
对该真实回读逐项比较，结果见
[FCP 回读验证](fcp-roundtrip-verification.json)：

- 16 个独立 `asset-clip`，文件依次为 `01.wav` 至 `16.wav`。
- 总长 552.08 秒；每段 duration 与原始导出相等，每段 offset 为此前真实时长之和。
- 无重叠、无额外空隙或末尾静音，没有重新链接；FCP 回读的素材路径均能实际找到
  对应编号 WAV。XML 文档不含内部随机文件名或文案。

另用本机 Apple FCPXML 1.10 DTD 验证，并独立检查所有相对路径，结果见
[格式及时序验证](xml-validation.json)。DTD 通过和真实 FCP 导入是两项分别完成的验证。

参考：[Apple FCPXML 创建说明](https://developer.apple.com/documentation/professional-video-applications/creating-fcpxml-documents)、
[Apple FCPXML 导入步骤](https://support.apple.com/zh-cn/guide/final-cut-pro/verdbd66ae/mac)。

## 自动化与边界

186 项测试通过，包括混合采样率有理数时间、任意段数命名、XML 转义、原字节复制、
重复导出保留旧目录、预检失败不创建目录、传输截断仅清理本次目录，以及实际
ffprobe/FFmpeg 检查普通 WAV 和旧流式 WAV。根项目、core/React 18/React 19 类型检查、
生产构建及修改文件 Biome 检查通过。

```bash
pnpm test
pnpm typecheck
pnpm --filter tongflow typecheck
pnpm build
PUPPETEER_MODULE=/absolute/path/to/puppeteer-core/lib/puppeteer/puppeteer-core.js \
  node scripts/verify-fcp-export.mjs /absolute/private/backup
```

浏览器验收需要 macOS 原生窗口与自动化访问权限，备份中须包含指定工作流数据库
和 `uploads/`。这是仅用于验收的桌面自动化；产品导出功能使用浏览器标准目录 API，
不依赖 AppleScript。其他浏览器、云端媒体、其他 FCP 版本没有做真实导入验证。
操作方式和限制见[中文使用说明](../../export-fcp.zh.md)。
