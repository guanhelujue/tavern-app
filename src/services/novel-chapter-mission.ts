import type {
  NovelChapterMission,
  NovelCharacterRedLine,
  NovelHookTask,
  NovelMissionVerification,
  NovelMissionFeasibility,
  NovelStoryAnalysis,
  NovelStoryFactProjection,
} from '@/types/tavern';
import type { StoryAnalysisDelta } from '@/services/novel-story-state';

function parse(value: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(value);
    return result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};
  } catch { return {}; }
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function dueChapter(hook: Record<string, unknown>) {
  if (typeof hook.dueAfterChapter === 'number') return hook.dueAfterChapter;
  const start = Number(hook.startChapter ?? 0);
  const window = hook.importance === 'core' ? 40 : hook.importance === 'major' ? 20 : 10;
  return start + window;
}

export function buildChapterMission(input: {
  novelId: string;
  chapterIndex: number;
  canonRevision: number;
  goal: string;
  sceneHint: string;
  userInstruction: string;
  analysis: NovelStoryAnalysis | null;
  storyFacts: NovelStoryFactProjection[];
  now: string;
  budgetTokens?: number;
}) {
  const active = input.storyFacts.filter((fact) => !fact.stale);
  const characterFacts = active.filter((fact) => fact.factType === 'character').map((fact) => ({ fact, value: parse(fact.contentJson) }));
  const stateFacts = active.filter((fact) => fact.factType === 'character-state').map((fact) => ({ fact, value: parse(fact.contentJson) }));
  const haystack = `${input.goal}\n${input.sceneHint}\n${input.userInstruction}`.toLocaleLowerCase();
  const mustAppear = characterFacts
    .filter(({ fact, value }) => {
      const name = String(value.name ?? fact.subjectId ?? '').toLocaleLowerCase();
      const aliases = strings(value.aliases).map((item) => item.toLocaleLowerCase());
      return Boolean(name && haystack.includes(name)) || aliases.some((alias) => haystack.includes(alias));
    })
    .map(({ fact, value }) => String(value.id ?? fact.subjectId ?? fact.id))
    .slice(0, 6);

  const hookValues = active.filter((fact) => fact.factType === 'hook').map((fact) => ({ fact, value: parse(fact.contentJson) }));
  const dueHooks = hookValues
    .filter(({ value }) => value.status !== 'resolved' && dueChapter(value) <= input.chapterIndex)
    .sort((a, b) => dueChapter(a.value) - dueChapter(b.value))
    .slice(0, 3);
  const hookTasks: NovelHookTask[] = dueHooks.map(({ fact, value }) => ({
    hookId: String(value.id ?? fact.subjectId ?? fact.id),
    keyword: String(value.keyword ?? fact.subjectId ?? ''),
    instruction: value.expectedPayoff ? 'advance' : 'mention',
    overdueBy: Math.max(0, input.chapterIndex - dueChapter(value)),
    dependsOn: strings(value.dependsOn),
    expectedPayoff: String(value.expectedPayoff ?? ''),
  }));
  const threadIds = (input.analysis?.plotThreads ?? [])
    .filter((thread) => !thread.stale && (thread.kind === 'main' || haystack.includes(thread.title.toLocaleLowerCase())))
    .slice(0, 2)
    .map((thread) => thread.id);
  const mission: NovelChapterMission = {
    missionId: `${input.novelId}:mission:${input.chapterIndex}:${input.canonRevision}:${Date.parse(input.now) || 0}`,
    novelId: input.novelId,
    chapterIndex: input.chapterIndex,
    canonRevision: input.canonRevision,
    goal: input.goal || input.userInstruction || '承接上一章并推进当前情节',
    mustAdvanceThreadIds: threadIds,
    mustAdvanceHookIds: hookTasks.map((task) => task.hookId),
    mustPlantHookCount: 0,
    mustAppearCharacterIds: mustAppear,
    status: 'planned',
    createdAt: input.now,
  };
  const redLines: NovelCharacterRedLine[] = mustAppear.map((characterId) => {
    const character = characterFacts.find(({ fact, value }) => String(value.id ?? fact.subjectId ?? fact.id) === characterId);
    const state = stateFacts.find(({ fact, value }) => String(value.characterId ?? fact.subjectId ?? fact.id) === characterId);
    return {
      characterId,
      name: String(character?.value.name ?? characterId),
      immutable: [character?.value.appearance, character?.value.personality, character?.value.speechStyle, character?.value.background, character?.value.affiliation]
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim())),
      currentState: String(state?.value.currentState ?? ''),
      knows: strings(state?.value.knows),
      unknown: strings(state?.value.unknown),
      sourceEventIds: [character?.fact.sourceEventId, state?.fact.sourceEventId].filter((item): item is string => Boolean(item)),
    };
  });
  const conflicts: string[] = [];
  for (const card of redLines) {
    const overlap = card.knows.filter((item) => card.unknown.includes(item));
    if (overlap.length) conflicts.push(`${card.name} 同时知道和不知道：${overlap.join('、')}`);
  }
  for (const task of hookTasks) {
    if (task.dependsOn.includes(task.hookId)) conflicts.push(`伏笔 ${task.hookId} 依赖自身`);
  }
  const budgetTokens = Math.max(256, input.budgetTokens ?? 4096);
  const estimatedHardConstraintTokens = Math.ceil(
    JSON.stringify({ mission, redLines, hookTasks }).length / 2,
  );
  if (estimatedHardConstraintTokens > Math.floor(budgetTokens * 0.35)) {
    conflicts.push(
      `硬约束预计 ${estimatedHardConstraintTokens} tokens，超过任务预算上限 ${Math.floor(budgetTokens * 0.35)}`,
    );
  }
  const feasibility: NovelMissionFeasibility = {
    feasible: conflicts.length === 0,
    budgetTokens,
    estimatedHardConstraintTokens,
    conflicts,
    checkedAt: input.now,
  };
  return { mission, redLines, hookTasks, feasibility };
}

export function verifyChapterMission(input: {
  mission: NovelChapterMission;
  redLines: NovelCharacterRedLine[];
  content: string;
  delta: StoryAnalysisDelta;
  now: string;
}): NovelMissionVerification {
  const missingCharacterIds = input.mission.mustAppearCharacterIds.filter((id) => {
    const card = input.redLines.find((item) => item.characterId === id);
    return !card || !input.content.includes(card.name);
  });
  const advancedHooks = new Set(input.delta.hooks.filter((hook) => hook.status !== 'open').map((hook) => hook.id));
  const advancedThreads = new Set(input.delta.plotThreads.map((thread) => thread.id));
  const missingHookIds = input.mission.mustAdvanceHookIds.filter((id) => !advancedHooks.has(id));
  const missingThreadIds = input.mission.mustAdvanceThreadIds.filter((id) => !advancedThreads.has(id));
  const warnings = [
    ...missingCharacterIds.map((id) => `必须出场人物未检测到：${id}`),
    ...missingHookIds.map((id) => `伏笔未报告语义推进：${id}`),
    ...missingThreadIds.map((id) => `剧情线未报告推进：${id}`),
  ];
  return {
    missionId: input.mission.missionId,
    passed: warnings.length === 0,
    missingCharacterIds, missingHookIds, missingThreadIds, warnings, verifiedAt: input.now,
  };
}
