import { Platform } from 'react-native';

export type ChatFontFamilyId = 'song' | 'kai' | 'fangsong' | 'deng' | 'system';

export const CHAT_FONT_SIZE_MIN = 12;
export const CHAT_FONT_SIZE_MAX = 32;
export const CHAT_FONT_SIZE_DEFAULT = 16;

/**
 * Font family names registered in root layout via expo-font.
 * Song / Kai / Deng are real bundled faces so they stay visually distinct.
 */
export const CHAT_BUNDLED_FONT_NAMES = {
  song: 'NotoSerifSC',
  kai: 'LXGWWenKai',
  deng: 'NotoSansSC',
} as const;

export const CHAT_FONT_FAMILY_OPTIONS: {
  id: ChatFontFamilyId;
  label: string;
  description: string;
}[] = [
  { id: 'song', label: '宋体', description: '思源宋体 · 印刷衬线' },
  { id: 'kai', label: '楷体', description: '霞鹜文楷 · 手写书卷' },
  { id: 'fangsong', label: '仿宋', description: '系统仿宋（iOS 更准）' },
  { id: 'deng', label: '等线', description: '思源黑体 · 清晰无衬线' },
  { id: 'system', label: '系统默认', description: '跟随系统界面字体' },
];

export function clampChatFontSize(value: number) {
  if (!Number.isFinite(value)) {
    return CHAT_FONT_SIZE_DEFAULT;
  }

  return Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, Math.round(value)));
}

export function normalizeChatFontFamily(value?: string | null): ChatFontFamilyId {
  if (
    value === 'song' ||
    value === 'kai' ||
    value === 'fangsong' ||
    value === 'deng' ||
    value === 'system'
  ) {
    return value;
  }

  // Migrate previous reading-setting ids.
  if (value === 'serif') {
    return 'song';
  }

  if (value === 'rounded') {
    return 'deng';
  }

  return 'song';
}

export function resolveChatFontFamily(id: ChatFontFamilyId): string | undefined {
  switch (id) {
    case 'song':
      return CHAT_BUNDLED_FONT_NAMES.song;
    case 'kai':
      return CHAT_BUNDLED_FONT_NAMES.kai;
    case 'deng':
      return CHAT_BUNDLED_FONT_NAMES.deng;
    case 'fangsong':
      // No open fangsong bundled yet; iOS has a real system FangSong.
      return Platform.select({
        ios: 'STFangsong',
        android: 'fangsong',
        default: CHAT_BUNDLED_FONT_NAMES.song,
      });
    case 'system':
    default:
      return undefined;
  }
}
