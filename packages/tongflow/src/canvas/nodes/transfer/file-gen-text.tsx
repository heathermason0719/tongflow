import { FileText } from "lucide-react";
import { memo } from "react";
import { useTranslations } from "use-intl";
import type { TongflowPluginNodeProps } from "../../../core";
import { useAbiForm } from "../../hooks/use-abi-form";
import { useEffectiveInputs } from "../../hooks/use-effective-inputs";

import { AbiNodeShell } from "../base/abi-node-shell";

const FileGenTextNode = ({
    selected,
    data,
}: TongflowPluginNodeProps<"parse-document", "fileGenTextNode">) => {
    const t = useTranslations("Workspace.nodes");
    const form = useAbiForm("parse-document");
    const input = useEffectiveInputs("parse-document", form.state);

    return (
        <AbiNodeShell
            feature="parse-document"
            form={form}
            selected={selected}
            className="min-w-[480px]"
            data={data}
            title={t("titles.fileGenText")}
            icon={<FileText className="h-5 w-5" />}
            executeLabel={t("actions.parseDocument")}
            executeDisabled={!input.prompts.some((p) => Boolean(p.document))}
        />
    );
};

FileGenTextNode.displayName = "FileGenTextNode";

export default memo(FileGenTextNode);
