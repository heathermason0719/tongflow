import { buildAudioFcpxml, type FcpAudioClip } from "../../../core";
import { hostFetch } from "../../host";
import { apiPost } from "../api/client";
import { getFileUrl } from "./url";

interface PreparedExport {
    name: string;
    clips: (FcpAudioClip & { fileKey: string; bytes: number })[];
}
export function chooseFcpExportDirectory(): Promise<FileSystemDirectoryHandle> {
    const picker = (
        window as unknown as {
            showDirectoryPicker?: (options: {
                mode: string;
                id: string;
            }) => Promise<FileSystemDirectoryHandle>;
        }
    ).showDirectoryPicker;
    if (!picker)
        throw new Error("请使用本机 Chrome 打开工作台，以选择导出文件夹");
    return picker.call(window, {
        mode: "readwrite",
        id: "tongflow-fcp-export",
    });
}

export async function exportFcpProject(
    name: string,
    fileKeys: string[],
    parent: FileSystemDirectoryHandle,
    progress: (completed: number, total: number) => void,
): Promise<{ folder: string; xmlFile: string; count: number }> {
    const prepared = await apiPost<PreparedExport>(
        "/api/export/fcp",
        { name, fileKeys },
        { showErrorToast: false, timeout: 300000 },
    );
    let folder = prepared.name;
    let directory: FileSystemDirectoryHandle | undefined;
    for (let suffix = 1; suffix <= 10000; suffix++) {
        folder = suffix === 1 ? prepared.name : `${prepared.name} (${suffix})`;
        try {
            await parent.getDirectoryHandle(folder);
        } catch (error) {
            if ((error as DOMException).name === "NotFoundError") {
                directory = await parent.getDirectoryHandle(folder, {
                    create: true,
                });
                break;
            }
            if ((error as DOMException).name !== "TypeMismatchError")
                throw error;
        }
    }
    if (!directory) throw new Error("无法创建新的工程目录");
    try {
        const audio = await directory.getDirectoryHandle("Audio", {
            create: true,
        });
        for (const [index, clip] of prepared.clips.entries()) {
            progress(index, prepared.clips.length);
            const response = await hostFetch(getFileUrl(clip.fileKey));
            if (!response.ok || !response.body)
                throw new Error(
                    `第 ${index + 1} 段下载失败：HTTP ${response.status}`,
                );
            const file = await audio.getFileHandle(clip.filename, {
                create: true,
            });
            const writable = await file.createWritable();
            let bytes = 0;
            await response.body
                .pipeThrough(
                    new TransformStream<Uint8Array, Uint8Array>({
                        transform(chunk, controller) {
                            bytes += chunk.byteLength;
                            controller.enqueue(chunk);
                        },
                        flush() {
                            if (bytes !== clip.bytes)
                                throw new Error(
                                    `第 ${index + 1} 段文件不完整，请重试`,
                                );
                        },
                    }),
                )
                .pipeTo(writable);
        }
        const xmlFile = `${prepared.name}.fcpxml`;
        const file = await directory.getFileHandle(xmlFile, { create: true });
        const writable = await file.createWritable();
        await writable.write(buildAudioFcpxml(prepared.name, prepared.clips));
        await writable.close();
        progress(prepared.clips.length, prepared.clips.length);
        return {
            folder: `${parent.name}/${folder}`,
            xmlFile,
            count: prepared.clips.length,
        };
    } catch (error) {
        // Only the newly-created directory belongs to this attempt. Never
        // replace/delete a previous export or the user's chosen parent.
        try {
            await parent.removeEntry(folder, { recursive: true });
        } catch {
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}；未完成目录 ${folder} 无法清理，请检查后重新导出`,
            );
        }
        throw error;
    }
}
