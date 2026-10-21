import { DEFAULT_NSFW_PROMPT, LEGACY_NSFW_PROMPT } from '../constants/content-scale';
import type { ContentStyleSettings } from '../types/tavern';
import { normalizeWritingModSettings } from './writing-mods';

export const DEFAULT_JAILBREAK_PROMPT = DEFAULT_NSFW_PROMPT;

/** Read old saves once without coupling writing extensions to character dossiers. */
export function normalizeWritingPromptExtensions(settings?: Partial<ContentStyleSettings> | null) {
  const legacyPrompt = typeof settings?.nsfwPrompt === 'string' ? settings.nsfwPrompt.trim() : '';
  const mods = normalizeWritingModSettings(settings);
  const activeMods = mods.modLibrary.filter((item) => item.enabled && item.content.trim());
  return {
    jailbreakEnabled: typeof settings?.jailbreakEnabled === 'boolean'
      ? settings.jailbreakEnabled
      : settings?.nsfwEnabled === true,
    jailbreakPrompt: typeof settings?.jailbreakPrompt === 'string'
      ? settings.jailbreakPrompt
      : legacyPrompt && legacyPrompt !== LEGACY_NSFW_PROMPT
        ? legacyPrompt
        : DEFAULT_JAILBREAK_PROMPT,
    modEnabled: Array.isArray(settings?.modLibrary) ? activeMods.length > 0 : settings?.modEnabled === true,
    modPrompt: Array.isArray(settings?.modLibrary)
      ? activeMods.length === 1 ? activeMods[0].content
        : activeMods.map((item) => `【${item.name}】\n${item.content.trim()}`).join('\n\n')
      : typeof settings?.modPrompt === 'string' ? settings.modPrompt : '',
  };
}

/** Disabled or empty extensions contribute no text, including no fallback constraint. */
export function buildWritingPromptExtensionBlocks(settings?: Partial<ContentStyleSettings> | null): string[] {
  const extensions = normalizeWritingPromptExtensions(settings);
  return [
    extensions.jailbreakEnabled && extensions.jailbreakPrompt.trim()
      ? `【破限词】\n${extensions.jailbreakPrompt.trim()}`
      : '',
    extensions.modEnabled && extensions.modPrompt.trim()
      ? `【MOD】\n${extensions.modPrompt.trim()}`
      : '',
  ].filter(Boolean);
}
