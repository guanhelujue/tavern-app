import type {
  Novel,
  NovelCastCharacter,
  NovelVolumeChapter,
  NovelVolumePlan,
} from '@/types/tavern';
import { dossierFromCast } from '@/utils/novel-dossiers';
import { createEmptyLoreEntry } from '@/utils/novel-lore';
import { DEFAULT_NOVEL_CONTINUATION_SETTINGS, NOVEL_TARGET_WORDS_RANGE } from '@/constants/novel-continuation';
import { volumeRanges } from '@/features/outline-workspace/model';
import { generateId } from '@/utils/helpers';

export type StoryImportKind = 'summary' | 'volume' | 'character' | 'lore' | 'foreshadowing' | 'writing';

export type StoryImportCandidate = {
  summary: StoryImportText;
  volumes: StoryImportVolume[];
  characters: StoryImportCharacter[];
  lore: StoryImportLore[];
  foreshadowings: StoryImportForeshadowing[];
  writingRequirements: StoryImportText & { targetWords?: number; targetWordsSource?: string };
  warnings: string[];
};

export type StoryImportText = { content: string; evidence: string };
export type StoryImportVolume = {
  title: string;
  summary: string;
  evidence: string;
  chapters: (StoryImportChapter & { index?: number })[];
  tone?: string;
  foreshadowing?: string;
  outgoing?: string;
};
export type StoryImportChapter = {
  title: string;
  goal: string;
  characterChange?: string;
  foreshadowing?: string;
  endingHook?: string;
  evidence: string;
  index?: number;
};
export type StoryImportCharacter = {
  name: string;
  aliases: string[];
  profession: string;
  age: string;
  gender: string;
  appearance: string;
  personality: string;
  speechStyle: string;
  background: string;
  motive: string;
  affiliation: string;
  isProtagonist?: boolean;
  evidence: string;
};
export type StoryImportLore = { name: string; type: 'world' | 'location' | 'faction' | 'item' | 'lore' | 'custom'; aliases: string[]; content: string; evidence: string };
export type StoryImportForeshadowing = { keyword: string; description: string; note: string; plantedChapterIndex?: number; dueAfterChapterIndex?: number; evidence: string };

export type StoryImportEntry = {
  id: string;
  kind: StoryImportKind;
  title: string;
  content: string;
  evidence: string;
  blockedReason?: string;
  replaces?: string;
};

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function stringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`大纲识别结果的${field}必须是字符串数组。`);
  return value.map(clean).filter(Boolean);
}
const list = (value: unknown) => Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
function stableId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (const char of value.trim().toLocaleLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}
function norm(value: string) { return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase(); }
function evidence(source: string, quote: string) {
  const plainQuote = quote.replace(/\s+/g, '');
  if (plainQuote && source.replace(/\s+/g, '').includes(plainQuote)) return true;
  // Quotes may omit Markdown bullets between adjacent source lines. Ignore only
  // formatting, preserving intervening text, punctuation and numeric signs.
  const normalize = (text: string) => text
    .replace(/^[\t ]*[-*+][\t ]+(?=[^\d\s])/gm, '')
    .replace(/\s+/g, '');
  const q = normalize(quote);
  return Boolean(q && normalize(source).includes(q));
}
function chineseNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0; let digit = 0;
  for (const char of value) {
    if (char in digits) digit = digits[char];
    else if (char in units) { total += (digit || 1) * units[char]; digit = 0; }
    else return undefined;
  }
  return total + digit;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function requiredString(value: unknown, field: string): string {
  const text = clean(value);
  if (!text) throw new Error(`大纲识别结果缺少${field}。`);
  return text;
}
function stripTransientReply(text: string): string {
  return text.replace(/(?:如果(?:你)?(?:已)?(?:了解|理解|明白)了?[，,、\s]*)?请(?:仅|只)?回复(?:我)?[：:\s]*[“"'「]?收到[”"'」]?[。.!！]?/g, '').trim();
}

export function parseStoryImportCandidate(raw: unknown, source: string): StoryImportCandidate {
  const root = object(raw);
  if (root.volumes !== undefined && !Array.isArray(root.volumes)) throw new Error('大纲识别结果的卷纲必须是数组。');
  if (root.characters !== undefined && !Array.isArray(root.characters)) throw new Error('大纲识别结果的人物必须是数组。');
  if (root.lore !== undefined && !Array.isArray(root.lore)) throw new Error('大纲识别结果的世界设定必须是数组。');
  if (root.foreshadowings !== undefined && !Array.isArray(root.foreshadowings)) throw new Error('大纲识别结果的伏笔必须是数组。');
  const rawSummary = object(root.summary);
  const rawWriting = object(root.writingRequirements ?? root.writing);
  const summary = { content: clean(rawSummary.content), evidence: clean(rawSummary.evidence) };
  const writingRequirements = { content: stripTransientReply(clean(rawWriting.content)), evidence: clean(rawWriting.evidence), ...(Number.isInteger(rawWriting.targetWords) && (rawWriting.targetWords as number) >= NOVEL_TARGET_WORDS_RANGE[0] && (rawWriting.targetWords as number) <= NOVEL_TARGET_WORDS_RANGE[1] ? { targetWords: rawWriting.targetWords as number } : {}), ...(clean(rawWriting.targetWordsSource) ? { targetWordsSource: clean(rawWriting.targetWordsSource) } : {}) };
  if (rawWriting.targetWords !== undefined && !Number.isInteger(rawWriting.targetWords)) throw new Error('目标字数必须是整数。');
  if (rawWriting.targetWords !== undefined && !writingRequirements.targetWords) throw new Error('目标字数超出允许范围。');
  if (writingRequirements.targetWords && (!writingRequirements.targetWordsSource || !evidence(source, writingRequirements.targetWordsSource) || !/\d/.test(writingRequirements.targetWordsSource))) throw new Error('目标字数缺少包含数字的原文依据。');
  if (writingRequirements.targetWords && writingRequirements.targetWordsSource) {
    const numbers = [...writingRequirements.targetWordsSource.matchAll(/\d+/g)].map((match) => Number(match[0]));
    if (numbers.length > 2 || !/字/.test(writingRequirements.targetWordsSource)) throw new Error('请使用简短明确的字数规范作为原文依据。');
    if (numbers.length === 2) {
      const midpoint = Math.round((numbers[0] + numbers[1]) / 2);
      if (writingRequirements.targetWords !== midpoint) throw new Error('目标字数范围必须使用上下限的确定性中值。');
    } else if (numbers.length === 1 && writingRequirements.targetWords !== numbers[0]) throw new Error('目标字数与原文依据不一致。');
    if (!writingRequirements.content.includes(writingRequirements.targetWordsSource)) {
      writingRequirements.content = [writingRequirements.content, `字数要求：${writingRequirements.targetWordsSource}`].filter(Boolean).join('\n');
    }
  }
  if (summary.content && !evidence(source, summary.evidence)) throw new Error('大纲总纲的原文依据不在粘贴文本中。');
  if (writingRequirements.content && !evidence(source, writingRequirements.evidence)) throw new Error('写作要求的原文依据不在粘贴文本中。');

  const volumes = (Array.isArray(root.volumes) ? root.volumes : []).map((rawVolume, volumeIndex) => {
    const volume = object(rawVolume);
    const title = requiredString(volume.title, `第${volumeIndex + 1}卷标题`);
    const volumeEvidence = requiredString(volume.evidence, `第${volumeIndex + 1}卷原文依据`);
    if (!evidence(source, volumeEvidence)) throw new Error(`卷「${title}」的原文依据不在粘贴文本中。`);
    if (volume.chapters !== undefined && !Array.isArray(volume.chapters)) throw new Error(`卷「${title}」的章节必须是数组。`);
    const chapters = (Array.isArray(volume.chapters) ? volume.chapters : []).map((rawChapter) => {
      const chapter = object(rawChapter);
      const chapterEvidence = requiredString(chapter.evidence, `卷「${title}」章节原文依据`);
      if (!evidence(source, chapterEvidence)) throw new Error(`卷「${title}」章节的原文依据不在粘贴文本中。`);
      const heading = chapterEvidence.match(/第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*章/);
      const explicitIndex = heading ? chineseNumber(heading[1]) : undefined;
      if (!explicitIndex || explicitIndex > 10000) throw new Error(`章节「${clean(chapter.title)}」没有明确章号的原文依据，请保留在卷纲事件中。`);
      if (chapter.index !== undefined && chapter.index !== explicitIndex) throw new Error(`章节「${clean(chapter.title)}」的章号与原文依据不一致。`);
      return {
        title: requiredString(chapter.title, '章节标题'), goal: requiredString(chapter.goal, '章节目标'), evidence: chapterEvidence,
        ...(explicitIndex !== undefined ? { index: explicitIndex } : {}),
        ...(clean(chapter.characterChange) ? { characterChange: clean(chapter.characterChange) } : {}),
        ...(clean(chapter.foreshadowing) ? { foreshadowing: clean(chapter.foreshadowing) } : {}),
        ...(clean(chapter.endingHook) ? { endingHook: clean(chapter.endingHook) } : {}),
      };
    });
    return { title, summary: requiredString(volume.summary, `卷「${title}」梗概`), evidence: volumeEvidence, chapters, ...(clean(volume.tone) ? { tone: clean(volume.tone) } : {}), ...(clean(volume.foreshadowing) ? { foreshadowing: clean(volume.foreshadowing) } : {}), ...(clean(volume.outgoing) ? { outgoing: clean(volume.outgoing) } : {}) };
  });

  const characters = (Array.isArray(root.characters) ? root.characters : []).map((rawCharacter) => {
    const character = object(rawCharacter);
    const name = requiredString(character.name, '人物姓名');
    const characterEvidence = requiredString(character.evidence, `人物「${name}」原文依据`);
    if (!evidence(source, characterEvidence)) throw new Error(`人物「${name}」的原文依据不在粘贴文本中。`);
    return {
      name, aliases: stringList(character.aliases, `人物「${name}」别名`), profession: clean(character.profession), age: clean(character.age), gender: clean(character.gender),
      appearance: clean(character.appearance), personality: clean(character.personality), speechStyle: clean(character.speechStyle), background: clean(character.background), motive: clean(character.motive), affiliation: clean(character.affiliation), evidence: characterEvidence,
      ...(character.isProtagonist === true ? { isProtagonist: true } : {}),
    };
  });
  const lore = (Array.isArray(root.lore) ? root.lore : []).map((rawLore) => {
    const item = object(rawLore); const name = requiredString(item.name, '世界设定名称'); const itemEvidence = requiredString(item.evidence, `设定「${name}」原文依据`);
    if (!evidence(source, itemEvidence)) throw new Error(`设定「${name}」的原文依据不在粘贴文本中。`);
    const type = ['world', 'location', 'faction', 'item', 'lore', 'custom'].includes(clean(item.type)) ? clean(item.type) as StoryImportLore['type'] : 'lore';
    return { name, type, aliases: stringList(item.aliases, `设定「${name}」别名`), content: requiredString(item.content, `设定「${name}」内容`), evidence: itemEvidence };
  });
  const foreshadowings = (Array.isArray(root.foreshadowings) ? root.foreshadowings : []).map((rawHook) => {
    const item = object(rawHook); const keyword = requiredString(item.keyword, '伏笔关键词'); const itemEvidence = requiredString(item.evidence, `伏笔「${keyword}」原文依据`);
    if (!evidence(source, itemEvidence)) throw new Error(`伏笔「${keyword}」的原文依据不在粘贴文本中。`);
    for (const field of ['plantedChapterIndex', 'dueAfterChapterIndex'] as const) {
      const index = item[field];
      if (index === undefined || index === 0) continue;
      const mentioned = [...itemEvidence.matchAll(/第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*章/g)].some((match) => chineseNumber(match[1]) === index);
      if (!Number.isInteger(index) || !mentioned) throw new Error(`伏笔「${keyword}」的章号缺少原文依据；只有阶段时请保留在回收计划中。`);
    }
    return { keyword, description: requiredString(item.description, `伏笔「${keyword}」描述`), note: clean(item.note), evidence: itemEvidence, ...(Number.isInteger(item.plantedChapterIndex) && (item.plantedChapterIndex as number) > 0 ? { plantedChapterIndex: item.plantedChapterIndex as number } : {}), ...(Number.isInteger(item.dueAfterChapterIndex) && (item.dueAfterChapterIndex as number) > 0 ? { dueAfterChapterIndex: item.dueAfterChapterIndex as number } : {}) };
  });
  if (!summary.content && !volumes.length && !characters.length && !lore.length && !foreshadowings.length && !writingRequirements.content) throw new Error('模型没有识别出可导入内容。');
  const keys = new Set<string>();
  for (const character of characters) for (const name of [character.name, ...character.aliases]) { const item = `c:${norm(name)}`; if (keys.has(item)) throw new Error('模型返回了重复人物名称或别名，未导入任何内容。'); keys.add(item); }
  for (const item of [...lore.map((x) => `l:${norm(x.name)}`), ...volumes.map((x) => `v:${norm(x.title)}`), ...foreshadowings.map((x) => `f:${norm(x.keyword)}`)]) { if (keys.has(item)) throw new Error('模型返回了重复名称，未导入任何内容。'); keys.add(item); }
  return { summary, volumes, characters, lore, foreshadowings, writingRequirements, warnings: list(root.warnings) };
}

export function storyImportFingerprint(novel: Novel): string {
  const data = { summary: novel.outline?.summary ?? '', baseChapterIndex: novel.outline?.baseChapterIndex ?? null, volumes: novel.outline?.volumes ?? [], cast: (novel.cast ?? []).map(({ id, name, aliases, profession, age, gender, appearance, personality, speechStyle, background, motive, affiliation, isProtagonist }) => ({ id, name, aliases, profession, age, gender, appearance, personality, speechStyle, background, motive, affiliation, isProtagonist })), dossiers: (novel.characterDossiers ?? []).map(({ id, castId, name, aliases, content, experience, enabled }) => ({ id, castId, name, aliases, content, experience, enabled })), lore: novel.loreEntries ?? [], hooks: novel.foreshadowings ?? [], writingStyle: novel.writingStyle ?? '', targetWords: novel.continuationSettings?.targetWords ?? null };
  return JSON.stringify(data);
}

function existingName(novel: Novel, value: string, kind: 'volume' | 'character' | 'lore' | 'foreshadowing') {
  const key = norm(value);
  if (kind === 'volume') return novel.outline?.volumes.find((item) => norm(item.title) === key);
  if (kind === 'character') return novel.cast?.find((item) => [item.name, ...(item.aliases ?? [])].some((name) => norm(name) === key)) ?? novel.characterDossiers?.find((item) => [item.name, ...(item.aliases ?? [])].some((name) => norm(name) === key));
  if (kind === 'lore') return novel.loreEntries?.find((item) => [item.name, ...(item.aliases ?? [])].some((name) => norm(name) === key));
  return novel.foreshadowings?.find((item) => norm(item.keyword) === key);
}

export function getStoryImportEntries(candidate: StoryImportCandidate, novel: Novel): StoryImportEntry[] {
  const entries: StoryImportEntry[] = [];
  const existingRanges = novel.outline ? volumeRanges(novel.outline).filter((range) => {
    const volume = novel.outline!.volumes.find((item) => item.id === range.id)!;
    return volume.plannedChapterCount || volume.chapters.length;
  }) : [];
  const candidateRanges = candidate.volumes.map((volume) => {
    const indexes = volume.chapters.map((chapter) => chapter.index ?? 0);
    return { start: Math.min(...indexes), end: Math.max(...indexes) };
  });
  if (candidate.summary.content) entries.push({ id: 'summary', kind: 'summary', title: '全书总纲', content: candidate.summary.content, evidence: candidate.summary.evidence, ...(novel.outline?.summary.trim() ? { replaces: novel.outline.summary } : {}) });
  candidate.volumes.forEach((volume) => {
    const range = candidateRanges[candidate.volumes.indexOf(volume)];
    const indexes = volume.chapters.map((chapter) => chapter.index);
    const collision = indexes.some((index) => !index || !Number.isInteger(index)) || new Set(indexes).size !== indexes.length || (volume.chapters.length > 0 && [...existingRanges, ...candidateRanges.filter((item) => item !== range)].some((other) => range.start <= other.end && range.end >= other.start));
    entries.push({ id: stableId('volume', volume.title), kind: 'volume', title: volume.title, content: [volume.summary, volume.tone && `基调：${volume.tone}`, volume.foreshadowing && `伏笔边界：${volume.foreshadowing}`, volume.outgoing && `卷末状态：${volume.outgoing}`, ...volume.chapters.map((chapter) => `第${chapter.index ?? '?'}章 ${chapter.title}：${chapter.goal}${chapter.characterChange ? `；人物变化：${chapter.characterChange}` : ''}${chapter.foreshadowing ? `；伏笔：${chapter.foreshadowing}` : ''}${chapter.endingHook ? `；章末：${chapter.endingHook}` : ''}`)].filter(Boolean).join('\n'), evidence: volume.evidence, ...(existingName(novel, volume.title, 'volume') ? { blockedReason: '已有同名卷纲，避免覆盖作者内容。' } : collision ? { blockedReason: '卷内章号缺失、重复或与其他卷的规划冲突，整卷不会导入。' } : {}) });
  });
  candidate.characters.forEach((character) => entries.push({ id: stableId('character', character.name), kind: 'character', title: character.name, content: [`姓名：${character.name}`, character.aliases.length ? `别名：${character.aliases.join('、')}` : '', character.profession ? `职业：${character.profession}` : '', character.age ? `年龄：${character.age}` : '', character.gender ? `性别：${character.gender}` : '', character.appearance ? `外貌：${character.appearance}` : '', character.personality ? `性格：${character.personality}` : '', character.speechStyle ? `语气：${character.speechStyle}` : '', character.background ? `背景：${character.background}` : '', character.motive ? `动机：${character.motive}` : '', character.affiliation ? `阵营：${character.affiliation}` : '', character.isProtagonist ? '身份：主角' : ''].filter(Boolean).join('\n'), evidence: character.evidence, ...([character.name, ...character.aliases].some((name) => existingName(novel, name, 'character')) ? { blockedReason: '姓名或别名与已有的人物卡、人物资料重复，保留作者内容。' } : {}) }));
  const loreLabels = { world: '世界', location: '地点', faction: '势力', item: '物品', lore: '背景设定', custom: '自定义' };
  candidate.lore.forEach((item) => entries.push({ id: stableId('lore', item.name), kind: 'lore', title: item.name, content: [`分类：${loreLabels[item.type]}`, item.aliases.length ? `别名：${item.aliases.join('、')}` : '', item.content].filter(Boolean).join('\n'), evidence: item.evidence, ...([item.name, ...item.aliases].some((name) => existingName(novel, name, 'lore')) ? { blockedReason: '名称或别名与已有知识库条目重复，保留作者内容。' } : {}) }));
  candidate.foreshadowings.forEach((item) => entries.push({ id: stableId('foreshadowing', item.keyword), kind: 'foreshadowing', title: item.keyword, content: [item.description, item.note && `揭示／回收计划：${item.note}`, item.plantedChapterIndex ? `埋设：第${item.plantedChapterIndex}章` : '埋设：待规划', item.dueAfterChapterIndex && `预计回收：第${item.dueAfterChapterIndex}章`].filter(Boolean).join('\n'), evidence: item.evidence, ...(existingName(novel, item.keyword, 'foreshadowing') ? { blockedReason: '已有同名伏笔，避免覆盖作者内容。' } : {}) }));
  if (candidate.writingRequirements.content) {
    const current = [novel.writingStyle.trim(), candidate.writingRequirements.targetWords && novel.continuationSettings?.targetWords ? `目标字数：${novel.continuationSettings.targetWords}` : ''].filter(Boolean).join('\n');
    entries.push({ id: 'writing', kind: 'writing', title: '写作要求', content: `${candidate.writingRequirements.content}${candidate.writingRequirements.targetWords ? `\n目标字数：${candidate.writingRequirements.targetWords}` : ''}`, evidence: candidate.writingRequirements.evidence, ...(current ? { replaces: current } : {}) });
  }
  return entries;
}

function volumeFromCandidate(volume: StoryImportVolume, id: string, used: Set<number>): NovelVolumePlan {
  const chapters: NovelVolumeChapter[] = [];
  for (const raw of volume.chapters) {
    if (!raw.index) throw new Error(`卷「${volume.title}」包含没有明确章号的章节，请将它保留在卷纲事件描述中后再导入。`);
    if (used.has(raw.index)) throw new Error(`卷「${volume.title}」的章节号与已有章纲冲突。`);
    used.add(raw.index); chapters.push({ index: raw.index, title: raw.title, goal: raw.goal, ...(raw.characterChange ? { characterChange: raw.characterChange } : {}), ...(raw.foreshadowing ? { foreshadowing: raw.foreshadowing } : {}), ...(raw.endingHook ? { endingHook: raw.endingHook } : {}) });
  }
  return { id, title: volume.title, summary: volume.summary, ...(volume.tone ? { tone: volume.tone } : {}), ...(volume.foreshadowing ? { foreshadowing: volume.foreshadowing } : {}), ...(volume.outgoing ? { handoff: { outgoing: volume.outgoing } } : {}), chapters, ...(chapters.length ? { plannedChapterCount: Math.max(...chapters.map((item) => item.index)) - Math.min(...chapters.map((item) => item.index)) + 1 } : {}) };
}

export function buildStoryImportPatch(novel: Novel, candidate: StoryImportCandidate, selectedIds: string[]): { patch: Partial<Novel>; appliedCount: number; skipped: string[] } {
  const selected = new Set(selectedIds); const skipped: string[] = []; let appliedCount = 0;
  const entries = getStoryImportEntries(candidate, novel); const allowed = new Set(entries.filter((entry) => selected.has(entry.id) && !entry.blockedReason).map((entry) => entry.id));
  const patch: Partial<Novel> = {};
  if (allowed.has('summary')) { patch.outline = { ...(novel.outline ?? { summary: '', volumes: [], updatedAt: new Date(0).toISOString() }), summary: candidate.summary.content, updatedAt: new Date().toISOString() }; appliedCount++; }
  if (allowed.has('writing')) {
    patch.writingStyle = candidate.writingRequirements.content;
    if (candidate.writingRequirements.targetWords) patch.continuationSettings = { ...(novel.continuationSettings ?? DEFAULT_NOVEL_CONTINUATION_SETTINGS), targetWords: candidate.writingRequirements.targetWords };
    appliedCount++;
  }
  const outline = novel.outline ? { ...novel.outline, volumes: [...novel.outline.volumes] } : { summary: '', volumes: [], updatedAt: new Date().toISOString() };
  const used = new Set(outline.volumes.flatMap((volume) => volume.chapters.map((chapter) => chapter.index)));
  for (const volume of candidate.volumes) {
    const id = stableId('volume', volume.title); if (!allowed.has(id)) continue;
    outline.volumes.push(volumeFromCandidate(volume, generateId('volume'), used)); appliedCount++;
  }
  if (allowed.has('summary') || outline.volumes.length !== (novel.outline?.volumes.length ?? 0)) patch.outline = { ...outline, summary: allowed.has('summary') ? candidate.summary.content : outline.summary, updatedAt: new Date().toISOString() };
  const cast = [...(novel.cast ?? [])]; const dossiers = [...(novel.characterDossiers ?? [])];
  for (const character of candidate.characters) {
    const id = stableId('character', character.name); if (!allowed.has(id)) continue;
    const castCharacter: NovelCastCharacter = { id: generateId('character'), name: character.name, aliases: character.aliases, profession: character.profession, age: character.age, gender: character.gender, height: '', weight: '', appearance: character.appearance, personality: character.personality, speechStyle: character.speechStyle, background: character.background, motive: character.motive, affiliation: character.affiliation, isProtagonist: character.isProtagonist, generatedFromReply: false };
    cast.push(castCharacter); dossiers.push(dossierFromCast(castCharacter)); appliedCount++;
  }
  if (cast.length !== (novel.cast ?? []).length) { patch.cast = cast; patch.characterDossiers = dossiers; }
  const lore = [...(novel.loreEntries ?? [])];
  for (const item of candidate.lore) { const id = stableId('lore', item.name); if (!allowed.has(id)) continue; const entry = createEmptyLoreEntry(item.type); entry.name = item.name; entry.aliases = item.aliases; entry.content = item.content; lore.push(entry); appliedCount++; }
  if (lore.length !== (novel.loreEntries ?? []).length) patch.loreEntries = lore;
  const hooks = [...(novel.foreshadowings ?? [])];
  for (const item of candidate.foreshadowings) { const id = stableId('foreshadowing', item.keyword); if (!allowed.has(id)) continue; hooks.push({ id: generateId('foreshadowing'), keyword: item.keyword, description: item.description, status: 'open', plantedChapterIndex: item.plantedChapterIndex ?? 0, ...(item.dueAfterChapterIndex ? { dueAfterChapterIndex: item.dueAfterChapterIndex } : {}), createdAt: new Date().toISOString(), note: item.note }); appliedCount++; }
  if (hooks.length !== (novel.foreshadowings ?? []).length) patch.foreshadowings = hooks;
  for (const entry of entries) if (selected.has(entry.id) && entry.blockedReason) skipped.push(`${entry.title}：${entry.blockedReason}`);
  return { patch, appliedCount, skipped };
}
