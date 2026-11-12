import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOVEL_SYSTEM_PROMPT } from '@/constants/novel-memory';
import { buildRewriteContext, auditRewriteChapter, reviseRewriteChapter, type RewriteContextInput } from './novel-rewrite-pipeline';
import type { NovelChapter, NovelRewriteAudit } from '@/types/tavern';
import type { LlmCompletion } from '@/services/novel-story-state';

const customPrompt = '用第一人称写一部书信体小说。保留每封信的标题和落款，语言克制。';
const input: RewriteContextInput = {
  novelName: '信箱', analysis: null, plan: null, forecast: null, lastChapter: null, recentChapters: [],
  userGuide: { endingPreference: '', targetLength: '', mustKeep: '', mustAvoid: '' }, targetWords: 1800,
};
const chapter: NovelChapter = { id: 'c1', index: 1, title: '来信', goal: '找到一封信', content: '我打开信箱。', summary: '', status: 'draft', aiGenerated: false, createdAt: '', updatedAt: '' };

describe('novel prompt authority in chapter writing', () => {
  it('uses the novel prompt and treats the first chapter as an opening', () => {
    const result = buildRewriteContext({ ...input, novelSystemPrompt: customPrompt, chapterIndex: 1 });
    expect(result.systemPrompt).toContain(customPrompt);
    expect(result.systemPrompt).not.toContain('的续写作者');
    expect(result.systemPrompt).not.toContain('【反 AI 味规则】');
    expect(result.userPrompt).toContain('第1章');
    expect(result.userPrompt).toContain('开篇');
    expect(result.userPrompt).not.toContain('续写下一章');
    expect(result.userPrompt).not.toContain('不要输出章节标题');
  });

  it('uses the built-in novel prompt when no custom prompt exists', () => {
    expect(buildRewriteContext(input).systemPrompt).toContain(DEFAULT_NOVEL_SYSTEM_PROMPT);
  });

  it('preserves the complete main prompt even under a small context budget', () => {
    const longPrompt = `${customPrompt}${'小说叙事规则。'.repeat(600)}结尾规则必须保留`;
    const result = buildRewriteContext({ ...input, novelSystemPrompt: longPrompt, characterContext: '当前世界和人物', maxContextChars: 1000 });
    expect(result.systemPrompt).toContain(longPrompt);
    expect(result.systemPrompt.indexOf(longPrompt)).toBeLessThan(result.systemPrompt.indexOf('当前世界和人物'));
  });

  it('retains earlier prose as continuity material without imposing its viewpoint', () => {
    const result = buildRewriteContext({ ...input, novelSystemPrompt: customPrompt, chapterIndex: 2, lastChapter: chapter, recentChapters: [chapter] });
    expect(result.systemPrompt).toContain('【上一章结尾】');
    expect(result.systemPrompt).toContain(chapter.content);
    expect(result.userPrompt).toContain('第2章');
    expect(result.userPrompt).not.toContain('保持叙事视角与语言风格与前文一致');
  });

  it('keeps all selected chapter excerpts beyond twenty when the budget permits', () => {
    const history = Array.from({ length: 25 }, (_, index) => ({ ...chapter, id: `history-${index}`, index: index + 1, content: `前文唯一标记${index + 1}。` }));
    const result = buildRewriteContext({ ...input, recentChapters: history, lastChapter: history.at(-1)!, maxContextChars: 20000 });
    for (const item of history) expect(result.systemPrompt).toContain(item.content);
    const bounded = buildRewriteContext({ ...input, recentChapters: history.map(item => ({ ...item, content: '长正文'.repeat(1000) })), maxContextChars: 1000 });
    expect(bounded.systemPrompt).toContain('【上下文已按预算裁剪】');
  });

  it('audits against the novel prompt while retaining the audit JSON contract', async () => {
    const completion = vi.fn<LlmCompletion>(async () => ({ content: '{"score":95,"issues":[]}' }));
    await auditRewriteChapter({ ...input, novelSystemPrompt: customPrompt, chapter, completion });
    const messages = completion.mock.calls[0][0];
    expect(messages[0].content).toContain('输出严格为 JSON');
    expect(messages[1].content).toContain(customPrompt);
  });

  it('preserves novel instructions during automatic revision', async () => {
    const completion = vi.fn<LlmCompletion>(async () => ({ content: '修订后的正文' }));
    const audit = { issues: [{ severity: 'warning', category: 'pacing', repairScope: 'local', description: '重复', evidence: '信', suggestion: '删除重复句' }] } as NovelRewriteAudit;
    await reviseRewriteChapter({ novelName: input.novelName, novelSystemPrompt: customPrompt, chapter, audit, completion });
    const messages = completion.mock.calls[0][0];
    expect(messages[0].content).toContain(customPrompt);
  });
});
