import { tryParseAiJson } from '@/utils/ai-json';
import { requestCompletionWithUsage } from './llm';
import type { ApiSettings, NovelNarrativeProfile } from '../types/tavern';
import { asRecord, asString } from '../utils/helpers';

export type NovelInspiration = {
  id: string;
  title: string;
  hook: string;
  world: string;
  protagonist: string;
  conflict: string;
  direction: string;
  profile: NovelNarrativeProfile;
};

const DEFAULT_PROFILES: readonly NovelNarrativeProfile[] = [
  { structure: 'single_world', entry: 'none', focus: 'mystery', knownPlot: false },
  { structure: 'single_world', entry: 'none', focus: 'relationship', knownPlot: false },
  { structure: 'single_world', entry: 'none', focus: 'power', knownPlot: false },
];

function normalizeProfile(value: unknown, index: number): NovelNarrativeProfile {
  const raw = asRecord(value);
  const fallback = DEFAULT_PROFILES[index % DEFAULT_PROFILES.length];
  const structure = raw.structure === 'multi_world' || raw.structure === 'single_world'
    ? raw.structure
    : fallback.structure;
  const entry = raw.entry === 'system_task'
    || raw.entry === 'breakthrough'
    || raw.entry === 'book_transmigration'
    || raw.entry === 'none'
    ? raw.entry
    : fallback.entry;
  const focus = raw.focus === 'power'
    || raw.focus === 'relationship'
    || raw.focus === 'mystery'
    || raw.focus === 'mixed'
    ? raw.focus
    : fallback.focus;

  return {
    structure,
    entry: structure === 'single_world' && (entry === 'system_task' || entry === 'breakthrough')
      ? 'none'
      : entry,
    focus,
    knownPlot: entry === 'book_transmigration' || raw.knownPlot === true,
  };
}

export function normalizeNovelInspirations(value: unknown): NovelInspiration[] {
  const root = asRecord(value);
  const rawIdeas = Array.isArray(value)
    ? value
    : Array.isArray(root.ideas)
      ? root.ideas
      : [];

  return rawIdeas
    .map((item, index) => {
      const raw = asRecord(item);
      return {
        id: `inspiration-${index}-${asString(raw.title).slice(0, 16)}`,
        title: asString(raw.title).trim(),
        hook: asString(raw.hook).trim(),
        world: asString(raw.world).trim(),
        protagonist: asString(raw.protagonist).trim(),
        conflict: asString(raw.conflict).trim(),
        direction: asString(raw.direction).trim(),
        profile: normalizeProfile(raw.profile, index),
      };
    })
    .filter((idea) => idea.title && idea.hook && idea.conflict)
    .slice(0, 3);
}

function extractJson(content: string): unknown {
  return tryParseAiJson(content) ?? null;
}

export async function generateNovelInspirations({
  apiSettings,
  seed,
  maxTokens = 1600,
}: {
  apiSettings: ApiSettings;
  seed?: string;
  maxTokens?: number;
}): Promise<NovelInspiration[]> {
  const result = await requestCompletionWithUsage({ responseFormat: 'json', validateJson: (value) => normalizeNovelInspirations(value).length > 0,
    apiSettings: { ...apiSettings, streamingEnabled: false, thinkingDisabled: true },
    purpose: 'create-inspiration',
    maxTokens: Math.max(900, Math.min(Math.round(maxTokens), 2600)),
    temperature: Math.max(0.85, Math.min(apiSettings.temperature, 1.05)),
    messages: [
      {
        role: 'system',
        content: `你是小说创意编辑。请生成 3 个真正有可写性的中文小说灵感，不写正文。

三个方案必须在核心矛盾、主角欲望、叙事驱动力和情绪体验上明显不同，禁止只替换人名或时代。避免“神秘组织、命运齿轮、意外获得系统”这类空洞套话；每个方案都要有一个具体、能立刻开篇的反常点。

只返回 JSON：
{"ideas":[{"title":"简洁有辨识度的书名","hook":"一句话卖点","world":"时代、地点与关键规则","protagonist":"主角身份、欲望与软肋","conflict":"持续推动故事的矛盾与失败代价","direction":"开篇场景、阶段发展和结局倾向","profile":{"structure":"single_world|multi_world","entry":"none|system_task|breakthrough|book_transmigration","focus":"power|relationship|mystery|mixed","knownPlot":false}}]}

每个文本字段控制在 80 字以内。用户给出的元素是偏好，不是必须生硬塞满的清单。`,
      },
      {
        role: 'user',
        content: seed?.trim()
          ? `我想从这些元素出发：${seed.trim()}`
          : '我目前完全没有想法。请给我三个风格和驱动力都不同、但能持续展开的故事种子。',
      },
    ],
  });

  const ideas = normalizeNovelInspirations(extractJson(result.content));
  if (ideas.length < 3) {
    throw new Error('这批灵感不完整，请换一批重试。');
  }
  return ideas;
}
