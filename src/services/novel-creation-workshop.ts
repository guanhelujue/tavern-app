import { parseAiJson } from '@/utils/ai-json';
import { requestCompletionWithUsage } from '@/services/llm';
import type {
  ApiSettings,
  NovelCreationBlueprint,
  NovelNarrativeProfile,
  NovelNarrativeStructure,
  NovelProgressionFocus,
  NovelStoryKind,
  NovelWorldEntry,
} from '@/types/tavern';
import { asRecord, asString } from '@/utils/helpers';

export type NovelCreationWorkshopQuestionKey = 'world' | 'protagonist' | 'conflict' | 'direction';
export type NovelCreationWorkshopAnswers = Record<NovelCreationWorkshopQuestionKey, string>;

export const DEFAULT_NARRATIVE_PROFILE: NovelNarrativeProfile = {
  structure: 'single_world',
  entry: 'none',
  focus: 'mixed',
  knownPlot: false,
};

export type NarrativeProfileOption<T extends string> = {
  value: T;
  label: string;
  description: string;
};

export const NARRATIVE_STRUCTURE_OPTIONS: readonly NarrativeProfileOption<NovelNarrativeStructure>[] = [
  { value: 'single_world', label: '单世界主线', description: '故事在一个主要世界中持续推进，逐步积累人物与伏笔。' },
  { value: 'multi_world', label: '多世界单元', description: '由多个相对独立的世界/单元组成，同时保留跨单元主线。' },
];

export const NARRATIVE_ENTRY_OPTIONS: readonly NarrativeProfileOption<NovelWorldEntry>[] = [
  { value: 'none', label: '不切换世界', description: '不使用跨世界机制，直接在当前世界展开。' },
  { value: 'system_task', label: '系统任务', description: '由系统、契约或任务机制推动世界切换与结算。' },
  { value: 'breakthrough', label: '能力跨界', description: '主角通过能力、境界或空间规则进入新的世界。' },
  { value: 'book_transmigration', label: '原剧情进入', description: '主角进入已有故事/原剧情，并围绕已知轨迹产生偏差。' },
];

export const NARRATIVE_FOCUS_OPTIONS: readonly NarrativeProfileOption<NovelProgressionFocus>[] = [
  { value: 'power', label: '能力成长', description: '重点关注能力、资源、胜负、奖励与阶段性突破。' },
  { value: 'relationship', label: '关系推进', description: '重点关注人物关系、情感变化与阶段性回收。' },
  { value: 'mystery', label: '谜团反转', description: '重点关注线索、真相、原剧情偏差与反转。' },
  { value: 'mixed', label: '混合推进', description: '能力、关系和谜团按作品需要共同推进。' },
];

type WorkshopQuestion = {
  key: NovelCreationWorkshopQuestionKey;
  title: string;
  hint: string;
  placeholder: string;
};

function profileLabel(profile: NovelNarrativeProfile) {
  if (profile.structure === 'single_world') {
    if (profile.entry === 'book_transmigration' || profile.knownPlot) return '原剧情偏差';
    return '单世界主线';
  }
  if (profile.entry === 'book_transmigration' || profile.knownPlot) return '多世界原剧情偏差';
  if (profile.entry === 'breakthrough') return '多世界能力跨界';
  if (profile.focus === 'relationship') return '多世界关系推进';
  if (profile.focus === 'power') return '多世界能力成长';
  return '多世界单元';
}

function profileFocus(profile: NovelNarrativeProfile) {
  const focus = {
    power: '能力、资源、胜负、奖励与阶段性突破',
    relationship: '人物关系、情感变化、关系目标与阶段性回收',
    mystery: '线索、真相、原剧情偏差与反转',
    mixed: '能力、关系与谜团之间的平衡推进',
  }[profile.focus];
  const structure = profile.structure === 'multi_world'
    ? '多个相对独立的世界/单元与一条跨单元主线'
    : '一个主要世界中的连续主线';
  const entry = {
    none: '不依赖世界切换机制',
    system_task: '由系统/契约/任务推动世界切换与结算',
    breakthrough: '由能力、境界或空间规则推动世界切换',
    book_transmigration: '进入已有原剧情并允许产生可追踪偏差',
  }[profile.entry];
  return `${structure}；${entry}；${focus}`;
}

function normalizeProfile(value: unknown, fallback = DEFAULT_NARRATIVE_PROFILE): NovelNarrativeProfile {
  const raw = asRecord(value);
  const structure = raw.structure === 'multi_world' || raw.structure === 'single_world'
    ? raw.structure
    : fallback.structure;
  const entry = raw.entry === 'system_task' || raw.entry === 'breakthrough' || raw.entry === 'book_transmigration' || raw.entry === 'none'
    ? raw.entry
    : fallback.entry;
  const focus = raw.focus === 'power' || raw.focus === 'relationship' || raw.focus === 'mystery' || raw.focus === 'mixed'
    ? raw.focus
    : fallback.focus;
  return {
    structure,
    entry,
    focus,
    knownPlot: entry === 'book_transmigration' || raw.knownPlot === true || (raw.knownPlot === undefined && fallback.knownPlot),
  };
}

/** Compatibility adapter for old workbench/story-kind data. */
export function profileFromLegacyStoryKind(kind: NovelStoryKind): NovelNarrativeProfile {
  if (kind === 'quicktravel') {
    return { structure: 'multi_world', entry: 'system_task', focus: 'mixed', knownPlot: false };
  }
  if (kind === 'wishful') {
    return { structure: 'single_world', entry: 'none', focus: 'power', knownPlot: false };
  }
  return { ...DEFAULT_NARRATIVE_PROFILE };
}

export function getNovelCreationWorkshopQuestions(profile = DEFAULT_NARRATIVE_PROFILE): readonly WorkshopQuestion[] {
  const worldQuestion = profile.entry === 'book_transmigration' || profile.knownPlot
    ? {
        title: '原剧情是什么，主角知道哪些内容？',
        hint: '说说原故事的基本轨迹、主角知道的关键节点，以及哪些地方允许被改变。',
        placeholder: '例如：主角进入一本结局注定失败的修仙文，只知道前三个关键节点，后续剧情会因选择而偏离。',
      }
    : profile.entry === 'breakthrough'
      ? {
          title: '世界之间如何连接，跨界要付出什么？',
          hint: '说明主角如何进入新世界、世界层级或能力规则，以及跨界的代价和限制。',
          placeholder: '例如：渡劫成功后可撕裂空间进入下界，但每次跨界都会损耗本源，必须在新世界寻找补偿。',
        }
      : profile.structure === 'multi_world'
        ? {
            title: '多个世界共用哪些底层规则？',
            hint: '说说世界切换方式、任务/结算、世界之间保持不变的主线规则。',
            placeholder: '例如：每个世界独立收束，完成目标后结算资源，所有世界都指向现实中的同一个谜团。',
          }
        : {
            title: '故事发生在什么样的世界？',
            hint: '说说时代、地点、社会结构、技术/魔法规则，以及整体氛围。',
            placeholder: '例如：近未来的潮湿海港城，记忆可以被交易，城市由几家企业控制。',
          };

  const protagonistQuestion = profile.entry === 'book_transmigration'
    ? {
        title: '主角进入原剧情后，最想改变什么？',
        hint: '只写故事层面的核心目标和长期愿望；具体姓名、性格和背景交给角色卡。',
        placeholder: '例如：主角想救下原书中必死的师姐，并查清自己为何会进入这本书。',
      }
    : profile.focus === 'relationship'
      ? {
          title: '主角要推动哪些关系，最终希望得到什么？',
          hint: '写关系目标、情感张力和长期回收；具体人物资料之后由角色卡维护。',
          placeholder: '例如：主角要修复与宿敌的信任，同时确认这段关系是否值得继续。',
        }
      : profile.focus === 'power'
        ? {
            title: '主角凭什么推进故事，长期想达成什么？',
            hint: '写能力/资源来源、成长方向和长期目标；具体人设之后由角色卡维护。',
            placeholder: '例如：主角掌握失传的空间术，想找回被夺走的本源并突破世界上限。',
          }
        : {
            title: '主角在故事中想改变什么？',
            hint: '只写故事层面的核心目标、长期愿望和不变的价值锚点；具体人设之后由角色卡维护。',
            placeholder: '例如：主角想查清妹妹失踪的真相，同时不再成为任人摆布的人。',
          };

  const conflictQuestion = profile.entry === 'book_transmigration' || profile.knownPlot
    ? {
        title: '原剧情、现实阻力和偏差代价是什么？',
        hint: '说明谁/什么在阻止主角、原剧情会怎样发展、改变它会付出什么代价。',
        placeholder: '例如：原书结局会导致宗门覆灭，主角每改变一个节点都会触发新的追杀与因果。',
      }
    : profile.focus === 'relationship'
      ? {
          title: '关系推进会遇到什么阻力和回收节点？',
          hint: '列出误会、立场、边界、关系升级或破裂的关键节点。',
          placeholder: '例如：两人被阵营立场隔开，每次共同解决危机都会改变彼此的信任程度。',
        }
      : profile.focus === 'power'
        ? {
            title: '成长、胜负和代价如何形成循环？',
            hint: '说明阻力、奖励、升级节奏与失败后果，不要只写“不断变强”。',
            placeholder: '例如：每次突破都要偿还一次因果债，胜利能得到资源，但会暴露更大的敌人。',
          }
        : {
            title: '核心冲突是什么，失败会付出什么？',
            hint: '谁或什么在阻止主角？失败代价是什么？有哪些必须保留的悬念？',
            placeholder: '例如：家族和警方都在压下调查，继续追查会暴露主角自己的秘密。',
          };

  const directionQuestion = profile.structure === 'multi_world'
    ? {
        title: '单元世界怎样收束，长期主线怎样累积？',
        hint: '写单元节奏、结算/离开方式、跨世界线索和最终方向。',
        placeholder: '例如：每个世界独立收束，结算时揭开一条现实线索，最终回到主世界完成闭环。',
      }
    : {
        title: '你希望故事怎样展开和收束？',
        hint: '可以写开篇场景、节奏、文风、篇幅和结局倾向；不确定的部分可以留白。',
        placeholder: '例如：从雨夜接到死者电话开始，节奏紧凑，最终公开真相但付出重要代价。',
      };

  return [
    { key: 'world', ...worldQuestion },
    { key: 'protagonist', ...protagonistQuestion },
    { key: 'conflict', ...conflictQuestion },
    { key: 'direction', ...directionQuestion },
  ];
}

export type NovelCreationWorkshopDraft = {
  profile: NovelNarrativeProfile;
  title: string;
  brief: string;
  premise: string;
  theme: string;
  ending: string;
  plannedChapters: number;
  firstChapterGoal: string;
  worldName: string;
  worldEra: string;
  gameRules: string;
  /** Explicit protagonist name carried from the author answers/model output. */
  protagonistName: string;
  /** Explicit protagonist gender carried from the author answers/model output. */
  protagonistGender: string;
  protagonistCoreIdentity: string;
  protagonistCoreGoal: string;
  runtimeSeed: NonNullable<NovelCreationBlueprint['runtimeSeed']>;
  foundationPrompt: string;
};

type WorkshopPayload = Partial<{
  title: unknown;
  brief: unknown;
  premise: unknown;
  theme: unknown;
  ending: unknown;
  plannedChapters: unknown;
  firstChapterGoal: unknown;
  worldName: unknown;
  worldEra: unknown;
  gameRules: unknown;
  profile: unknown;
  narrativeProfile: unknown;
  protagonistCore: unknown;
  runtimeSeed: unknown;
  foundationPrompt: unknown;
  // Compatibility with the previous workshop response shape.
  protagonistGoal: unknown;
  protagonistName: unknown;
  protagonistGender: unknown;
  protagonistPersonality: unknown;
  protagonistBackground: unknown;
  opposition: unknown;
  storyKind: unknown;
}>;

function chapterCountFromText(value: string): number | undefined {
  const match = value.match(/(\d{1,3})\s*(?:章|回|集)/);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(999, parsed)) : undefined;
}

function normalizeChapterCount(value: unknown, fallbackText: string): number {
  const numeric = typeof value === 'number' ? value : Number.parseInt(asString(value), 10);
  const fallback = chapterCountFromText(fallbackText) ?? 20;
  return Number.isFinite(numeric) ? Math.max(1, Math.min(999, Math.round(numeric))) : fallback;
}

/**
 * Recover a name only when the author text makes the protagonist boundary
 * explicit. This is a fallback for old/model responses that predate the
 * dedicated protagonistName field; it must never invent a name.
 */
function extractExplicitProtagonistName(value: string): string {
  const text = value.trim();
  if (!text) {
    return '';
  }

  const explicitPatterns = [
    /(?:^|[，,。；;\n])\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z·-]{0,11})\s*(?:是|为)\s*(?:本书的?|故事的?)?(?:主角|主人公)(?=[，,。；;\s]|$)/u,
    /(?:主角|女主角|男主角|主人公)\s*(?:姓名|名字)?\s*(?:是|叫|为|：|:)?\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z·-]{1,11})(?=\s*(?:想|要|希望|需要|必须|决定|试图|正在|的|[，,。；;：:、]|$))/u,
    /(?:主角|女主角|男主角|主人公)[^\n。！？]{0,24}?(?:姓名|名字)\s*(?:是|叫|为|：|:)\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z·-]{1,11})/u,
    /(?:^|[，,、；;。\n])[\u4e00-\u9fff]{0,8}([\u4e00-\u9fff]{2,4})(?=\s*(?:想|要|希望|需要|必须|决定|试图|正在))/u,
    /^([\u4e00-\u9fff]{2,4})(?=\s*[，,：:、])/u,
  ];

  for (const pattern of explicitPatterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim() ?? '';
    if (candidate) {
      return candidate;
    }
  }

  return '';
}

/** Recover gender only from an explicit author/model statement; never infer it from a name. */
function extractExplicitProtagonistGender(value: string): string {
  const text = value.trim();
  if (!text) {
    return '';
  }

  if (/(?:女主角|女性主角|女主|女性|女生|女人)/u.test(text)) {
    return '女';
  }
  if (/(?:男主角|男性主角|男主|男性|男生|男人)/u.test(text)) {
    return '男';
  }

  return '';
}

/** Map the workshop's stable protagonist anchor into the cast-card AI input. */
export function buildWorkshopProtagonistDefaults(
  draft: Pick<NovelCreationWorkshopDraft, 'protagonistName' | 'protagonistGender' | 'protagonistCoreIdentity' | 'protagonistCoreGoal'>,
) {
  const identity = draft.protagonistCoreIdentity.trim();
  const goal = draft.protagonistCoreGoal.trim();
  return {
    playerName: draft.protagonistName.trim(),
    playerGender: draft.protagonistGender.trim(),
    playerPersona: identity || goal,
    playerMotive: goal,
  };
}

function emptyRuntimeSeed(): NonNullable<NovelCreationBlueprint['runtimeSeed']> {
  return {
    systemName: '',
    globalRules: '',
    worldSeed: '',
    mission: '',
    entryScene: '',
    originalPlot: { premise: '', knownToProtagonist: '', originalEnding: '' },
  };
}

export function buildNovelFoundationPrompt(draft: Omit<NovelCreationWorkshopDraft, 'foundationPrompt'>) {
  const profile = profileLabel(draft.profile);
  const focus = profileFocus(draft.profile);
  const runtime = draft.runtimeSeed;
  const worldLines = [
    draft.worldName ? `世界名称：${draft.worldName}` : '',
    draft.worldEra,
    draft.profile.structure === 'multi_world' && runtime.worldSeed
      ? `首个世界种子：${runtime.worldSeed}`
      : '',
  ].filter(Boolean);
  const plotLines = [
    draft.premise ? `前提：${draft.premise}` : '',
    draft.profile.knownPlot && runtime.originalPlot.premise
      ? `原剧情基线：${runtime.originalPlot.premise}`
      : '',
  ].filter(Boolean);
  const directionLines = [
    draft.ending ? `结局倾向：${draft.ending}` : '',
    `规划篇幅：约 ${draft.plannedChapters} 章`,
    draft.firstChapterGoal ? `开篇目标：${draft.firstChapterGoal}` : '',
  ].filter(Boolean);

  return [
    `【叙事结构】\n${profile}`,
    `【作品定位】\n${draft.brief || '待定'}`,
    `【世界设定】\n${worldLines.join('\n') || '待定'}`,
    `【故事核心】\n${[
      draft.protagonistName ? `主角姓名：${draft.protagonistName}` : '',
      draft.protagonistGender ? `主角性别：${draft.protagonistGender}` : '',
      draft.protagonistCoreIdentity ? `主角核心锚点：${draft.protagonistCoreIdentity}` : '',
      draft.protagonistCoreGoal ? `长期目标：${draft.protagonistCoreGoal}` : '',
      plotLines.join('\n'),
    ].filter(Boolean).join('\n') || '待定'}`,
    `【叙事要求】\n${[
      `推进重点：${focus}`,
      draft.theme ? `主题：${draft.theme}` : '',
      draft.gameRules ? `稳定创作规则：${draft.gameRules}` : '',
      draft.profile.structure === 'multi_world' && runtime.globalRules
        ? `跨世界规则：${runtime.globalRules}`
        : '',
    ].filter(Boolean).join('\n')}`,
    `【开篇状态】\n${draft.firstChapterGoal || '待定'}`,
    `【长期方向】\n${directionLines.join('\n')}`,
  ].join('\n\n');
}

function fallbackDraft(
  answers: NovelCreationWorkshopAnswers,
  title: string,
  profile: NovelNarrativeProfile,
): NovelCreationWorkshopDraft {
  const world = answers.world.trim();
  const protagonist = answers.protagonist.trim();
  const conflict = answers.conflict.trim();
  const direction = answers.direction.trim();
  const runtimeSeed = emptyRuntimeSeed();
  runtimeSeed.worldSeed = world;
  runtimeSeed.mission = profile.structure === 'multi_world' ? conflict : '';
  if (profile.entry === 'system_task') runtimeSeed.globalRules = world;
  if (profile.knownPlot) runtimeSeed.originalPlot.premise = world;
  const draft: Omit<NovelCreationWorkshopDraft, 'foundationPrompt'> = {
    profile,
    title: title.trim(),
    brief: [world, protagonist, conflict].filter(Boolean).join('\n\n'),
    premise: conflict,
    theme: '',
    ending: direction,
    plannedChapters: chapterCountFromText(direction) ?? 20,
    firstChapterGoal: '',
    worldName: '',
    worldEra: world,
    gameRules: '',
    protagonistName: extractExplicitProtagonistName(protagonist),
    protagonistGender: extractExplicitProtagonistGender(protagonist),
    protagonistCoreIdentity: '',
    protagonistCoreGoal: protagonist,
    runtimeSeed,
  };
  return { ...draft, foundationPrompt: buildNovelFoundationPrompt(draft) };
}

function legacyProfileFromPayload(payload: WorkshopPayload, fallback: NovelNarrativeProfile) {
  const legacyKind = payload.storyKind === 'serialized' || payload.storyKind === 'wishful' || payload.storyKind === 'quicktravel'
    ? payload.storyKind
    : undefined;
  return legacyKind ? profileFromLegacyStoryKind(legacyKind) : fallback;
}

export function normalizeNovelCreationWorkshopDraft(
  value: unknown,
  answers: NovelCreationWorkshopAnswers,
  title: string,
  profileOrLegacyKind: NovelNarrativeProfile | NovelStoryKind = DEFAULT_NARRATIVE_PROFILE,
): NovelCreationWorkshopDraft {
  const payload = value && typeof value === 'object' && !Array.isArray(value) ? value as WorkshopPayload : {};
  const fallbackProfile = typeof profileOrLegacyKind === 'string'
    ? profileFromLegacyStoryKind(profileOrLegacyKind)
    : profileOrLegacyKind;
  // The profile selected by the author is authoritative. Only legacy callers
  // that pass a story-kind string may inherit a profile from model output.
  const selectedProfile = typeof profileOrLegacyKind === 'string'
    ? normalizeProfile(
        payload.narrativeProfile ?? payload.profile ?? legacyProfileFromPayload(payload, fallbackProfile),
        fallbackProfile,
      )
    : normalizeProfile(profileOrLegacyKind, DEFAULT_NARRATIVE_PROFILE);
  const fallback = fallbackDraft(answers, title, selectedProfile);
  const text = (key: keyof WorkshopPayload, fallbackValue: string) => asString(payload[key]) || fallbackValue;
  const protagonistCore = asRecord(payload.protagonistCore);
  const rawRuntime = asRecord(payload.runtimeSeed);
  const rawOriginalPlot = asRecord(rawRuntime.originalPlot);
  const runtimeSeed = {
    systemName: asString(rawRuntime.systemName) || fallback.runtimeSeed.systemName,
    globalRules: asString(rawRuntime.globalRules) || fallback.runtimeSeed.globalRules,
    worldSeed: asString(rawRuntime.worldSeed) || fallback.runtimeSeed.worldSeed,
    mission: asString(rawRuntime.mission) || fallback.runtimeSeed.mission,
    entryScene: asString(rawRuntime.entryScene) || fallback.runtimeSeed.entryScene,
    originalPlot: {
      premise: asString(rawOriginalPlot.premise) || fallback.runtimeSeed.originalPlot.premise,
      knownToProtagonist: asString(rawOriginalPlot.knownToProtagonist) || fallback.runtimeSeed.originalPlot.knownToProtagonist,
      originalEnding: asString(rawOriginalPlot.originalEnding) || fallback.runtimeSeed.originalPlot.originalEnding,
    },
  };
  const authorProtagonistName = extractExplicitProtagonistName(answers.protagonist);
  const authorProtagonistGender = extractExplicitProtagonistGender(answers.protagonist);
  const draft: Omit<NovelCreationWorkshopDraft, 'foundationPrompt'> = {
    profile: selectedProfile,
    title: text('title', fallback.title),
    brief: text('brief', fallback.brief),
    premise: text('premise', fallback.premise),
    theme: text('theme', fallback.theme),
    ending: text('ending', fallback.ending),
    plannedChapters: normalizeChapterCount(payload.plannedChapters, answers.direction),
    firstChapterGoal: text('firstChapterGoal', fallback.firstChapterGoal),
    worldName: text('worldName', fallback.worldName),
    worldEra: text('worldEra', fallback.worldEra),
    gameRules: text('gameRules', fallback.gameRules),
    protagonistName:
      authorProtagonistName ||
      asString(payload.protagonistName).trim() ||
      extractExplicitProtagonistName(asString(protagonistCore.identity)),
    protagonistGender:
      authorProtagonistGender ||
      asString(payload.protagonistGender).trim() ||
      extractExplicitProtagonistGender(asString(protagonistCore.gender)),
    protagonistCoreIdentity: asString(protagonistCore.identity) || fallback.protagonistCoreIdentity,
    protagonistCoreGoal: asString(protagonistCore.goal) || asString(payload.protagonistGoal) || fallback.protagonistCoreGoal,
    runtimeSeed,
  };
  return {
    ...draft,
    foundationPrompt: text('foundationPrompt', buildNovelFoundationPrompt(draft)),
  };
}

export function buildNovelCreationBlueprint(draft: NovelCreationWorkshopDraft): NovelCreationBlueprint {
  return {
    profile: draft.profile,
    storyCore: {
      title: draft.title,
      brief: draft.brief,
      premise: draft.premise,
      theme: draft.theme,
      ending: draft.ending,
      plannedChapters: draft.plannedChapters,
      firstChapterGoal: draft.firstChapterGoal,
      worldName: draft.worldName,
      worldEra: draft.worldEra,
      gameRules: draft.gameRules,
    },
    protagonistCore: {
      name: draft.protagonistName,
      gender: draft.protagonistGender,
      identity: draft.protagonistCoreIdentity,
      goal: draft.protagonistCoreGoal,
    },
    runtimeSeed: draft.profile.structure === 'multi_world' || draft.profile.entry !== 'none'
      ? draft.runtimeSeed
      : undefined,
    foundationPrompt: draft.foundationPrompt,
  };
}

function buildWorkshopSystemPrompt(profile: NovelNarrativeProfile) {
  return `你是小说创建阶段的创作蓝图整理助手。当前蓝图是“${profileLabel(profile)}”，推进重点是：${profileFocus(profile)}。

作者会回答四个问题。请把回答整理成一份可供后续 Narrator 或快穿世界生成器使用的稳定创作蓝图。你不写正文，也不生成完整的小世界正文。

请严格只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。不得擅自改变作者已明确的设定；信息不足时留空或标记“待定”，不要编造具体事实。

输出对象必须包含：
{
  "profile": {"structure":"single_world|multi_world","entry":"none|system_task|breakthrough|book_transmigration","focus":"power|relationship|mystery|mixed","knownPlot":false},
  "title": "作品名",
  "brief": "作品定位与一句话概述",
  "premise": "故事前提/主线问题",
  "theme": "主题或核心命题，没有就留空",
  "ending": "长期发展与结局倾向",
  "plannedChapters": 20,
  "firstChapterGoal": "开篇状态与第一章目标",
  "worldName": "世界名称，没有就留空",
  "worldEra": "时代、地点、社会/技术/魔法设定",
  "gameRules": "稳定创作规则",
  "protagonistName": "作者明确提到的主角姓名；必须原样保留，无法确认就留空，不要编造",
  "protagonistGender": "作者明确提到的主角性别；只能填男/女，无法确认就留空，不要根据姓名猜测",
  "protagonistCore": {"gender":"男/女/空", "identity":"跨故事保持的核心身份/价值锚点，不要写完整角色卡", "goal":"故事层面的长期目标"},
  "runtimeSeed": {
    "systemName": "系统/契约名称，没有就留空",
    "globalRules": "跨世界共用规则，没有就留空",
    "worldSeed": "首个世界或原剧情的生成种子",
    "mission": "首个世界任务，没有就留空",
    "entryScene": "进入首个世界的场景，没有就留空",
    "originalPlot": {"premise":"原剧情基线，没有就留空", "knownToProtagonist":"主角已知剧情，没有就留空", "originalEnding":"原定结局，没有就留空"}
  },
  "foundationPrompt": "完整稳定的小说创作设定文本"
}

foundationPrompt 必须按固定标题组织，并且只写稳定设定：
【叙事结构】【作品定位】【世界设定】【故事核心】【叙事要求】【开篇状态】【长期方向】。
不要写当前章节、历史对话、动态记忆、模型信息、协作流程或详细角色卡。`;
}

function buildWorkshopUserContent(
  profile: NovelNarrativeProfile,
  title: string,
  answers: NovelCreationWorkshopAnswers,
) {
  const questions = getNovelCreationWorkshopQuestions(profile);
  return [
    `作品名称：${title.trim() || '未命名小说'}`,
    `故事蓝图：${profileLabel(profile)}`,
    `结构：${profile.structure}`,
    `进入方式：${profile.entry}`,
    `推进重点：${profile.focus}`,
    '',
    ...questions.flatMap((question, index) => [
      `【第${index + 1}问｜${question.title}】`,
      answers[question.key].trim() || '（作者暂未填写）',
      '',
    ]),
  ].join('\n').trim();
}

export async function generateNovelCreationWorkshop({
  apiSettings,
  title,
  answers,
  profile = DEFAULT_NARRATIVE_PROFILE,
  maxTokens = 1800,
  onUsage,
}: {
  apiSettings: ApiSettings;
  title: string;
  answers: NovelCreationWorkshopAnswers;
  profile?: NovelNarrativeProfile;
  maxTokens?: number;
  onUsage?: (usage: { promptTokens: number; completionTokens: number; modelId?: string }) => void;
}): Promise<NovelCreationWorkshopDraft> {
  const result = await requestCompletionWithUsage({ responseFormat: 'json',
    apiSettings: { ...apiSettings, streamingEnabled: false, thinkingDisabled: true },
    purpose: 'create-workshop',
    maxTokens: Math.max(700, Math.min(Math.round(maxTokens), 4000)),
    temperature: Math.min(apiSettings.temperature, 0.65),
    messages: [
      { role: 'system', content: buildWorkshopSystemPrompt(profile) },
      { role: 'user', content: buildWorkshopUserContent(profile, title, answers) },
    ],
  });
  onUsage?.({ promptTokens: result.promptTokens ?? 0, completionTokens: result.completionTokens ?? 0, modelId: result.model });
  const parsed = parseAiJson(result.content);
  return normalizeNovelCreationWorkshopDraft(parsed, answers, title, profile);
}
