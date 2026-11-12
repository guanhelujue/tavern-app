import { describe, expect, it, vi } from 'vitest';

import { normalizeNovelInspirations } from './novel-inspiration';

vi.mock('./llm', () => ({ requestCompletionWithUsage: vi.fn() }));

describe('normalizeNovelInspirations', () => {
  it('keeps three complete ideas and normalizes invalid profiles', () => {
    const ideas = normalizeNovelInspirations({
      ideas: [
        {
          title: '潮汐失语症', hook: '每次退潮，全城会忘记一个人。', world: '海港城。',
          protagonist: '档案员想保住妹妹。', conflict: '妹妹正在被全城遗忘。', direction: '从失效的户籍开始调查。',
          profile: { structure: 'single_world', entry: 'system_task', focus: 'mystery' },
        },
        { title: '第二封遗书', hook: '死者每天寄来一封新遗书。', world: '现代县城。', protagonist: '邮差。', conflict: '遗书预告下一位死者。', direction: '追查寄件人。' },
        { title: '借火', hook: '她借出的火会烧掉一段关系。', world: '旧工业城。', protagonist: '杂货店主。', conflict: '她必须在救人与保住记忆间选择。', direction: '从一次错误借火开始。' },
        { title: '第四个', hook: '不应保留。', conflict: '超出数量。' },
      ],
    });

    expect(ideas).toHaveLength(3);
    expect(ideas[0].profile.entry).toBe('none');
    expect(ideas[1].profile.focus).toBe('relationship');
  });

  it('drops ideas without a title, hook, or conflict', () => {
    expect(normalizeNovelInspirations({ ideas: [{ title: '只有标题' }] })).toEqual([]);
  });
});
