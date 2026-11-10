import { describe, expect, it } from 'vitest';
import type { Message } from '@/types/tavern';
import { buildLegacyNovelChapters } from './novel-legacy-chapters';
const message = (id: string, role: Message['role'], content: string, status: Message['status'] = 'complete'): Message => ({ id, role, content, status, characterId: 'book', createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z' });
describe('legacy chapter conversion', () => {
  it('retains source messages and carries prompts to each complete reply', () => {
    const messages = [message('u1', 'user', '发现灯塔'), message('a1', 'assistant', '第一段正文'), message('u2', 'user', '走进港口'), message('a2', 'assistant', '第二段正文'), message('partial', 'assistant', '未完成正文', 'streaming')];
    const before = structuredClone(messages);
    const result = buildLegacyNovelChapters('book', messages, []);
    expect(result.map(c => [c.index, c.goal, c.content, c.status])).toEqual([[1, '发现灯塔', '第一段正文', 'draft'], [2, '走进港口', '第二段正文', 'draft']]);
    expect(messages).toEqual(before);
  });
  it('repeated imports never duplicate chapters and new replies append after existing chapters', () => {
    const messages = [message('a1', 'assistant', '已有正文')];
    const existing = buildLegacyNovelChapters('book', messages, []);
    expect(buildLegacyNovelChapters('book', messages, existing)).toEqual([]);
    const next = buildLegacyNovelChapters('book', [...messages, message('a2', 'assistant', '新正文')], [{ ...existing[0], index: 7 }]);
    expect(next).toHaveLength(1);
    expect(next[0].index).toBe(8);
    expect(next[0].id).toBe('legacy-book-a2');
  });
  it('skips failed, cancelled and empty replies', () => {
    expect(buildLegacyNovelChapters('book', [message('failed', 'assistant', '错误', 'error'), message('cancelled', 'assistant', '中断', 'cancelled'), message('blank', 'assistant', '  ')], [])).toEqual([]);
  });
});
