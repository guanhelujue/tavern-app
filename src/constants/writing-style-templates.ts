import type { WritingStyleTemplate } from '@/types/tavern';

export const MAX_WRITING_STYLE_TEMPLATES = 16;

export function normalizeWritingStyleTemplates(
  value?: WritingStyleTemplate[] | null,
): WritingStyleTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const next: WritingStyleTemplate[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';

    if (!id || !name || seen.has(id)) {
      continue;
    }

    seen.add(id);
    next.push({ id, name, prompt });

    if (next.length >= MAX_WRITING_STYLE_TEMPLATES) {
      break;
    }
  }

  return next;
}
