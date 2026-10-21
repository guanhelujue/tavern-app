import type { NovelCharacterState } from '@/types/tavern';

function compactText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function compactList(value: unknown, maxItems: number, maxChars: number): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((item) => compactText(item, maxChars))
    .filter(Boolean)
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, maxItems)
    .join('、');
}

/**
 * Render mutable story state separately from the stable character card. This
 * keeps injuries, current goals and information boundaries out of the dossier
 * while still making them explicit to the writing model.
 */
export function formatCharacterRuntimeStateForPrompt(
  state: NovelCharacterState | null | undefined,
): string {
  if (!state || state.stale) return '';

  const knows = compactList(state.knows, 6, 72);
  const unknown = compactList(state.unknown, 6, 72);
  const parts = [
    Number.isFinite(state.atChapter) && state.atChapter > 0 ? `截至第${state.atChapter}章` : '',
    compactText(state.currentState, 160) ? `现状：${compactText(state.currentState, 160)}` : '',
    compactText(state.goal, 120) ? `当前目标：${compactText(state.goal, 120)}` : '',
    compactText(state.motive, 120) ? `当前动机：${compactText(state.motive, 120)}` : '',
    compactText(state.speakingStyle, 100)
      ? `当前说话方式：${compactText(state.speakingStyle, 100)}`
      : '',
    knows ? `已知：${knows}` : '',
    unknown ? `未知：${unknown}` : '',
  ].filter(Boolean);

  return parts.join('；');
}
