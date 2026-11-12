import { describe, expect, it } from 'vitest';
import { buildLegacyNovelInput } from '@/features/novel-creation/legacy-novel-adapter';
import type { Novel } from '@/types/tavern';
import { buildStoryImportPatch, getStoryImportEntries, parseStoryImportCandidate, storyImportFingerprint, type StoryImportCandidate } from './model';

const source = '总纲：高中与鬼王决战。第一卷 高中日常。沈朝辉：天师血脉。陆昭野：背后灵。规则：灵契。伏笔：残魂身份。写作：第三人称。';
function novel(): Novel {
  return { ...buildLegacyNovelInput({ blueprint: { id: 'x', title: 'x', premise: '', setting: '', protagonist: { identity: '', desire: '', obstacle: '' }, stakes: '', opening: '', direction: '', tone: '', constraints: [], longForm: { engine: '', arcs: [], openThreads: [] } }, promptDefaults: { systemPrompt: '', shortTermMemoryPrompt: '', midTermMemoryPrompt: '', longTermMemoryPrompt: '' } }), id: 'x', createdAt: '', updatedAt: '', isDraft: false, createStep: 3, systemPrompt: '' };
}
function candidate(): StoryImportCandidate {
  return { summary: { content: '高中与鬼王决战', evidence: '总纲：高中与鬼王决战' }, volumes: [{ title: '高中日常', summary: '高中阶段', evidence: '第一卷 高中日常', chapters: [{ title: '第一章', goal: '相遇', index: 1, evidence: '第一卷 高中日常' }] }], characters: [{ name: '沈朝辉', aliases: [], profession: '天师', age: '', gender: '', appearance: '', personality: '', speechStyle: '', background: '天师血脉', motive: '', affiliation: '', isProtagonist: true, evidence: '沈朝辉：天师血脉' }, { name: '陆昭野', aliases: [], profession: '', age: '', gender: '', appearance: '', personality: '', speechStyle: '', background: '背后灵', motive: '', affiliation: '', evidence: '陆昭野：背后灵' }], lore: [{ name: '灵契', type: 'world', aliases: [], content: '灵契规则', evidence: '规则：灵契' }], foreshadowings: [{ keyword: '残魂身份', description: '残魂身份伏笔', note: '后期揭示', evidence: '伏笔：残魂身份' }], writingRequirements: { content: '第三人称', evidence: '写作：第三人称' }, warnings: [] };
}

describe('story import model', () => {
  it('keeps eight narrative stages as volumes without manufacturing chapters', () => {
    const titles = ['高中日常', '旧街失踪案', '古镇阴煞', '废弃医院', '荒山古墓', '黑水河', '最终决战', '劫后余生'];
    const input = titles.map((title, index) => `第${index + 1}部分：${title}`).join('\n');
    const parsed = parseStoryImportCandidate({ volumes: titles.map((title, index) => ({ title, summary: `${title}的事件`, evidence: `第${index + 1}部分：${title}`, chapters: [] })) }, input);
    const result = buildStoryImportPatch(novel(), parsed, getStoryImportEntries(parsed, novel()).map((entry) => entry.id));
    expect(result.patch.outline?.volumes).toHaveLength(8);
    expect(result.patch.outline?.volumes.every((volume) => !volume.chapters.length && volume.plannedChapterCount === undefined)).toBe(true);
  });
  it('rejects a fabricated chapter number even when the volume evidence is real', () => {
    expect(() => parseStoryImportCandidate(candidate(), source)).toThrow('明确章号');
    const input = candidate(); input.volumes[0].chapters[0].evidence = '第一百零一章：相遇'; input.volumes[0].chapters[0].index = 101;
    expect(parseStoryImportCandidate(input, source + '第一百零一章：相遇').volumes[0].chapters[0].index).toBe(101);
    input.volumes[0].chapters[0].index = 102;
    expect(() => parseStoryImportCandidate(input, source + '第一百零一章：相遇')).toThrow('不一致');
  });
  it('validates word count evidence and removes transient reply instructions', () => {
    const text = '写作：第三人称，每章2500-3500字。如果你了解了，请回复我“收到”。';
    const raw = { writingRequirements: { content: text, evidence: text, targetWords: 3000, targetWordsSource: '2500-3500字' } };
    const parsed = parseStoryImportCandidate(raw, text);
    expect(parsed.writingRequirements.content).toContain('2500-3500字');
    expect(parsed.writingRequirements.content).not.toMatch(/收到|如果你/);
    expect(parsed.writingRequirements.targetWords).toBe(3000);
    expect(() => parseStoryImportCandidate({ writingRequirements: { ...raw.writingRequirements, targetWords: 4000 } }, text)).toThrow('中值');
    expect(() => parseStoryImportCandidate({ writingRequirements: { ...raw.writingRequirements, targetWordsSource: '每章5000字' } }, text)).toThrow('原文依据');
  });
  it('shows actual replacement text and all data that will be written', () => {
    const item = novel(); item.outline = { summary: '作者总纲原文', volumes: [], updatedAt: '' }; item.writingStyle = '作者写作规范';
    const input = candidate(); input.volumes[0].tone = '轻松'; input.volumes[0].outgoing = '进入大学'; input.writingRequirements.targetWords = 3000;
    const entries = getStoryImportEntries(input, item);
    expect(entries.find((entry) => entry.kind === 'summary')?.replaces).toBe('作者总纲原文');
    expect(entries.find((entry) => entry.kind === 'writing')?.replaces).toContain('作者写作规范');
    expect(entries.find((entry) => entry.kind === 'volume')?.content).toContain('卷末状态：进入大学');
    expect(entries.find((entry) => entry.kind === 'foreshadowing')?.content).toContain('后期揭示');
    expect(entries.find((entry) => entry.kind === 'lore')?.content).toContain('分类：世界');
  });
  it('matches candidate aliases to standalone dossiers and retains authored content', () => {
    const item = novel(); item.characterDossiers = [{ id: 'd', name: '旧名', aliases: ['小陆'], content: '作者档案', experience: '作者小传', experienceDraft: '', enabled: true, updatedAt: '' }];
    const input = candidate(); input.characters[1].aliases = ['小陆'];
    const entry = getStoryImportEntries(input, item).find((entry) => entry.title === '陆昭野')!;
    expect(entry.blockedReason).toBeTruthy();
    expect(buildStoryImportPatch(item, input, [entry.id]).patch.cast).toBeUndefined();
  });
  it('blocks conflicting candidate volumes and existing planned chapter ranges', () => {
    const input = candidate(); input.volumes.push({ ...input.volumes[0], title: '第二卷' });
    expect(getStoryImportEntries(input, novel()).filter((entry) => entry.kind === 'volume').every((entry) => entry.blockedReason)).toBe(true);
    const item = novel(); item.outline = { summary: '', volumes: [{ id: 'v', title: '旧卷', summary: '', plannedChapterCount: 10, chapters: [] }], updatedAt: '' };
    expect(getStoryImportEntries(candidate(), item).find((entry) => entry.kind === 'volume')?.blockedReason).toBeTruthy();
  });
  it('rejects wrong section types, duplicate characters, and invented foreshadow chapter numbers', () => {
    expect(() => parseStoryImportCandidate({ characters: '人物文本' }, source)).toThrow('必须是数组');
    const input = candidate(); input.volumes = []; input.characters[1].aliases = ['沈朝辉'];
    expect(() => parseStoryImportCandidate(input, source)).toThrow('重复人物');
    input.characters[1].aliases = []; input.foreshadowings[0].dueAfterChapterIndex = 40;
    expect(() => parseStoryImportCandidate(input, source)).toThrow('章号缺少原文依据');
  });
  it('rejects missing or fabricated evidence', () => {
    expect(() => parseStoryImportCandidate({ characters: [{ name: '沈朝辉', evidence: '不存在' }] }, source)).toThrow('原文依据');
  });
  it('tolerates whitespace in source quotations without accepting invented text', () => {
    const text = '阎钊仅保有 70%的本源体量。';
    expect(parseStoryImportCandidate({ summary: { content: '鬼王力量不完整', evidence: '阎钊仅保有70% 的本源体量。' } }, text).summary.content).toBe('鬼王力量不完整');
    expect(() => parseStoryImportCandidate({ summary: { content: '鬼王力量不完整', evidence: '阎钊仅保有60%的本源体量。' } }, text)).toThrow('原文依据');
  });
  it('accepts adjacent source lines when the model omits Markdown list markers', () => {
    const text = '- 随后开始学习基础术法，并开启阴阳眼。\n  - 直到这一刻，他才终于看见那个跟在自己身边整整一年的身影——陆昭野。';
    const quote = '随后开始学习基础术法，并开启阴阳眼。直到这一刻，他才终于看见那个跟在自己身边整整一年的身影';
    const parsed = parseStoryImportCandidate({ lore: [{ name: '阴阳眼', content: '能够看见鬼魂灵体。', evidence: quote }] }, text);
    expect(parsed.lore[0].name).toBe('阴阳眼');
    expect(parsed.lore[0].evidence).toBe(quote);
    expect(parseStoryImportCandidate({ summary: { content: '相遇与告别', evidence: '相遇。 - 告别。' } }, '- 相遇。\n- 告别。').summary.content).toBe('相遇与告别');
    expect(() => parseStoryImportCandidate({ summary: { content: '设定', evidence: quote.replace('一年的', '十年的') } }, text)).toThrow('原文依据');
  });
  it('does not discard minus signs or intervening source content as formatting', () => {
    const summary = (quote: string) => ({ summary: { content: '规则', evidence: quote } });
    expect(() => parseStoryImportCandidate(summary('温度：10度'), '温度：-10度')).toThrow('原文依据');
    expect(() => parseStoryImportCandidate(summary('温度：10度'), '温度：\n- 10度')).toThrow('原文依据');
    expect(() => parseStoryImportCandidate(summary('相遇。告别。'), '- 相遇。\n- 并未相识。\n- 告别。')).toThrow('原文依据');
  });
  it('creates only selected records and leaves existing data untouched', () => {
    const result = buildStoryImportPatch(novel(), candidate(), getStoryImportEntries(candidate(), novel()).filter((entry) => entry.kind === 'summary').map((entry) => entry.id));
    expect(result.patch.outline?.summary).toBe('高中与鬼王决战');
    expect(result.patch.cast).toBeUndefined();
  });
  it('blocks duplicate entities and does not mutate the input', () => {
    const item = novel(); item.cast = [{ id: 'old', name: '沈朝辉', profession: '', age: '', gender: '', height: '', weight: '', appearance: '作者内容', personality: '', speechStyle: '', background: '' }];
    const entries = getStoryImportEntries(candidate(), item);
    expect(entries.find((entry) => entry.title === '沈朝辉')?.blockedReason).toBeTruthy();
    const before = storyImportFingerprint(item); buildStoryImportPatch(item, candidate(), []); expect(storyImportFingerprint(item)).toBe(before);
  });
  it('does not reuse a persisted entity id after an imported character was renamed', () => {
    const item = novel(); const input = candidate();
    const selected = getStoryImportEntries(input, item).filter((entry) => entry.kind === 'character').map((entry) => entry.id);
    const first = buildStoryImportPatch(item, input, selected).patch;
    const renamed: Novel = { ...item, ...first, cast: first.cast!.map((character) => ({ ...character, name: `${character.name}改名` })), characterDossiers: [] };
    const second = buildStoryImportPatch(renamed, input, selected).patch;
    expect(new Set(second.cast!.map((character) => character.id)).size).toBe(4);
    expect(second.characterDossiers!.every((dossier) => second.cast!.some((character) => character.id === dossier.castId))).toBe(true);
  });
  it('does not invent chapter numbers and preserves collisions', () => {
    const item = novel(); item.outline = { summary: '', updatedAt: '', volumes: [{ id: 'v', title: '旧卷', summary: '', chapters: [{ index: 1, title: '旧章', goal: '' }] }] };
    const volumeId = getStoryImportEntries(candidate(), item).find((entry) => entry.kind === 'volume')!.id;
    const result = buildStoryImportPatch(item, candidate(), [volumeId]);
    expect(result.patch.outline).toBeUndefined();
    expect(result.skipped.length).toBeGreaterThan(0);
  });
});
