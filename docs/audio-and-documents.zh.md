# 音频下载与文档处理

## 下载已有音频

在单个「音频」节点右上角打开菜单，点击「下载」。浏览器会保存音频文件，
不打开播放器标签页。下载保留源文件内容和扩展名，例如 WAV 仍然保存为 `.wav`，
不会仅改名成 MP3。节点内试听、全屏预览以及从素材库重新使用音频的方式保持不变。

下载需要先获取完整文件；大文件会占用相应的浏览器内存。外部音频地址还需要其
服务器允许跨域读取。失败会显示错误提示，可以重试。

部分已有流式 WAV 的头部没有写入最终长度，Chrome 会显示未知或无限时长。
下载保留原始字节，不重新封装；这类文件的实际时长可由剪辑软件或 ffprobe 读取。

## 上传文案并智能分段

1. 添加「文档」输入节点，选择上传 `.md`、`.txt` 或 `.docx` 文件。
2. 将文件连接到「文档解析」节点，选择已安装的 OpenAI 插件，点击「解析文档」。
3. 提取结果会生成「文本」节点，并保存为文本素材。可以从素材库重新使用。
4. 将文本节点连接到「智能拆分」（智能分段），填写分段要求，点击「执行」。百炼兼容服务可
   使用 `qwen-plus` 或 `deepseek-v4.1-flash`；留空模型字段会沿用 `OPENAI_CHAT_MODEL`。
5. 分段输出为多个文本节点。将需要合成的文本连接到同一个 Qwen Audio 语音节点，
   即可继续批量合成。

MD、TXT、DOCX 的提取在本机完成，不调用模型，也不会擅自润色或删改原文。
Markdown 标记原样保留。智能分段本身仍使用所配置的文本模型，可能产生费用；
执行前确认使用的服务和分段要求。Qwen Audio 使用自己的原有配置。

## 支持范围

- MD / TXT：保留中文、标点、文本顺序、空行、行尾和制表符。支持 UTF-8（含 BOM）、
  带 BOM 的 UTF-16 / UTF-32，以及旧版 Windows 中文文本的 GB18030。
- DOCX：提取正文段落、样式拆分的文本、超链接显示文字和表格。段落间用空行分隔，
  表格单元格用制表符分隔。提取修订后的当前正文，不包含已删除内容。
- DOCX 中的图片文字、复杂浮动排版、公式、页眉页脚、脚注尾注及自动编号的排版信息
  不在本轮提取范围；嵌入文档会返回明确错误，建议先另存为普通 DOCX。
- 本地文本文件与 DOCX 解压后的正文 XML 上限分别为 32 MiB。空白、损坏、无法解码
  或不支持的文件会报错，不会当作图片送给模型。
- PDF 与原有图片解析继续走插件的模型接口，需要目标服务和模型支持相应文件输入。
  本轮不增加扫描件 OCR，也不承诺普通文本模型能解析 PDF。
- 旧 `.doc`、Excel、PowerPoint 等文件可由其他相应插件处理；本次 OpenAI 插件不会将其
  伪装为图片。建议先转换为本轮支持的格式。

## 可重复验证

`tests/fixtures/documents/` 提供合成中文 MD、TXT、DOCX、63,458 字符长文、PDF、
逐份预期文本和 SHA-256 清单。样本由 `python3 scripts/create-document-fixtures.py`
确定性生成，不包含用户数据。

在项目已有依赖及插件 Python 环境就绪后运行：

```bash
export PATH="$PWD/.tongflow/tools/node_modules/.bin:$PATH"
export PYTHON="$PWD/data/.tongflow/plugin-venv/bin/python"
pnpm test
pnpm typecheck
pnpm --filter tongflow typecheck
pnpm verify:plugins
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$PWD/sdk" "$PYTHON" -m unittest discover -s plugins/tongflow-api-openai/tests -v
pnpm build
```

真实 Chrome 验收脚本为 `scripts/verify-audio-documents.mjs`。准备 `puppeteer-core`、
Chrome、FFmpeg / ffprobe 和已有本地音频后运行。若自动化模块安装在其他目录，
通过 `PUPPETEER_MODULE` 指定该模块的入口文件；`CHROME_PATH` 可指定 Chrome 可执行文件。

```bash
node scripts/verify-audio-documents.mjs
```

脚本启动使用生产构建的独立本地实例，复制已有插件环境，使用全新的测试数据库和
浏览器配置。它在浏览器上传每份文件，核对提取结果、文本素材及下游分段，实际下载
已有音频并比较哈希、检查播放和完整解码。模型返回由本地兼容接口模拟，不产生付费
调用；因此该验收证明数据流和接口兼容性，不代表实时模型的分段质量或 PDF OCR 质量。
浏览器截图、提取结果、任务记录和下载文件写入被 Git 忽略的
`.tongflow/audio-documents/browser-*/`，不会上传已有音频或用户配置。

更新本地版本时，需要同时保留主仓库和 OpenAI 插件仓库的修改，参见
[本地维护说明](local-maintenance.md)。
