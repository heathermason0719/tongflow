import { type NextRequest, NextResponse } from "next/server";
import { prepareFcpAudioExport } from "@/lib/file/fcp-export.server";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        if (
            typeof body.name !== "string" ||
            !Array.isArray(body.fileKeys) ||
            !body.fileKeys.every((key: unknown) => typeof key === "string")
        )
            return NextResponse.json(
                { error: "需要工程名称和有序音频列表" },
                { status: 400 },
            );
        return NextResponse.json(
            await prepareFcpAudioExport(body.name, body.fileKeys),
        );
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error ? error.message : "无法检查音频素材",
            },
            { status: 400 },
        );
    }
}
