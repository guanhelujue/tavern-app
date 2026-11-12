import { describe, expect, it } from 'vitest';
import { buildNovelCharacterContext } from './novel-narrative-context';
import type { Novel } from '@/types/tavern';

describe('active story canon', () => {
  it('does not inject obsolete serialized identity and opening beside the current values', () => {
    const novel = { id: 'n', name: '故事', worldName: '江城', worldEra: '高二开学', gameRules: '幽灵不可被常人看见', playerName: '', playerMotive: '',
      cast: [{ id: 's', name: '沈砚', isProtagonist: true, profession: '17岁高中生', motive: '返校', age: '17', gender: '男', height: '', weight: '', appearance: '', personality: '', speechStyle: '', background: '', strengths: '', weaknesses: '', habits: '', secrets: '' }],
      characterDossiers: [], loreEntries: [],
      initialStoryState: '三年后大学宿舍',
      projectBrief: { premise: '校园故事', firstChapterGoal: '死亡三天后返校', ending: '自主告别', theme: '轻松', plannedChapters: 40 },
      foundationPrompt: '【主角核心】\n身份：20岁大学生\n\n【开篇状态】\n三年后大学宿舍\n\n【自定义事实】\n旧铃不响',
    } as unknown as Novel;
    const context = buildNovelCharacterContext(novel, '第1章');
    expect(context).toContain('17岁高中生');
    expect(context).toContain('死亡三天后返校');
    expect(context).toContain('旧铃不响');
    expect(context).not.toContain('20岁大学生');
    expect(context).not.toContain('三年后大学宿舍');
  });
});
