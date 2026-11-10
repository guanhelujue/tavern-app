import { requestCompletionWithUsage } from './llm';
import type { ApiSettings, OpenAIChatMessage } from '../types/tavern';
import { COMIC_DIMENSIONS } from '../constants/novel-comic';
import type {
  ComicAspect, ComicCharacter, ComicPage, ComicPageKind, ComicPageLayout, ComicPanel,
  ComicSourceKind, NovelComicDocument,
} from '../types/novel-comic';

export type ComicStoryMode = 'auto' | 'daily' | 'battle';
export type ComicPlannerRequest = {
  novelId: string;
  sourceId: string;
  sourceKind: ComicSourceKind;
  sourceTitle: string;
  content: string;
  characters: ComicCharacter[];
  apiSettings: ApiSettings;
  pageCount?: number;
  storyMode?: ComicStoryMode;
  signal?: AbortSignal;
  requestCompletion?: typeof requestCompletionWithUsage;
};

const PAGE_COUNTS: Record<ComicPageLayout, number> = {
  'daily-grid': 4, 'daily-focus': 3, 'battle-action': 3, 'battle-impact': 1,
};
const LAYOUTS = new Set<ComicPageLayout>(Object.keys(PAGE_COUNTS) as ComicPageLayout[]);
const ASPECTS = new Set<ComicAspect>(Object.keys(COMIC_DIMENSIONS) as ComicAspect[]);
const KINDS = new Set<ComicPageKind>(['daily', 'battle']);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function jsonFromResponse(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) { try { return JSON.parse(candidate); } catch { /* bounded fallback */ } }
  throw new Error('分镜规划模型返回的内容不是合法 JSON。');
}

/** Stable, synchronous source fingerprint used to detect stale comic plans. */
export function comicSourceHash(content: string): string {
  let a = 0x811c9dc5; let b = 0x9e3779b9;
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + i), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildComicPlannerPrompt({ content, characters, pageCount, storyMode }: Pick<ComicPlannerRequest, 'content' | 'characters' | 'pageCount' | 'storyMode'>): string {
  const roster = characters.map((c) => `${c.id}: ${c.name}; appearance=${c.appearance}; outfit=${c.outfit}`).join('\n');
  const modeRule = storyMode === 'daily'
    ? '本次所有页面必须是 daily。'
    : storyMode === 'battle' ? '本次所有页面必须是 battle。' : 'auto 模式可按正文在 daily 与 battle 页面之间混合。';
  return `你是写实连续叙事的分镜导演。把正文拆成 ${pageCount} 页，每页包含下述布局指定的多个镜头，每个 panel 单独生成一张摄影画面，最后由应用拼页。最终图像是现实世界的电影感照片，不是漫画绘画。不要画格边框、拼贴、气泡或任何文字；caption/dialogue 由应用单独排版。

规则：
- daily 页强调建立空间、人物互动、表情和生活细节。battle 页先交代双方位置和动作方向，再拆成准备、接触、结果；单格只能有一个主要身体动作，不要把一串动作画在同一张照片里。保持人物左右方位、视线轴线、武器、伤势、衣服、光线连续。
- 每个 panel 使用同一组角色原始参考图，不把上一格生成图当作参考。characterIds 只列镜头中可见的人物；空镜返回空数组，每幕最多四人。
- 只描写正文已有事件，不添加情节。prompt 使用约 60–120 个英文单词，描述一个冻结瞬间，具体描写外观、服装、地点、时间、镜头距离和角度、单个动作与光线。不能使用“合书并起身再走过去”等多个动作；选择其中一个完成后的状态。不要照抄原图站姿，明确说明目标姿态和构图。
- continuity 必须写出具体可验证的状态，包括人物在画面左/右、面向方向、手中物品、物品放置位置和光线方向，不能只写“保持连续”。同一件道具只能出现一次；书已放在长椅上时人物应空手，prompt 中也要明确 empty hands 和 only one book。
- sourceText 必须是正文中逐字出现的短引文，最多 240 字，各幕按原文顺序排列；caption 最多 24 字；每格 dialogue 最多两条、每条最多 20 字，不重复解释图中已经清楚的动作。
- 布局：daily-grid 四格；daily-focus 一大两小（三格）；battle-action 一大两小（三格）；battle-impact 关键瞬间整页（一格）。daily 页只能使用 daily 布局，battle 页只能使用 battle 布局。${modeRule}
- 画幅：daily-grid 各幕优先 portrait；daily-focus/battle-action 第一幕优先 wide 或 landscape，其余优先 portrait；battle-impact 优先 tall。空间关系或横向冲刺可用 wide，面部与反应用 square。aspect 仅限 portrait/square/landscape/wide/tall，尺寸由应用固定。
- 已有角色只能引用，不能在 characters 中重复或改写；根级 characters 默认空数组。仅当角色表缺少正文人物时添加 derived 视觉角色，每个新角色必须有 id/name/appearance/outfit/sourceText，sourceText 必须逐字来自正文；总角色数最多 12 个。这不改变小说档案。

角色表：
${roster || '无角色表，请从正文提取有依据的人物，在根级 characters 返回视觉设定。'}

只输出 JSON：{"characters":[],"pages":[{"id":"page-1","kind":"daily|battle","layout":"...","panels":[{"id":"page-1-panel-1","index":0,"beat":"...","sourceText":"...","characterIds":["角色id"],"location":"...","time":"...","camera":"...","action":"...","continuity":"...","prompt":"...","negativePrompt":"...","caption":"...","dialogue":[{"speaker":"...","text":"..."}],"aspect":"portrait","seed":12345}]}]}

正文：
${content}`;
}

function normalizeAspect(value: unknown, width: unknown, height: unknown): ComicAspect {
  if (ASPECTS.has(text(value) as ComicAspect)) return text(value) as ComicAspect;
  const w = Number(width); const h = Number(height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    const ratio = w / h;
    if (ratio >= 1.65) return 'wide'; if (ratio >= 1.2) return 'landscape';
    if (ratio <= 0.7) return 'tall'; if (ratio <= 0.9) return 'portrait';
  }
  return 'portrait';
}

const FIXED_PROMPT_CONSTRAINTS = 'Photorealistic live-action cinematic photograph, natural anatomy and skin texture, no generated text, no subtitles, no speech bubbles, no comic borders, no collage, no watermark.';
const FIXED_NEGATIVE_CONSTRAINTS = 'generated text, subtitles, speech bubbles, comic borders, collage, watermark';

function deriveSeed(sourceHash: string, panelIndex: number): number {
  let value = 2166136261;
  const input = `${sourceHash}:${panelIndex}`;
  for (let i = 0; i < input.length; i += 1) value = Math.imul(value ^ input.charCodeAt(i), 16777619);
  return (value >>> 0) + 1;
}

function finalPrompt(rawPrompt: string, panel: Record<string, unknown>, characters: ComicCharacter[]): string {
  const details = array(panel.characterIds).map(text).map((id) => characters.find((c) => c.id === id)).filter((c): c is ComicCharacter => Boolean(c)).map((c) => `${c.name}: ${c.appearance}; wearing ${c.outfit}.`).join(' ');
  // Never truncate a completed shot: an action or camera instruction at the
  // end matters just as much as the character description at the beginning.
  return `${rawPrompt} Character continuity: ${details} ${FIXED_PROMPT_CONSTRAINTS}`.trim();
}

function mergeCharacters(raw: unknown, existing: ComicCharacter[], content: string): ComicCharacter[] {
  const all: ComicCharacter[] = existing.map((c) => ({ ...c }));
  const known = new Set(all.map((c) => c.id));
  for (const item of array(raw)) {
    const row = record(item); const id = text(row.id);
    if (!id) throw new Error('新增角色缺少 id。');
    if (known.has(id)) throw new Error(`新增角色 ${id} 不能覆盖已有角色设定。`);
    const sourceText = text(row.sourceText);
    if (!sourceText || sourceText.length > 240 || !content.includes(sourceText)) throw new Error(`新增角色 ${id} 的 sourceText 必须来自正文且不超过 240 字。`);
    const name = text(row.name); const appearance = text(row.appearance); const outfit = text(row.outfit);
    if (!name || !appearance || !outfit) throw new Error(`新增角色 ${id} 缺少视觉设定。`);
    all.push({ id, name, appearance, outfit, sourceText, derived: true }); known.add(id);
  }
  if (all.length > 12) throw new Error('分镜角色总数不能超过 12 个。');
  return all;
}

function validateAndNormalizePages(raw: unknown, content: string, characters: ComicCharacter[], requestedCount: number, sourceHash: string, storyMode: ComicStoryMode): ComicPage[] {
  const rows = array(record(raw).pages);
  if (rows.length !== requestedCount) throw new Error(`分镜页数不符：需要 ${requestedCount} 页，模型返回 ${rows.length} 页。`);
  const known = new Set(characters.map((c) => c.id)); const ids = new Set<string>();
  let lastSourceOffset = -1;
  return rows.map((item, pageIndex) => {
    const page = record(item); const id = text(page.id) || `page-${pageIndex + 1}`;
    if (ids.has(id)) throw new Error(`分镜 ID 重复：${id}`); ids.add(id);
    const kind = text(page.kind) as ComicPageKind; const layout = text(page.layout) as ComicPageLayout;
    if (!KINDS.has(kind) || !LAYOUTS.has(layout)) throw new Error(`第 ${pageIndex + 1} 页的 kind/layout 无效。`);
    if ((kind === 'daily') !== layout.startsWith('daily')) throw new Error(`第 ${pageIndex + 1} 页的类型与布局不匹配。`);
    if (storyMode !== 'auto' && kind !== storyMode) throw new Error(`第 ${pageIndex + 1} 页不符合 storyMode=${storyMode}。`);
    const panelRows = array(page.panels);
    if (panelRows.length !== PAGE_COUNTS[layout]) throw new Error(`第 ${pageIndex + 1} 页需要 ${PAGE_COUNTS[layout]} 格，模型返回 ${panelRows.length} 格。`);
    const panelIds = new Set<string>();
    const panels: ComicPanel[] = panelRows.map((rawPanel, panelIndex) => {
      const p = record(rawPanel); const panelId = text(p.id) || `${id}-panel-${panelIndex + 1}`;
      if (panelIds.has(panelId) || ids.has(panelId)) throw new Error(`分镜 ID 重复：${panelId}`); panelIds.add(panelId); ids.add(panelId);
      const sourceText = text(p.sourceText);
      const sourceOffset = content.indexOf(sourceText, Math.max(0, lastSourceOffset));
      if (!sourceText || sourceText.length > 240 || !content.includes(sourceText)) throw new Error(`分镜 ${panelId} 的 sourceText 必须是正文中不超过 240 字的原文片段。`);
      if (sourceOffset < 0) throw new Error(`分镜 ${panelId} 的 sourceText 顺序倒退。`);
      if (sourceOffset < lastSourceOffset) throw new Error(`分镜 ${panelId} 的 sourceText 顺序倒退。`);
      lastSourceOffset = sourceOffset;
      const characterIds = array(p.characterIds).map(text).filter(Boolean);
      if (characterIds.length > 4) throw new Error(`分镜 ${panelId} 最多包含 4 个角色。`);
      if (characterIds.some((characterId) => !known.has(characterId))) throw new Error(`分镜 ${panelId} 引用了未知角色。`);
      const prompt = text(p.prompt); if (!prompt) throw new Error(`分镜 ${panelId} 缺少 prompt。`);
      const aspect = normalizeAspect(p.aspect, p.width, p.height); const dimensions = COMIC_DIMENSIONS[aspect];
      const rawDialogue = array(p.dialogue);
      if (rawDialogue.length > 2) throw new Error(`分镜 ${panelId} 的 dialogue 最多 2 条。`);
      const dialogue = rawDialogue.map((d) => { const row = record(d); return { speaker: text(row.speaker), text: text(row.text) }; }).filter((d) => d.speaker && d.text);
      if (dialogue.some((d) => d.text.length > 20)) throw new Error(`分镜 ${panelId} 的 dialogue 超过 20 字。`);
      const caption = text(p.caption);
      if (caption.length > 24) throw new Error(`分镜 ${panelId} 的 caption 超过 24 字。`);
      const seedNumber = Number(p.seed);
      const seed = Number.isSafeInteger(seedNumber) && seedNumber > 0 ? seedNumber : deriveSeed(sourceHash, pageIndex * 10 + panelIndex);
      return { id: panelId, index: panelIndex, beat: text(p.beat), sourceText, characterIds, location: text(p.location), time: text(p.time), camera: text(p.camera), action: text(p.action), continuity: text(p.continuity), prompt: finalPrompt(prompt, p, characters), negativePrompt: `${text(p.negativePrompt) || 'deformed hands, duplicate people'}, ${FIXED_NEGATIVE_CONSTRAINTS}`, caption, dialogue, aspect, width: dimensions.width, height: dimensions.height, seed, status: 'pending' };
    });
    return { id, index: pageIndex, kind, layout, panels, status: 'pending' };
  });
}

export async function planNovelComic(input: ComicPlannerRequest): Promise<NovelComicDocument> {
  if (input.signal?.aborted) { const error = new Error('分镜规划已取消。'); error.name = 'AbortError'; throw error; }
  const content = input.content.trim(); if (!content) throw new Error('无法为空正文生成分镜。');
  if (content.length > 30_000) throw new Error('正文超过 30000 字，请按章节或片段生成分镜。');
  const pageCount = Math.max(1, Math.min(6, Math.round(Number.isFinite(input.pageCount) ? input.pageCount! : 2)));
  const completion = input.requestCompletion ?? requestCompletionWithUsage;
  const result = await completion({ apiSettings: { ...input.apiSettings, streamingEnabled: false, thinkingDisabled: true }, purpose: 'comic-plan', maxTokens: Math.min(15000, 600 + pageCount * 2400), temperature: 0.35, signal: input.signal, messages: [{ role: 'system', content: '只输出符合要求的 JSON，不要 Markdown 或解释。' }, { role: 'user', content: buildComicPlannerPrompt({ content, characters: input.characters, pageCount, storyMode: input.storyMode ?? 'auto' }) }] as OpenAIChatMessage[] });
  const sourceHash = comicSourceHash(content);
  const rawPlan = jsonFromResponse(result.content);
  const characters = mergeCharacters(record(rawPlan).characters, input.characters, content);
  const pages = validateAndNormalizePages(rawPlan, content, characters, pageCount, sourceHash, input.storyMode ?? 'auto');
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: `comic-${input.novelId}-${input.sourceId}-${sourceHash.slice(0, 10)}`, novelId: input.novelId, sourceId: input.sourceId, sourceKind: input.sourceKind, sourceTitle: input.sourceTitle, sourceHash, visualStyle: 'photorealistic', modelId: 'qwen-image-2.1', createdAt: now, updatedAt: now, llmModelId: result.model || input.apiSettings.model, characters, pages, status: 'planned' };
}
