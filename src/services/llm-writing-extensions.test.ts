import { describe, expect, it } from 'vitest';

import { DEFAULT_CONTENT_BAN_FLAGS } from '../constants/content-bans';
import { DEFAULT_CONTENT_SCALE_PRESET } from '../constants/content-scale';
import { normalizeCharacterAiSummary } from '../features/character-dossier-v2/ai-summary';
import { createCharacterDossierV2 } from '../features/character-dossier-v2/model';
import type { ContentStyleSettings, Novel, NovelCastCharacter } from '../types/tavern';
import { EMPTY_PLAYER_PROFILE_FIELDS } from '../utils/novel-player';
import { createWorldPackFromNovel, EMPTY_QUICK_TRAVEL_CONFIG } from '../utils/quick-travel';
import { buildNovelCoreMemory } from './llm';

const character: NovelCastCharacter = {
  id: 'cast-test', name: '林舟', age: '25', gender: '男', profession: '调查员',
  height: '180cm', weight: '72kg', appearance: '', personality: '', speechStyle: '', background: '',
  isProtagonist: true,
};
const dossier = createCharacterDossierV2(character);
dossier.private.intimacyProfile = 'PRIVATE_PROFILE_MARKER';
character.dossierV2 = dossier;
character.aiSummary = normalizeCharacterAiSummary(undefined, character, dossier);
const novel = {
  ...EMPTY_PLAYER_PROFILE_FIELDS,
  id: 'novel-test', name: '测试小说', systemPrompt: '创作正文',
  playerName: '林舟', playerPersona: '', playerMotive: '',
  worldName: '测试世界', worldEra: '当代', gameRules: '',
  cast: [character], characterDossiers: [], loreEntries: [],
} as unknown as Novel;

describe('novel writing extension injection', () => {
  it('includes all independently enabled MODs exactly once in the actual novel prompt', () => {
    const settings: ContentStyleSettings = {
      defaultWritingStyle: '', contentScalePreset: DEFAULT_CONTENT_SCALE_PRESET,
      bans: { ...DEFAULT_CONTENT_BAN_FLAGS }, modEnabled: false,
      modLibrary: [
        { id: 'a', name: 'A', content: 'ACTIVE_MOD_A', enabled: true },
        { id: 'b', name: 'B', content: 'ACTIVE_MOD_B', enabled: true },
        { id: 'c', name: 'C', content: 'DISABLED_MOD_C', enabled: false },
      ],
    };
    const prompt = buildNovelCoreMemory(novel, '', undefined, { settings });
    expect(prompt.split('ACTIVE_MOD_A')).toHaveLength(2);
    expect(prompt.split('ACTIVE_MOD_B')).toHaveLength(2);
    expect(prompt.indexOf('ACTIVE_MOD_A')).toBeLessThan(prompt.indexOf('ACTIVE_MOD_B'));
    expect(prompt).not.toContain('DISABLED_MOD_C');
  });

  it('uses the selected named MOD in the actual novel prompt', () => {
    const settings: ContentStyleSettings = {
      defaultWritingStyle: '', contentScalePreset: DEFAULT_CONTENT_SCALE_PRESET,
      bans: { ...DEFAULT_CONTENT_BAN_FLAGS }, modEnabled: true, selectedModId: 'chosen',
      modExtractionPrompt: 'EXTRACTION_INSTRUCTIONS_MUST_STAY_OUT', modPrompt: 'STALE_MOD_CACHE',
      modLibrary: [
        { id: 'other', name: '未选中', content: 'UNCHOSEN_MOD' },
        { id: 'chosen', name: '选中', content: 'CHOSEN_MOD_RULES' },
      ],
    };
    const prompt = buildNovelCoreMemory(novel, '', undefined, { settings });
    expect(prompt).toContain('CHOSEN_MOD_RULES');
    expect(prompt).not.toContain('UNCHOSEN_MOD');
    expect(prompt).not.toContain('STALE_MOD_CACHE');
    expect(prompt).not.toContain('EXTRACTION_INSTRUCTIONS_MUST_STAY_OUT');
  });
  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])('keeps extensions independent from private records (%s, %s)', (jailbreakEnabled, modEnabled) => {
    const settings: ContentStyleSettings = {
      defaultWritingStyle: '', contentScalePreset: DEFAULT_CONTENT_SCALE_PRESET,
      bans: { ...DEFAULT_CONTENT_BAN_FLAGS },
      jailbreakEnabled, jailbreakPrompt: 'AUTHOR_EXTENSION_MARKER',
      modEnabled, modPrompt: 'MOD_EXTENSION_MARKER',
    };
    const world = createWorldPackFromNovel(novel);
    world.runtime.novelGenerationEnabled = true;
    const quickTravel: Novel = {
      ...novel,
      quickTravel: { config: EMPTY_QUICK_TRAVEL_CONFIG, worlds: [world], activeWorldId: world.id, settlements: [] },
    };
    for (const scenario of [novel, quickTravel]) {
      const prompt = buildNovelCoreMemory(scenario, '', undefined, { settings });
      expect(prompt.includes('AUTHOR_EXTENSION_MARKER')).toBe(jailbreakEnabled);
      expect(prompt.includes('MOD_EXTENSION_MARKER')).toBe(modEnabled);
      expect(prompt.split('AUTHOR_EXTENSION_MARKER').length - 1).toBe(jailbreakEnabled ? 1 : 0);
      expect(prompt.split('MOD_EXTENSION_MARKER').length - 1).toBe(modEnabled ? 1 : 0);
      expect(prompt).toContain('PRIVATE_PROFILE_MARKER');
      expect(prompt).not.toContain('【内容尺度】SFW');
    }
  });
});
