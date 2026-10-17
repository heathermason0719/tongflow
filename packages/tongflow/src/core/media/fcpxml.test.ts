import { describe, expect, it } from "vitest";
import {
    buildAudioFcpxml,
    fcpTime,
    numberedAudioFilename,
    safeFcpProjectName,
} from "./fcpxml";

describe("independent audio FCPXML", () => {
    it("preserves order and exact sample durations with gapless rational offsets", () => {
        const clips = [
            {
                filename: "01.wav",
                duration: "22051/44100s",
                channels: 1,
                sampleRate: 44100,
            },
            {
                filename: "02.wav",
                duration: "48001/48000s",
                channels: 2,
                sampleRate: 48000,
            },
            {
                filename: "03.m4a",
                duration: "3/2s",
                channels: 2,
                sampleRate: 48000,
            },
        ];
        const xml = buildAudioFcpxml("中文 & <工程>", clips);
        expect(xml).toContain('name="中文 &amp; &lt;工程&gt;"');
        expect(xml).toContain(
            'ref="a1" name="01.wav" offset="0s" start="0s" duration="22051/44100s"',
        );
        expect(xml).toContain('ref="a2" name="02.wav" offset="22051/44100s"');
        expect(xml).toContain(
            'ref="a3" name="03.m4a" offset="10584307/7056000s"',
        );
        expect(xml).toContain(
            'sequence format="f1" duration="21168307/7056000s"',
        );
        expect(xml.match(/<asset-clip /g)).toHaveLength(3);
        expect(xml).toContain('src="./Audio/03.m4a"');
        expect(xml).not.toContain("<gap");
    });
    it("numbers arbitrary batch sizes and preserves the original extension", () => {
        expect(numberedAudioFilename(6, "tasks/random.wav", 16)).toBe("07.wav");
        expect(numberedAudioFilename(0, "random.M4A", 120)).toBe("001.m4a");
        expect(numberedAudioFilename(119, "random.wav", 120)).toBe("120.wav");
        expect(safeFcpProjectName("../中文 / 工程:测试")).toBe(
            "_中文 _ 工程_测试",
        );
        expect(safeFcpProjectName("...")).toBe("TongFlow 配音");
    });
    it("rejects invalid/zero timing rather than silently omitting a clip", () => {
        expect(() => fcpTime(BigInt(1), BigInt(0))).toThrow();
        expect(() => buildAudioFcpxml("x", [])).toThrow();
        expect(() =>
            buildAudioFcpxml("x", [
                {
                    filename: "01.wav",
                    duration: "0s",
                    channels: 2,
                    sampleRate: 48000,
                },
            ]),
        ).toThrow();
    });
});
