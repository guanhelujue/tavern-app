import { DEFAULT_MOD_EXTRACTION_PROMPT, LEGACY_MOD_EXTRACTION_PROMPT, REPORT_MOD_EXTRACTION_PROMPT } from '../constants/writing-mod';
import type { ContentStyleSettings, WritingMod } from '../types/tavern';

export type WritingModSample = { name: string; text: string };

/** Preserve complete articles, including whitespace, and add only source boundaries. */
export function prepareWritingModSamples(samples: WritingModSample[]): string {
  const usable = samples.filter((item) => item.text.trim());
  return usable.map((item, index) => `【文章 ${index + 1}：${item.name}】\n${item.text}`).join('\n\n');
}

/** An explicit empty library must not resurrect the legacy prompt after deletion. */
export function normalizeWritingModSettings(settings?: Partial<ContentStyleSettings> | null) {
  const seen = new Set<string>();
  const modLibrary: WritingMod[] = Array.isArray(settings?.modLibrary)
    ? settings.modLibrary.flatMap((item) => {
        if (!item || typeof item.id !== 'string' || !item.id.trim() || seen.has(item.id)
          || typeof item.name !== 'string' || !item.name.trim() || typeof item.content !== 'string') return [];
        seen.add(item.id);
        return [{ id: item.id, name: item.name.trim(), content: item.content,
          ...(typeof item.enabled === 'boolean' ? { enabled: item.enabled } : {}) }];
      })
    : typeof settings?.modPrompt === 'string' && settings.modPrompt.trim()
      ? [{ id: 'legacy-mod', name: '我的 MOD（原有内容）', content: settings.modPrompt }]
      : [];
  const selectedModId = typeof settings?.selectedModId === 'string'
    ? modLibrary.find((item) => item.id === settings.selectedModId)?.id ?? ''
    : modLibrary[0]?.id ?? '';
  const savedPrompt = settings?.modExtractionPrompt;
  const isLegacyDefault = typeof savedPrompt === 'string'
    && [LEGACY_MOD_EXTRACTION_PROMPT, REPORT_MOD_EXTRACTION_PROMPT].includes(savedPrompt.replace(/\r\n/g, '\n').trim());
  return {
    modLibrary: modLibrary.map((item) => ({
      ...item,
      enabled: typeof item.enabled === 'boolean' ? item.enabled
        : settings?.modEnabled === true && item.id === selectedModId,
    })),
    selectedModId,
    modExtractionPrompt: typeof savedPrompt === 'string' && !isLegacyDefault
      ? savedPrompt
      : DEFAULT_MOD_EXTRACTION_PROMPT,
  };
}
