export const MAX_NOVEL_SAVE_SLOTS = 5;

export function createNovelSaveSlotId() {
  return `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
