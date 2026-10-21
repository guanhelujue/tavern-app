import { asyncStorageCreationDrafts } from '../novel-creation/draft-repository';
import { createEmptyBlueprint, type CreationSession } from '../novel-creation/domain';
import { compileStoryFoundation } from '../novel-creation/blueprint-compiler';
import type { PlanningTarget } from './targets';

const fields = [
  { key: 'title', label: '书名' }, { key: 'premise', label: '故事前提' },
  { key: 'identity', label: '主角身份' }, { key: 'desire', label: '主角欲望' },
  { key: 'obstacle', label: '核心阻力' }, { key: 'setting', label: '世界与关键规则' },
  { key: 'stakes', label: '失败代价' }, { key: 'opening', label: '开篇场景' },
  { key: 'direction', label: '长期方向' }, { key: 'tone', label: '叙事气质' },
  { key: 'constraints', label: '作者约束（每行一条）' },
  { key: 'engine', label: '长篇故事引擎' }, { key: 'arcs', label: '阶段推进（每行一条）' },
  { key: 'openThreads', label: '长期悬念（每行一条）' },
];

export function validateCreationFields(content: Record<string, unknown>): Record<string, string> {
  if (Object.keys(content).some((key) => !fields.some((field) => field.key === key))) throw new Error('蓝图包含未知字段，请重新生成。');
  const result: Record<string, string> = {};
  for (const { key } of fields) {
    if (typeof content[key] !== 'string') throw new Error('蓝图字段不完整，请重新生成。');
    result[key] = content[key].trim();
  }
  return result;
}

export function applyCreationPlanningFields(base: CreationSession, content: Record<string, unknown>): CreationSession {
  const value = validateCreationFields(content);
  const lines = (key: string) => value[key].split('\n').map((line) => line.trim()).filter(Boolean);
  return {
    ...base, step: 'blueprint', error: undefined, updatedAt: new Date().toISOString(),
    blueprint: {
      ...createEmptyBlueprint(), id: base.blueprint?.id ?? `planning-${base.id}`,
      title: value.title, premise: value.premise,
      protagonist: { identity: value.identity, desire: value.desire, obstacle: value.obstacle },
      setting: value.setting, stakes: value.stakes, opening: value.opening,
      direction: value.direction, tone: value.tone, constraints: lines('constraints'),
      longForm: { engine: value.engine, arcs: lines('arcs'), openThreads: lines('openThreads') },
    },
  };
}

export async function resolveCreationPlanningTarget(creationId: string): Promise<PlanningTarget> {
  let base = await asyncStorageCreationDrafts.load();
  if (!base || base.id !== creationId) throw new Error('创建草稿已更换，请从创建页重新进入。');
  return {
    scope: { kind: 'creation', id: creationId }, title: '故事构想', context: '',
    seed: base.blueprint ? `书名：${base.blueprint.title}\n${compileStoryFoundation(base.blueprint)}` : base.seed,
    fields,
    targetInstructions: `将已确定构想转换成一份故事蓝图。只输出一个 JSON 对象，包含以下字符串字段：${fields.map(({ key, label }) => `${key}（${label}）`).join('、')}。多条内容使用换行符分隔。未确定的字段填空字符串，不强行凑足阶段或悬念数量，不新增人名或情节。setting 仅写世界规则，arcs 写卷级阶段，opening 写开篇。`,
    async apply(content) {
      const latest = await asyncStorageCreationDrafts.load();
      if (JSON.stringify(latest) !== JSON.stringify(base)) throw new Error('创建草稿已发生变化，请返回创建页重新进入后再应用。');
      const next = applyCreationPlanningFields(base!, content);
      await asyncStorageCreationDrafts.save(next);
      base = next;
    },
  };
}
