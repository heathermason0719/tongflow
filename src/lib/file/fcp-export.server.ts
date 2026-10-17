import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fcpTime, numberedAudioFilename, safeFcpProjectName } from "tongflow";
import { parseUploadFileKeyReference } from "./parse-upload-file-key";
import { getStorage } from "./storage.server";

const run = promisify(execFile);
// Export only native FCP audio containers. Do not offer Ogg/Opus/FLAC
// projects that would require additional codecs or unsupported relinking.
const AUDIO_EXTENSION = /\.(wav|bwf|rf64|mp3|m4a|aac|caf|aif|aiff|aifc)$/i;

export async function prepareFcpAudioExport(name: string, fileKeys: string[]) {
    if (!fileKeys.length || fileKeys.length > 1000)
        throw new Error("请选择 1–1000 段音频");
    const driver = getStorage();
    const clips = [];
    // Inspect every source before the browser creates any delivery directory.
    for (const [index, raw] of fileKeys.entries()) {
        try {
            const key = parseUploadFileKeyReference(raw);
            if (!key || !AUDIO_EXTENSION.test(key))
                throw new Error("不是支持的本地音频文件");
            const source = await driver.openRead?.(key);
            if (!source?.localPath)
                throw new Error("此导出目前需要本机磁盘素材");
            if (!source.size) throw new Error("音频文件为空");
            const { stdout } = await run(
                process.env.FFPROBE_PATH || "ffprobe",
                [
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_type,sample_rate,channels,duration_ts,time_base:format=duration,format_name",
                    "-of",
                    "json",
                    source.localPath,
                ],
                { timeout: 30000, maxBuffer: 1024 * 1024 },
            );
            const probe = JSON.parse(stdout);
            const audio = probe.streams?.filter(
                (s: { codec_type: string }) => s.codec_type === "audio",
            );
            if (audio?.length !== 1)
                throw new Error("需要包含一条有效音轨的音频素材");
            const s = audio[0];
            if (
                !/^\d+$/.test(String(s.duration_ts)) ||
                !/^\d+\/\d+$/.test(s.time_base)
            )
                throw new Error("无法读取精确音频时长");
            const [tn, td] = s.time_base.split("/").map(BigInt);
            const duration = fcpTime(BigInt(s.duration_ts) * tn, td);
            if (duration === "0s" || !Number(s.sample_rate) || !s.channels)
                throw new Error("无效的音频时长或格式");
            if (/\.wav$/i.test(key) && probe.format?.format_name !== "wav")
                throw new Error("WAV 扩展名与实际格式不一致");
            // Header metadata alone can accept a truncated/damaged recording.
            // Decode to a null sink before creating any delivery files.
            // Existing Qwen WAVs can advertise an oversized streaming RIFF
            // length. Preserve their bytes; accept demuxer warnings when the
            // complete available PCM decodes, but reject decoder errors.
            const decoded = await run(
                process.env.FFMPEG_PATH || "ffmpeg",
                [
                    "-v",
                    "error",
                    "-nostdin",
                    "-i",
                    source.localPath,
                    "-f",
                    "null",
                    "-",
                ],
                { timeout: 120000, maxBuffer: 1024 * 1024 },
            );
            if (decoded.stderr.trim()) throw new Error("音频不能完整解码");
            clips.push({
                fileKey: key,
                filename: numberedAudioFilename(index, key, fileKeys.length),
                bytes: source.size,
                duration,
                sampleRate: Number(s.sample_rate),
                channels: Number(s.channels),
            });
        } catch (error) {
            const e = error as Error & { code?: string };
            const detail =
                e.code === "ENOENT"
                    ? "素材不存在，或本机尚未安装 FFmpeg / ffprobe"
                    : e.message;
            // Do not reflect ffprobe stderr (absolute paths) or original text.
            throw new Error(
                `第 ${index + 1} 段无法导出：${detail?.startsWith("Command failed") ? "音频不可读取或格式损坏" : detail}`,
            );
        }
    }
    return { name: safeFcpProjectName(name), clips };
}
