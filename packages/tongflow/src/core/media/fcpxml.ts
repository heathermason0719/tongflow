/** Exact sample timing; never round each clip to video frames or milliseconds. */
export interface FcpAudioClip {
    filename: string;
    duration: string;
    sampleRate: number;
    channels: number;
}

function fraction(value: string): [bigint, bigint] {
    const match = /^(\d+)(?:\/(\d+))?s$/.exec(value);
    if (!match) throw new Error("Invalid FCP time");
    const n = BigInt(match[1]),
        d = BigInt(match[2] ?? 1);
    if (d === BigInt(0)) throw new Error("Invalid FCP time");
    return [n, d];
}
function gcd(a: bigint, b: bigint): bigint {
    return b ? gcd(b, a % b) : a;
}
export function fcpTime(n: bigint, d: bigint): string {
    if (n < BigInt(0) || d <= BigInt(0)) throw new Error("Invalid FCP time");
    const factor = gcd(n, d);
    return `${n / factor}${d / factor === BigInt(1) ? "" : `/${d / factor}`}s`;
}
function xml(value: string) {
    // XML 1.0 controls cannot be escaped as numeric references either.
    return (
        value
            // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 rejects these controls.
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;")
    );
}
export function safeFcpProjectName(value: string): string {
    return (
        value
            .normalize("NFC")
            // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip file-system controls and path separators.
            .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")
            .replace(/^\.+|[. ]+$/g, "")
            .trim()
            .slice(0, 80) || "TongFlow 配音"
    );
}
export function numberedAudioFilename(
    index: number,
    fileKey: string,
    total = 99,
): string {
    const pathname = fileKey.split(/[?#]/)[0];
    const ext = /\.([a-z0-9]{1,8})$/i.exec(pathname)?.[1]?.toLowerCase();
    if (!ext) throw new Error("Audio filename has no extension");
    return `${String(index + 1).padStart(Math.max(2, String(total).length), "0")}.${ext}`;
}

/** Relative media URLs make the complete directory movable as a unit. */
export function buildAudioFcpxml(name: string, clips: FcpAudioClip[]): string {
    if (!clips.length) throw new Error("No audio to export");
    let n = BigInt(0),
        d = BigInt(1);
    const resources: string[] = [],
        spine: string[] = [];
    for (const [index, clip] of clips.entries()) {
        const [cn, cd] = fraction(clip.duration);
        if (
            !cn ||
            !Number.isInteger(clip.channels) ||
            clip.channels < 1 ||
            !Number.isInteger(clip.sampleRate) ||
            clip.sampleRate < 1
        )
            throw new Error(`Invalid audio metadata: ${index + 1}`);
        const duration = fcpTime(cn, cd),
            offset = fcpTime(n, d),
            id = `a${index + 1}`;
        const filename = xml(clip.filename);
        resources.push(
            `    <asset id="${id}" name="${filename}" start="0s" duration="${duration}" hasAudio="1" audioSources="1" audioChannels="${clip.channels}" audioRate="${clip.sampleRate}"><media-rep kind="original-media" src="./Audio/${encodeURIComponent(clip.filename)}"/></asset>`,
        );
        spine.push(
            `            <asset-clip ref="${id}" name="${filename}" offset="${offset}" start="0s" duration="${duration}" audioRole="dialogue"/>`,
        );
        const sum = n * cd + cn * d,
            denominator = d * cd,
            factor = gcd(sum, denominator);
        n = sum / factor;
        d = denominator / factor;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="f1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>
${resources.join("\n")}
  </resources>
  <library>
    <event name="${xml(name)}">
      <project name="${xml(name)}">
        <sequence format="f1" duration="${fcpTime(n, d)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine.join("\n")}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
