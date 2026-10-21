export type ReplyLengthPreset = 'short' | 'normal' | 'long' | 'novel';

/** Legacy value retained only to read old persisted sessions. */
export const DEFAULT_REPLY_LENGTH_PRESET: ReplyLengthPreset = 'normal';

export function normalizeReplyLengthPreset(
  value: unknown,
): ReplyLengthPreset {
  if (value === 'short' || value === 'normal' || value === 'long' || value === 'novel') {
    return value;
  }

  return DEFAULT_REPLY_LENGTH_PRESET;
}
