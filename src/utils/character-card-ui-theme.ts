import { normalizeCharacterCardAppearanceId } from '@/constants/character-card-appearances';

export type CharacterCardUiHeaderStyle = 'stamp' | 'dot' | 'seal';

export type CharacterCardUiTheme = {
  background: string;
  border: string;
  accent: string;
  accentContrast: string;
  text: string;
  textMuted: string;
  label: string;
  inputBackground: string;
  inputBorder: string;
  stamp: string;
  stampBackground: string;
  headerTitle: string;
  headerSubtitle: string;
  headerBorder: string;
  stampLabel: string;
  titleLabel: string;
  subtitleLabel: string;
  privacyStampLabel: string;
  privacyTitleLabel: string;
  privacySubtitleLabel: string;
  headerStyle: CharacterCardUiHeaderStyle;
  panelRadius: number;
  inputRadius: number;
};

const COLLECTION_THEME: CharacterCardUiTheme = {
  background: '#f3eee4',
  border: '#a89a86',
  accent: '#77372f',
  accentContrast: '#f7f1e7',
  text: '#201e1b',
  textMuted: '#756c60',
  label: '#756c60',
  inputBackground: 'rgba(255,255,255,0.28)',
  inputBorder: 'rgba(119,55,47,0.24)',
  stamp: '#77372f',
  stampBackground: 'rgba(119,55,47,0.08)',
  headerTitle: '#201e1b',
  headerSubtitle: '#756c60',
  headerBorder: '#c7bbaa',
  stampLabel: '人',
  titleLabel: 'THE CHARACTER COLLECTION',
  subtitleLabel: '馆藏人物志 · 编辑',
  privacyStampLabel: '密',
  privacyTitleLabel: 'PRIVATE LEAF',
  privacySubtitleLabel: '馆藏私页 · 仅 NSFW',
  headerStyle: 'seal',
  panelRadius: 2,
  inputRadius: 2,
};

const NOCTURNE_THEME: CharacterCardUiTheme = {
  background: '#131210',
  border: '#5b4d3b',
  accent: '#c9aa78',
  accentContrast: '#17130e',
  text: '#eee6d8',
  textMuted: '#9c9285',
  label: '#c9aa78',
  inputBackground: '#1b1916',
  inputBorder: 'rgba(201,170,120,0.28)',
  stamp: '#c9aa78',
  stampBackground: 'rgba(201,170,120,0.08)',
  headerTitle: '#eee6d8',
  headerSubtitle: '#9c9285',
  headerBorder: 'rgba(201,170,120,0.28)',
  stampLabel: '',
  titleLabel: 'NOCTURNE PERSONA',
  subtitleLabel: '夜幕密档 · 编辑',
  privacyStampLabel: '',
  privacyTitleLabel: 'RESTRICTED MATERIAL',
  privacySubtitleLabel: '限制调阅 · 仅 NSFW',
  headerStyle: 'dot',
  panelRadius: 4,
  inputRadius: 2,
};

export const DEFAULT_CHARACTER_CARD_UI_THEME = COLLECTION_THEME;

export function resolveCharacterCardUiTheme(appearanceId?: string | null): CharacterCardUiTheme {
  return normalizeCharacterCardAppearanceId(appearanceId) === 'character-card-nocturne'
    ? NOCTURNE_THEME
    : COLLECTION_THEME;
}
