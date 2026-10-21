/** Soft cap for auto-derived shortIntro (list / legacy callers). */
import { clampStringToPunctuation } from '@/utils/helpers';

export const NOVEL_SHORT_INTRO_MAX_CHARS = 80;

/**
 * Build a single display string from persisted short + detailed intro.
 * Dedupes when detailed already starts with / equals short.
 */
export function mergeIntroForDisplay(shortIntro?: string | null, detailedIntro?: string | null) {
  const short = typeof shortIntro === 'string' ? shortIntro.trim() : '';
  const detailed = typeof detailedIntro === 'string' ? detailedIntro.trim() : '';

  if (!short && !detailed) {
    return '';
  }
  if (!short) {
    return detailed;
  }
  if (!detailed) {
    return short;
  }
  if (detailed === short || detailed.startsWith(short)) {
    return detailed;
  }
  return `${short}\n\n${detailed}`;
}

/** Truncate full intro into a short blurb, preferring sentence boundaries. */
export function truncateIntroToShort(
  intro: string,
  maxChars = NOVEL_SHORT_INTRO_MAX_CHARS,
): string {
  const trimmed = intro.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return clampStringToPunctuation(trimmed, maxChars);
}

/**
 * Persist UI「作品介绍」into dual fields without a schema migration.
 * Full text → detailedIntro; truncated summary → shortIntro.
 */
export function splitIntroForStorage(intro: string): {
  shortIntro: string;
  detailedIntro: string;
} {
  const detailedIntro = intro.trim();
  return {
    detailedIntro,
    shortIntro: truncateIntroToShort(detailedIntro),
  };
}
