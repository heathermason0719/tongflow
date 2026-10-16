/** Extract the credential pasted into the OpenAI-compatible connection form. */
export function extractCompatibleKey(raw: string): string {
    let value = raw.trim();
    // Accept a complete key or a copied shell assignment. Never split on the
    // last '=': padding may be part of an opaque provider credential.
    const assignment = value.match(
        /^(?:export\s+)?(?:OPENAI_API_KEY|DASHSCOPE_API_KEY)\s*=\s*(.*)$/,
    );
    if (assignment) value = assignment[1].trim();
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    return value && !/[\s"']/.test(value) ? value : "";
}
