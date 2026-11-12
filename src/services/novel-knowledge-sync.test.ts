import { describe, expect, it } from 'vitest';
import { createEmptyStoryAnalysis } from '@/constants/novel-story-state';
import { buildLegacyNovelInput } from '@/features/novel-creation/legacy-novel-adapter';
import { createEmptyCastCharacter } from '@/services/novel-create-ai';
import { syncStoryAnalysisToKnowledgeBase } from './novel-knowledge-sync';
import { castFromDossier, dossierFromCast } from '@/utils/novel-dossiers';
import type { Novel } from '@/types/tavern';

function novel(): Novel {
  return {
    ...buildLegacyNovelInput({
      blueprint: { id: 'import', title: '导入故事', premise: '', setting: '校园', protagonist: { identity: '', desire: '', obstacle: '' }, stakes: '', opening: '', direction: '', tone: '', constraints: [], longForm: { engine: '', arcs: [], openThreads: [] } },
      promptDefaults: { systemPrompt: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '' },
    }),
    id: 'import', createdAt: '', updatedAt: '', isContinuationProject: true,
    novelStoryAnalysis: {
      ...createEmptyStoryAnalysis(1),
      characters: [{ id: 'analysis-lu', name: '陆昭', role: '配角', profile: '发小', speechStyle: '爱开玩笑', appearance: '校服', personality: '好奇' }],
      characterStates: [{ characterId: 'analysis-lu', currentState: '刚成为幽灵', goal: '返校', motive: '', speakingStyle: '', knows: [], unknown: [], atChapter: 1 }],
      worldFacts: [{ id: 'world-1', subject: '缚灵规则', content: '幽灵不能离开宿主太远。', canon: true, sourceChapter: 1, validFromChapter: 1 }],
    },
  };
}

describe('continuation analysis uses the shared character library', () => {
  it('imports structured character speech even when its dynamic state is empty', () => {
    const source = novel();
    const result = syncStoryAnalysisToKnowledgeBase(source);
    expect(result.cast[0].speechStyle).toBe('爱开玩笑');
    expect(result.characterDossiers[0].castId).toBe(result.cast[0].id);
    expect(result.loreEntries[0].name).toBe('缚灵规则');
    expect(source.cast).toEqual([]);
  });

  it('imports world facts without requiring an extracted character', () => {
    const source = novel();
    source.novelStoryAnalysis!.characters = [];
    expect(syncStoryAnalysisToKnowledgeBase(source).loreEntries[0]?.name).toBe('缚灵规则');
  });

  it('does not overwrite author-maintained cards during analysis refresh', () => {
    const source = novel();
    const card = { ...createEmptyCastCharacter(), id: 'author-card', name: '陆昭', appearance: '作者选定的外貌', personality: '作者的人物性格', generatedFromReply: false };
    source.cast = [card];
    const result = syncStoryAnalysisToKnowledgeBase(source);
    expect(result.cast).toEqual([card]);
    expect(result.report.addedCast).toBe(0);
  });

  it('can import missing analysis records without refreshing any existing cards', () => {
    const source = novel();
    const existing = { ...createEmptyCastCharacter(), id: 'old-card', name: '陆昭', appearance: '已编辑的旧档案', generatedFromReply: true };
    source.cast = [existing];
    source.characterDossiers = [{ ...dossierFromCast(existing), aliases: ['阿昭'], experience: '作者小传', enabled: false }];
    source.novelStoryAnalysis!.characters.push({ id: 'analysis-shen', name: '沈砚', role: '男主', profile: '捉鬼师' });
    const result = syncStoryAnalysisToKnowledgeBase(source, { refreshGenerated: false });
    expect(result.cast[0]).toEqual(existing);
    expect(result.characterDossiers[0]).toEqual(source.characterDossiers[0]);
    expect(result.cast).toHaveLength(2);
    expect(result.report.addedCast).toBe(1);
    const repeated = syncStoryAnalysisToKnowledgeBase({ ...source, ...result }, { refreshGenerated: false });
    expect(repeated.cast).toEqual(result.cast);
    expect(repeated.report.addedCast).toBe(0);
    expect(repeated.loreEntries).toEqual(result.loreEntries);
  });

  it('shows refreshed automatic fields in the shared editor while keeping authored biography', () => {
    const source = novel();
    const card = { ...createEmptyCastCharacter(), id: 'auto-card', name: '陆昭', appearance: '旧外貌', generatedFromReply: true };
    source.cast = [card];
    source.characterDossiers = [{ ...dossierFromCast(card), experience: '作者小传', aliases: ['阿昭'], enabled: false }];
    const result = syncStoryAnalysisToKnowledgeBase(source);
    expect(castFromDossier(result.characterDossiers[0], undefined, result.cast[0]).appearance).toBe('校服');
    expect(result.characterDossiers[0].experience).toBe('作者小传');
    expect(result.characterDossiers[0].aliases).toEqual(['阿昭']);
    expect(result.characterDossiers[0].enabled).toBe(false);
    expect(source.characterDossiers[0].content).toContain('旧外貌');
  });
});
