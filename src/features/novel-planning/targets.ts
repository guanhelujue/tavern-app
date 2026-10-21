import type { Novel, NovelLoreEntry, NovelOutline, NovelVolumePlan } from '@/types/tavern';
import type { WorldPack } from '@/types/quick-travel';
import { useTavernStore } from '@/store/tavern-store';
import { ensureQuickTravelArchive } from '@/utils/quick-travel';
import { ensureNovelLoreCollections, ensureNovelLoreEntries, getNovelLoreCollections, resolveLoreCollectionId } from '@/utils/novel-lore';
import { SYSTEM_NOVEL_LORE_COLLECTIONS } from '@/constants/novel-lore';

export type PlanningTargetKind = 'creation' | 'world' | 'lore' | 'volume';

export type PlanningTargetParams = {
  kind?: PlanningTargetKind | string;
  novelId?: string;
  worldId?: string;
  volumeId?: string;
  collectionId?: string;
  entryId?: string;
  draftId?: string;
};

export type PlanningTarget = {
  scope: { kind: PlanningTargetKind; id: string };
  title: string;
  context: string;
  seed: string;
  targetInstructions: string;
  fields: { key: string; label: string }[];
  apply(content: Record<string, unknown>): Promise<void> | void;
};

const mainWorldFields = [
  { key: 'worldName', label: '世界名称' },
  { key: 'worldEra', label: '时代与背景' },
  { key: 'gameRules', label: '世界规则' },
];
const quickWorldFields = [
  { key: 'name', label: '世界名称' },
  { key: 'generationBrief', label: '创作梗概' },
  { key: 'worldEra', label: '时代与背景' },
  { key: 'worldRules', label: '世界规则' },
  { key: 'protagonistIdentity', label: '主角身份' },
  { key: 'entryScene', label: '进入场景' },
  { key: 'mission', label: '世界任务' },
  { key: 'premise', label: '原定剧情' },
  { key: 'knownToProtagonist', label: '主角已知剧情' },
  { key: 'originalEnding', label: '原定结局' },
];
const loreFields = [
  { key: 'name', label: '设定名称' },
  { key: 'aliases', label: '别名（每行一个）' },
  { key: 'content', label: '设定内容' },
];
const volumeFields = [
  { key: 'title', label: '卷名' },
  { key: 'summary', label: '卷概述' },
  { key: 'incomingHandoff', label: '上一卷交接' },
];

function stringFields(content: Record<string, unknown>, fields: { key: string; label: string }[]) {
  if (Object.keys(content).some((key) => !fields.some((field) => field.key === key))) throw new Error('规划内容包含未知字段，请重新生成。');
  const result: Record<string, string> = {};
  for (const field of fields) {
    if (typeof content[field.key] !== 'string') throw new Error('规划字段不完整，请重新生成。');
    result[field.key] = (content[field.key] as string).trim();
  }
  return result;
}

function findNovel(novelId?: string): Novel {
  if (!novelId) throw new Error('缺少小说标识。');
  const novel = useTavernStore.getState().novels.find((item) => item.id === novelId);
  if (!novel) throw new Error('找不到小说。');
  return novel;
}

function sameFields(current: Record<string, unknown>, baseline: Record<string, string>, fields: { key: string }[]) {
  return fields.every(({ key }) => String(current[key] ?? '') === baseline[key]);
}

function instructions(fields: { key: string; label: string }[], subject: string) {
  return `将已确定的${subject}转换为一个 JSON 对象，只允许以下字符串字段：${fields.map(({ key, label }) => `${key}（${label}）`).join('、')}。未确定内容留空，不新增事实；多条内容使用换行符分隔。`;
}

function worldTarget(params: PlanningTargetParams, novel: Novel): PlanningTarget {
  const archive = ensureQuickTravelArchive(novel);
  const world = params.worldId ? archive.worlds.find((item) => item.id === params.worldId) : undefined;
  if (params.worldId && !world) throw new Error('找不到指定的小世界。');
  const isQuick = Boolean(world && !world.isMainWorld);
  const fields = isQuick ? quickWorldFields : mainWorldFields;
  const baseline: Record<string, string> = isQuick
    ? quickWorldValues(world!)
    : { worldName: novel.worldName, worldEra: novel.worldEra, gameRules: novel.gameRules };
  const seed = fields.map(({ key, label }) => `${label}：${baseline[key]}`).join('\n');
  const scopeId = isQuick ? `${novel.id}:world:${world!.id}` : `${novel.id}:world`;
  return {
    scope: { kind: 'world', id: scopeId },
    title: isQuick ? `小世界：${world!.name}` : `世界总览：${novel.name}`,
    context: isQuick
      ? `小说：${novel.name}\n跨世界规则：${archive.config.globalRules}\n只规划当前小世界；具体世界事实以当前构想为准。`
      : `小说：${novel.name}\n正在规划全书世界，世界事实以当前构想为准。`,
    seed,
    targetInstructions: instructions(fields, isQuick ? '小世界设定' : '全书世界设定'),
    fields,
    async apply(content) {
      const value = stringFields(content, fields);
      const latest = findNovel(novel.id);
      const latestArchive = ensureQuickTravelArchive(latest);
      const latestWorld = isQuick ? latestArchive.worlds.find((item) => item.id === world!.id) : undefined;
      if (isQuick && !latestWorld) throw new Error('目标小世界已被删除，请返回规划页重新选择。');
      const latestValues = isQuick ? quickWorldValues(latestWorld!) : { worldName: latest.worldName, worldEra: latest.worldEra, gameRules: latest.gameRules };
      if (!sameFields(latestValues, baseline, fields)) throw new Error('目标设定已发生变化，请返回规划页重新载入。');
      if (isQuick) {
        useTavernStore.getState().updateNovel(latest.id, {
          quickTravel: { ...latestArchive, worlds: latestArchive.worlds.map((item) => item.id === world!.id ? applyQuickWorld(item, value) : item) },
        });
      } else {
        useTavernStore.getState().updateNovel(latest.id, { worldName: value.worldName, worldEra: value.worldEra, gameRules: value.gameRules });
      }
    },
  };
}

function quickWorldValues(world: WorldPack): Record<string, string> {
  return { name: world.name, generationBrief: world.generationBrief ?? '', worldEra: world.worldEra, worldRules: world.worldRules, protagonistIdentity: world.protagonistIdentity, entryScene: world.entryScene, mission: world.mission, premise: world.originalPlot.premise, knownToProtagonist: world.originalPlot.knownToProtagonist, originalEnding: world.originalPlot.originalEnding };
}

function applyQuickWorld(world: WorldPack, value: Record<string, string>): WorldPack {
  return { ...world, name: value.name, generationBrief: value.generationBrief, worldEra: value.worldEra, worldRules: value.worldRules, protagonistIdentity: value.protagonistIdentity, entryScene: value.entryScene, mission: value.mission, originalPlot: { ...world.originalPlot, premise: value.premise, knownToProtagonist: value.knownToProtagonist, originalEnding: value.originalEnding }, updatedAt: new Date().toISOString() };
}

function loreTarget(params: PlanningTargetParams, novel: Novel): PlanningTarget {
  const entries = ensureNovelLoreEntries(novel);
  const collections = getNovelLoreCollections(ensureNovelLoreCollections(novel.loreCollections));
  const entry = entries.find((item) => item.id === (params.entryId ?? params.draftId));
  if (params.entryId && !entry) throw new Error('找不到指定的设定条目。');
  const collectionId = entry ? resolveLoreCollectionId(entry, collections) : params.collectionId;
  if (!collectionId || !collections.some((item) => item.id === collectionId)) throw new Error('缺少有效的设定分卷。');
  const baseline = entry ? { name: entry.name, aliases: entry.aliases.join('\n'), content: entry.content } : { name: '', aliases: '', content: '' };
  const id = entry?.id ?? params.draftId ?? `planning-lore-${novel.id}-${collectionId}`;
  return { scope: { kind: 'lore', id: `${novel.id}:lore:${id}` }, title: entry ? `设定：${entry.name}` : `新建设定：${collections.find((item) => item.id === collectionId)?.name ?? ''}`, context: `小说：${novel.name}\n世界：${novel.worldName}\n时代与规则：${novel.worldEra}\n${novel.gameRules}\n所属分卷：${collections.find((item) => item.id === collectionId)?.name ?? ''}`, seed: `名称：${baseline.name}\n别名：${baseline.aliases}\n内容：${baseline.content}`, targetInstructions: instructions(loreFields, '世界设定条目'), fields: loreFields, async apply(content) {
    const value = stringFields(content, loreFields);
    const latest = findNovel(novel.id);
    const latestEntries = ensureNovelLoreEntries(latest);
    const current = latestEntries.find((item) => item.id === entry?.id || item.id === id);
    if (entry && (!current || !sameFields({ name: current.name, aliases: current.aliases.join('\n'), content: current.content }, baseline, loreFields))) throw new Error('设定条目已发生变化，请返回规划页重新载入。');
    if (!entry && current && !sameFields({ name: current.name, aliases: current.aliases.join('\n'), content: current.content }, value, loreFields)) throw new Error('新建设定已发生变化，请返回规划页重新载入。');
    const next: NovelLoreEntry = current ? { ...current, name: value.name, aliases: value.aliases.split('\n').map((item) => item.trim()).filter(Boolean), content: value.content, updatedAt: new Date().toISOString() } : { id, type: collections.find((item) => item.id === collectionId)?.defaultType ?? 'lore', collectionId: collectionId === SYSTEM_NOVEL_LORE_COLLECTIONS[0].id ? undefined : collectionId, name: value.name, aliases: value.aliases.split('\n').map((item) => item.trim()).filter(Boolean), content: value.content, enabled: true, updatedAt: new Date().toISOString() };
    useTavernStore.getState().updateNovelLoreEntries(latest.id, current ? latestEntries.map((item) => item.id === current.id ? next : item) : [...latestEntries, next]);
  } };
}

function volumeTarget(params: PlanningTargetParams, novel: Novel): PlanningTarget {
  const archive = ensureQuickTravelArchive(novel);
  const world = params.worldId ? archive.worlds.find((item) => item.id === params.worldId) : undefined;
  if (params.worldId && !world) throw new Error('找不到指定的小世界。');
  const outline = world && !world.isMainWorld ? world.outline : novel.outline;
  const volume = outline?.volumes.find((item) => item.id === params.volumeId);
  if (!volume || !outline) throw new Error('找不到指定的卷。');
  const baseline = { title: volume.title, summary: volume.summary, incomingHandoff: volume.handoff?.incoming ?? '' };
  const scopeKey = world && !world.isMainWorld ? world.id : 'novel';
  return { scope: { kind: 'volume', id: `${novel.id}:${scopeKey}:volume:${volume.id}` }, title: `卷设定：${volume.title}`, context: `小说：${novel.name}\n${world ? `世界：${world.name}\n规则：${world.worldRules}\n` : `世界规则：${novel.gameRules}\n`}全书方向：${outline.summary}\n上一卷交接：${outline.volumes[outline.volumes.findIndex((item) => item.id === volume.id) - 1]?.handoff?.outgoing ?? ''}`, seed: `卷名：${baseline.title}\n卷概述：${baseline.summary}\n上一卷交接：${baseline.incomingHandoff}`, targetInstructions: instructions(volumeFields, '卷设定'), fields: volumeFields, apply(content) {
    const value = stringFields(content, volumeFields);
    const latest = findNovel(novel.id);
    const latestArchive = ensureQuickTravelArchive(latest);
    const latestWorld = world && !world.isMainWorld ? latestArchive.worlds.find((item) => item.id === world.id) : undefined;
    if (world && !world.isMainWorld && !latestWorld) throw new Error('目标小世界已被删除，请返回规划页重新选择。');
    const latestOutline = world && !world.isMainWorld ? latestWorld?.outline : latest.outline;
    const latestVolume = latestOutline?.volumes.find((item) => item.id === volume.id);
    if (!latestOutline || !latestVolume || !sameFields({ title: latestVolume.title, summary: latestVolume.summary, incomingHandoff: latestVolume.handoff?.incoming ?? '' }, baseline, volumeFields)) throw new Error('卷设定已发生变化，请返回规划页重新载入。');
    const nextVolume: NovelVolumePlan = { ...latestVolume, title: value.title, summary: value.summary, handoff: { ...(latestVolume.handoff ?? {}), incoming: value.incomingHandoff } };
    const nextOutline: NovelOutline = { ...latestOutline, volumes: latestOutline.volumes.map((item) => item.id === volume.id ? nextVolume : item), updatedAt: new Date().toISOString() };
    useTavernStore.getState().saveNovelOutlineAtScope(latest.id, latestWorld && !latestWorld.isMainWorld ? latestWorld.id : 'novel', nextOutline, '规划台应用卷设定');
  } };
}

export function resolvePlanningTarget(params: PlanningTargetParams): PlanningTarget {
  const novel = findNovel(params.novelId);
  if (params.kind === 'world') return worldTarget(params, novel);
  if (params.kind === 'lore') return loreTarget(params, novel);
  if (params.kind === 'volume') return volumeTarget(params, novel);
  throw new Error('缺少有效的规划目标类型。');
}
