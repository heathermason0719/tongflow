import { Atom, Ear, Mic, Upload } from "lucide-react";
import { memo, useCallback, useRef } from "react";
import { useTranslations } from "use-intl";
import type { TongflowPluginNodeProps } from "../../../core";
import { logger } from "../../../core";
import { SpeakerVoiceRecorder } from "../../components/speaker-voice-recorder";
import { useAbiForm } from "../../hooks/use-abi-form";
import { useEffectiveInputs } from "../../hooks/use-effective-inputs";
import { useUpload } from "../../hooks/use-upload";
import { getFileUrl } from "../../lib/file/url";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Label } from "../../ui/label";
import { AbiNodeShell } from "../base/abi-node-shell";
import { LanguageSelect } from "../base/language-select";
import { SpeechResults } from "../base/speech-results";

const TextGenSpeechCloneNode = ({
    selected,
    data,
}: TongflowPluginNodeProps<
    "text-gen-speech-clone",
    "textGenSpeechCloneNode" | "textGenSpeechCloneComposeNode"
>) => {
    const t = useTranslations("Workspace.nodes");
    const form = useAbiForm("text-gen-speech-clone");
    const input = useEffectiveInputs("text-gen-speech-clone", form.state);
    const texts = input.prompts
        .map((p) => p.text)
        .filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0,
        );
    const audioSources = input.sources("ref_audio");
    const textSources = input.sources("text");
    const refAudio = (
        audioSources.length ? input.values.ref_audio : form.state.ref_audio
    ) as string | undefined;

    // ABI types `ref_audio` as Asset; canvas stores a file_key string until
    // `prepareAssetInput` materializes bytes for Modal.
    const setVoice = (v: string) => form.patch({ ref_audio: v as any });

    const { upload, isUploading } = useUpload({
        onSuccess: (resp) => setVoice(resp.key),
        onError: (err) => logger.error("Voice upload failed:", err),
    });

    const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) await upload(file);
        e.target.value = "";
    };

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playPreview = useCallback(() => {
        if (!refAudio) return;
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }
        const audio = new Audio(getFileUrl(refAudio));
        audioRef.current = audio;
        audio
            .play()
            .catch((err) =>
                logger.error("Failed to play reference audio:", err),
            );
    }, [refAudio]);

    return (
        <AbiNodeShell
            feature="text-gen-speech-clone"
            form={form}
            selected={selected}
            className="min-w-[480px]"
            data={data}
            title={t("titles.textGenSpeechClone")}
            icon={<Atom className="h-5 w-5" />}
            executeLabel={t("actions.generateSpeech")}
            executeDisabled={!texts?.length || !refAudio}
        >
            <Card
                className="mx-4 mb-4 p-4 nodrag"
                onPointerDown={(e) => e.stopPropagation()}
            >
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <Label className="text-sm text-muted-foreground">
                        {t("common.referenceAudio")}：
                    </Label>
                    <label className="cursor-pointer">
                        <input
                            type="file"
                            accept="audio/*"
                            hidden
                            onChange={onFileSelect}
                        />
                        <Button
                            variant="outline"
                            size="icon"
                            title={t("common.uploadVoice")}
                            disabled={isUploading || audioSources.length > 0}
                            asChild
                        >
                            <span>
                                <Upload className="w-4 h-4" />
                            </span>
                        </Button>
                    </label>
                    <SpeakerVoiceRecorder
                        trigger={
                            <Button
                                variant="outline"
                                size="icon"
                                title={t("common.recordVoice")}
                                disabled={audioSources.length > 0}
                            >
                                <Mic className="w-4 h-4" />
                            </Button>
                        }
                        onChange={(key) => {
                            if (!audioSources.length) setVoice(key);
                        }}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={t("common.previewVoice")}
                        onClick={playPreview}
                        disabled={!refAudio}
                    >
                        <Ear className="w-5 h-5 text-primary" />
                    </Button>
                    <Label
                        htmlFor="clone-language-select"
                        className="text-sm text-muted-foreground"
                    >
                        {t("common.language")}：
                    </Label>
                    <LanguageSelect
                        id="clone-language-select"
                        value={(form.state.language as string) ?? "Auto"}
                        onChange={(v) => form.set("language", v)}
                    />
                </div>
                <div className="mb-4 text-xs text-muted-foreground truncate">
                    {refAudio ? refAudio : t("common.noReferenceAudio")}
                </div>
                <p
                    className="mb-3 text-xs text-muted-foreground"
                    data-testid="reference-source"
                >
                    {audioSources.length
                        ? t("speechFlow.connectedReference", {
                              source: audioSources
                                  .map((n) => n.data.label || n.id)
                                  .join(", "),
                          })
                        : t("speechFlow.localReference")}
                </p>
                {!audioSources.length && refAudio && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => form.patch({ ref_audio: undefined })}
                    >
                        {t("speechFlow.clearReference")}
                    </Button>
                )}
                <div className="mb-4">
                    <label
                        htmlFor="ref-text-input"
                        className="text-sm text-muted-foreground block mb-2"
                    >
                        {t("common.referenceText")}：
                    </label>
                    <textarea
                        id="ref-text-input"
                        className="w-full h-16 p-2 text-sm rounded-md border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder={t("common.referenceTextCloneHint")}
                        {...form.register("ref_text")}
                    />
                </div>
                <p
                    className="mb-2 text-xs text-muted-foreground"
                    data-testid="text-source"
                >
                    {textSources.length
                        ? t("speechFlow.connectedText", {
                              source: textSources
                                  .map((n) => n.data.label || n.id)
                                  .join(", "),
                          })
                        : t("speechFlow.connectText")}
                </p>
                {textSources.length > 0 && texts.length === 0 && (
                    <p className="text-xs text-amber-600">
                        {t("speechFlow.upstreamChanged")}
                    </p>
                )}
                {texts.length > 0 && (
                    <div className="space-y-2">
                        <Label className="text-sm font-medium text-muted-foreground">
                            {t("common.inputText")} ({texts.length})
                        </Label>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                            {texts.map((text, index) => (
                                <div
                                    key={`${index}-${text.slice(0, 48)}`}
                                    data-testid="effective-speech-text"
                                    className="text-sm text-foreground p-2 bg-background rounded border border-border/50 whitespace-pre-wrap"
                                >
                                    <span className="text-muted-foreground">
                                        {index + 1}.{" "}
                                    </span>
                                    {text}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Card>
            <SpeechResults data={data} signature={input.signature} />
        </AbiNodeShell>
    );
};

TextGenSpeechCloneNode.displayName = "TextGenSpeechCloneNode";

export default memo(TextGenSpeechCloneNode);
