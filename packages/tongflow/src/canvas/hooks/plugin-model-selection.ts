export function resolvePluginModel(
    pluginId: string,
    current: string,
    models: string[],
): string | undefined {
    const selected = current.trim();
    // Compatible servers define their own ids. An absent selection delegates
    // to OPENAI_CHAT_MODEL rather than injecting an OpenAI shortlist default.
    if (pluginId === "tongflow-api-openai") return selected || undefined;
    if (models.length === 0) return undefined;
    return models.includes(selected) ? selected : models[0];
}
