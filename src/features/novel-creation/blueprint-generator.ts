import { requestCompletionWithUsage } from '../../services/llm';
import type { ApiSettings } from '../../types/tavern';
import { asRecord, asString } from '../../utils/helpers';

import type { StoryBlueprint } from './domain';

function uniqueNonEmpty(values: string[]) {
  return new Set(values.map((item) => item.trim().toLocaleLowerCase()).filter(Boolean));
}

function hasNovelScaleCapacity(blueprint: StoryBlueprint) {
  const engine = blueprint.longForm.engine.replace(/\s+/g, '');
  const arcs = blueprint.longForm.arcs.map((item) => item.replace(/\s+/g, '')).filter(Boolean);
  const threads = blueprint.longForm.openThreads.map((item) => item.replace(/\s+/g, '')).filter(Boolean);
  return engine.length >= 24
    && arcs.length >= 3
    && uniqueNonEmpty(arcs).size >= 3
    && arcs.join('').length >= 30
    && threads.length >= 3
    && uniqueNonEmpty(threads).size >= 3
    && threads.join('').length >= 18;
}

function parseJson(content: string): unknown {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next bounded JSON candidate.
    }
  }
  throw new Error('AI 返回的故事方案无法解析，请重试。');
}

export function normalizeBlueprintProposals(value: unknown): StoryBlueprint[] {
  const root = asRecord(value);
  const rows = Array.isArray(root.blueprints) ? root.blueprints : [];
  return rows.map((item, index) => {
    const raw = asRecord(item);
    const protagonist = asRecord(raw.protagonist);
    const longForm = asRecord(raw.longForm);
    const constraints = Array.isArray(raw.constraints)
      ? raw.constraints.map(asString).map((text) => text.trim()).filter(Boolean)
      : [];
    const arcs = Array.isArray(longForm.arcs)
      ? longForm.arcs.map(asString).map((text) => text.trim()).filter(Boolean)
      : [];
    const openThreads = Array.isArray(longForm.openThreads)
      ? longForm.openThreads.map(asString).map((text) => text.trim()).filter(Boolean)
      : [];
    return {
      id: `blueprint-${Date.now()}-${index}`,
      title: asString(raw.title).trim(),
      premise: asString(raw.premise).trim(),
      protagonist: {
        identity: asString(protagonist.identity).trim(),
        desire: asString(protagonist.desire).trim(),
        obstacle: asString(protagonist.obstacle).trim(),
      },
      setting: asString(raw.setting).trim(),
      stakes: asString(raw.stakes).trim(),
      opening: asString(raw.opening).trim(),
      direction: asString(raw.direction).trim(),
      tone: asString(raw.tone).trim(),
      constraints,
      longForm: {
        engine: asString(longForm.engine).trim(),
        arcs,
        openThreads,
      },
    };
  }).filter((blueprint) => (
    blueprint.title
    && blueprint.premise
    && blueprint.protagonist.desire
    && blueprint.protagonist.obstacle
    && blueprint.opening
    && hasNovelScaleCapacity(blueprint)
  )).slice(0, 3);
}

export function buildBlueprintSystemPrompt() {
  return `你是长篇小说立项总编。根据作者的一句话想法生成 3 份可以支撑 80–200 章、20 万字以上正文的故事蓝图，不写正文，也不要把短篇梗扩写成虚假的长篇。

【长篇合格标准】
1. 必须有可再生的故事引擎：它能持续制造新的选择、关系变化、代价和更高层阻力，而不是解决一次事件就结束。
2. 必须规划 3–5 个卷级阶段。每个阶段都要改变局势、升级矛盾并产生不可逆转折，不能只是重复同一种任务。
3. 必须保留至少 3 条发展速度不同的长期悬念、副线或关系线；它们应在不同阶段交叉和回收。
4. 开篇钩子只能启动故事，不能提前消耗终局谜底。核心冲突在第一阶段结束后仍须产生新的层级。
5. 三份方案必须有明显不同的主角欲望、核心阻力、长篇引擎和情绪体验，不能只替换姓名或时代。
6. 避免空洞的“神秘组织”“命运齿轮”和没有代价的万能系统。每个扩展点必须来自人物选择、世界规则或利益冲突。

只输出合法 JSON：
{"blueprints":[{"title":"书名","premise":"一句话故事前提","protagonist":{"identity":"故事层面的身份","desire":"持续推动行动的欲望","obstacle":"内外部核心阻力"},"setting":"时代、地点与关键世界规则","stakes":"失败会失去什么","opening":"第一章的具体起点与章末钩子","direction":"中长期发展与可选结局倾向","tone":"叙事气质与阅读体验","constraints":["必须遵守的创作约束"],"longForm":{"engine":"为什么解决一个问题后还会自然产生更大的问题；说明资源、关系、身份或规则如何持续变化","arcs":["第一阶段：目标、矛盾升级与不可逆转折","第二阶段：目标、矛盾升级与不可逆转折","第三阶段：目标、矛盾升级与不可逆转折"],"openThreads":["长期悬念或副线 1","长期悬念或副线 2","长期悬念或副线 3"]}}]}

title、premise、opening 等摘要字段控制在 120 字以内；longForm 必须具体完整，不能用“逐步升级”“经历冒险”“最终揭晓真相”等空话代替。`;
}

export async function generateBlueprintProposals({
  apiSettings,
  seed,
  maxTokens,
}: {
  apiSettings: ApiSettings;
  seed: string;
  maxTokens: number;
}): Promise<StoryBlueprint[]> {
  const baseMessages = [
    { role: 'system' as const, content: buildBlueprintSystemPrompt() },
    {
      role: 'user' as const,
      content: seed.trim()
        ? `作者的起点：${seed.trim()}`
        : '作者目前完全没有想法。请提供三份类型、情绪和叙事驱动力都不同的原创故事蓝图。',
    },
  ];
  const settings = {
    apiSettings: { ...apiSettings, streamingEnabled: false, thinkingDisabled: true },
    purpose: 'create-blueprint',
    maxTokens: Math.max(1800, Math.min(Math.round(maxTokens), 4200)),
    temperature: Math.max(0.8, Math.min(apiSettings.temperature, 1.05)),
  };
  const first = await requestCompletionWithUsage({ ...settings, messages: baseMessages });
  let proposals = normalizeBlueprintProposals(parseJson(first.content));
  if (proposals.length >= 3) return proposals;

  const repaired = await requestCompletionWithUsage({
    ...settings,
    temperature: Math.min(settings.temperature, 0.75),
    messages: [
      ...baseMessages,
      { role: 'assistant', content: first.content },
      {
        role: 'user',
        content: '上次方案未达到长篇承载标准。请重新完整输出 3 份蓝图：每份都要有具体的可再生故事引擎、至少 3 个内容不同且足够具体的卷级阶段、至少 3 条独立长期线索。不要解释，只输出完整 JSON。',
      },
    ],
  });
  proposals = normalizeBlueprintProposals(parseJson(repaired.content));
  if (proposals.length < 3) throw new Error('模型没有生成足够完整的长篇方案，请补充题材或人物方向后重试。');
  return proposals;
}
