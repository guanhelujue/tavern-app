export type MacroContext = {
  /** Resolves {{char}}. */
  charName?: string;
  /**
   * Resolves {{original}} — the text that would have been used without a card override
   * (global system prompt or global jailbreak). Empty when not applicable.
   */
  original?: string;
  /** Optional clock for tests; defaults to now. */
  now?: Date;
};

const MACRO_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/gi;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatLocalTime(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Replace SillyTavern-style macros. Names are case-insensitive.
 * Unknown macros are left unchanged.
 */
export function applyMacros(text: string, context: MacroContext = {}): string {
  if (!text || !text.includes('{{')) {
    return text;
  }

  const userName = 'User';
  const charName = context.charName?.trim() || 'Char';
  const original = context.original ?? '';
  const now = context.now ?? new Date();

  return text.replace(MACRO_PATTERN, (full, rawName: string) => {
    const name = rawName.trim().toLowerCase();

    switch (name) {
      case 'user':
        return userName;
      case 'char':
        return charName;
      case 'original':
        return original;
      case 'time':
        return formatLocalTime(now);
      case 'date':
        return formatLocalDate(now);
      default:
        return full;
    }
  });
}
