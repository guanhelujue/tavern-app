import type { ReplyLengthPreset } from '@/constants/reply-length';
import type { WorldbookEntry } from '@/types/tavern';

/** Default dialogue window: keep enough raw turns for adjacent-reply continuity. */
export const DEFAULT_CONTEXT_LENGTH = 8;
export const MIN_CONTEXT_LENGTH = 2;
export const MAX_CONTEXT_LENGTH = 20;

export type ChatSessionKind = 'novel';

export type SessionConfigFields = {
  contextLength: number;
  mainPrompt: string;
  prefix: string;
  suffix: string;
  worldbookEntries: WorldbookEntry[];
  /** See SessionCustomConfig.boundGlobalWorldbookIds */
  boundGlobalWorldbookIds?: string[];
  backgroundEnabled: boolean;
  bubbleOpacity: number;
  /** @deprecated Preserved only for old session payloads; no longer controls prompts. */
  replyLengthPreset?: ReplyLengthPreset | null;
};

export function createDefaultSessionConfigFields(): SessionConfigFields {
  return {
    contextLength: DEFAULT_CONTEXT_LENGTH,
    mainPrompt: '',
    prefix: '',
    suffix: '',
    worldbookEntries: [],
    boundGlobalWorldbookIds: undefined,
    backgroundEnabled: true,
    bubbleOpacity: 1,
    replyLengthPreset: null,
  };
}

export function clampContextLength(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_CONTEXT_LENGTH;
  }

  return Math.min(MAX_CONTEXT_LENGTH, Math.max(MIN_CONTEXT_LENGTH, Math.round(value)));
}

export function clampBubbleOpacity(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(1, Math.max(0.2, value));
}
