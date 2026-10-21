/**
 * Shared low-level helpers used across the codebase.
 * Consolidates duplicated asString / asRecord / generateId /
 * namesMatch / normalizeAliases / clampStringToPunctuation.
 */

// ─── Primitives ───────────────────────────────────────────

export function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}



// ─── Arrays & Records ─────────────────────────────────────


export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

// ─── IDs ──────────────────────────────────────────────────

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Names ────────────────────────────────────────────────

export function namesMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  return Boolean(left && right && left === right);
}

// ─── Aliases ──────────────────────────────────────────────

export function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item))
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，、|]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
  }
  return [];
}

// ─── Text Truncation ──────────────────────────────────────

/**
 * Clamp text to maxChars, preferring a break at a sentence/clause punctuation.
 * Returns the truncated text, optionally with an ellipsis trailing marker.
 */
export function clampStringToPunctuation(
  text: string,
  maxChars: number,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  const hard = trimmed.slice(0, maxChars);
  const breakAt = Math.max(
    hard.lastIndexOf('。'),
    hard.lastIndexOf('；'),
    hard.lastIndexOf('！'),
    hard.lastIndexOf('？'),
    hard.lastIndexOf('，'),
    hard.lastIndexOf('. '),
    hard.lastIndexOf('! '),
    hard.lastIndexOf('? '),
    hard.lastIndexOf('\n'),
  );
  if (breakAt >= Math.floor(maxChars * 0.45)) {
    return hard.slice(0, breakAt + 1).trim();
  }
  return `${hard.trim()}…`;
}
