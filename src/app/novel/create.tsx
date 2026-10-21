import { router, useLocalSearchParams, useNavigation, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type DimensionValue,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showAppAlert } from '@/utils/app-alert';
import NewNovelCreationScreen from '@/features/novel-creation/CreateNovelScreen';

import { NovelImagePickerField } from '@/components/NovelImagePickerField';
import { NovelVideoPickerField } from '@/components/NovelVideoPickerField';
import { QuickTravelWorldDraftEditor } from '@/components/QuickTravelWorldDraftEditor';
import { AccordionSection } from '@/components/novel-create/AccordionSection';
import { NovelCastEditor } from '@/components/novel-create/NovelCastEditor';
import { NovelCreateStepIndicator } from '@/components/novel-create/NovelCreateStepIndicator';
import { NovelFormField } from '@/components/novel-create/NovelFormField';
import { NovelSystemPromptEditor } from '@/components/novel-settings/NovelSystemPromptEditor';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DEFAULT_CHARACTER_CARD_APPEARANCE_ID } from '@/constants/character-card-appearances';
import { ENABLE_QUICK_TRAVEL } from '@/config/build-features';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  generateNovelFramework,
} from '@/services/novel-create-ai';
import {
  generateNovelInspirations,
  type NovelInspiration,
} from '@/services/novel-inspiration';
import {
  DEFAULT_NARRATIVE_PROFILE,
  generateNovelCreationWorkshop,
  getNovelCreationWorkshopQuestions,
  NARRATIVE_ENTRY_OPTIONS,
  NARRATIVE_FOCUS_OPTIONS,
  NARRATIVE_STRUCTURE_OPTIONS,
  buildNovelCreationBlueprint,
  buildWorkshopProtagonistDefaults,
  normalizeNovelCreationWorkshopDraft,
  type NovelCreationWorkshopAnswers,
  type NovelCreationWorkshopDraft,
} from '@/services/novel-creation-workshop';
import {
  generateQuickTravelSystem,
  generateQuickTravelWorldPlot,
} from '@/services/quick-travel-ai';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import type {
  CreateNovelInput,
  NovelCastCharacter,
  NovelCreationBlueprint,
  NovelCreationMode,
  NovelNarrativeProfile,
  NovelProjectBrief,
  NovelStoryKind,
  QuickTravelArchive,
} from '@/types/tavern';
import { ensureNovelDossiers } from '@/utils/novel-dossiers';
import {
  EMPTY_PLAYER_PROFILE_FIELDS,
  mirrorProtagonistToPlayerFields,
  normalizePlayerProfileFields,
  type NovelPlayerProfileFields,
} from '@/utils/novel-player';
import { DEFAULT_CHAT_BACKGROUND_OPACITY, isNovelVideoUri } from '@/utils/novel-images';
import { mergeIntroForDisplay, splitIntroForStorage } from '@/utils/novel-intro';
import { createOutlineFromProjectBrief } from '@/utils/novel-project';
import {
  buildQuickTravelCharacterContext,
  createEmptyOriginalPlot,
  createEmptyWorldOutline,
  createEmptyWorldRuntime,
  EMPTY_QUICK_TRAVEL_CONFIG,
} from '@/utils/quick-travel';

type QuickWorldDraft = {
  id: string;
  name: string;
  worldEra: string;
  worldRules: string;
  generationBrief?: string;
  mission: string;
  entryScene: string;
  originalPlot: { premise: string; knownToProtagonist: string; beats: any[]; originalEnding: string };
  outline?: import('@/types/tavern').NovelOutline;
};

type WorkbenchQuestionKey =
  | 'name'
  | 'intro'
  | 'premise'
  | 'wishPoint'
  | 'theme'
  | 'arc'
  | 'ending'
  | 'chapters'
  | 'firstChapterGoal'
  | 'quickSystemName'
  | 'quickGlobalRules'
  | 'generateWorld';

type WorkbenchQuestion = {
  key: WorkbenchQuestionKey;
  title: string;
  hint: string;
  example?: string;
  required?: boolean;
};

// 工作台立项引导：先选叙事结构，再按结构逐题收集，避免问无关问题。
const SERIALIZED_QUESTIONS: WorkbenchQuestion[] = [
  { key: 'name', required: true, title: '先给它起个名字', hint: '这个名字会显示在书架上，之后随时可以改。', example: '例如：雨夜旧城区' },
  { key: 'intro', title: '想写一个什么样的故事？', hint: '用几句话说说题材、氛围、主角与想玩的玩法，越具体越好。这步可以先空着，回头再补。', example: '例如：都市悬疑，连绵阴雨的老城区，主角在雨夜接到一通改变命运的电话……' },
  { key: 'premise', required: true, title: '主角最想达成什么？最大的阻力是什么？', hint: '这是故事的主引擎——用一句话讲清“谁想干什么、谁/什么在拦着他”。', example: '例如：主角要查明姐姐失踪的真相，却被家族联手压下来。' },
  { key: 'theme', title: '这个故事想探讨什么？', hint: '一个词或一句话就够，没想好可以先跳过。', example: '例如：代价、信任、自由' },
  { key: 'arc', title: '主角会经历怎样的转变？', hint: '从“什么样的人”变成“怎样的人”。这条弧线会贯穿全书，没想好可跳过。', example: '例如：从只顾自保的普通人，变成愿意为真相承担代价的人。' },
  { key: 'ending', required: true, title: '你希望故事最后走向哪里？', hint: '终局、关键回收，或开放式结局的方向。不用写得很细，AI 会据此收束剧情。', example: '例如：真相大白，但主角必须亲手送挚友入狱。' },
  { key: 'chapters', title: '大概想写多少章？', hint: '只是规划参考，默认 20 章，之后随时调整。', example: '20' },
  { key: 'firstChapterGoal', required: true, title: '第一章想让读者看到什么？', hint: '开篇冲突、人物做的第一个选择，以及章末的钩子。', example: '例如：主角在雨夜接到一通改变命运的电话，章末发现来电者已死三天。' },
  { key: 'generateWorld', title: '要让 AI 生成世界观吗？', hint: '根据名称与简介，AI 会生成世界名称与世界设定；不满意的话到下一步还能手改。' },
];

const WISHFUL_QUESTIONS: WorkbenchQuestion[] = [
  { key: 'name', required: true, title: '先给它起个名字', hint: '这个名字会显示在书架上，之后随时可以改。', example: '例如：雨夜旧城区' },
  { key: 'intro', title: '想写一个什么样的故事？', hint: '用几句话说说题材、关系、反馈节奏和尺度，越具体越好。', example: '例如：都市关系线，节奏明快，主角每次反击都带来明确改变。' },
  { key: 'wishPoint', title: '想写什么样的爽点？', hint: '主角凭什么一路爽？金手指、身份、打脸、反差……一句话即可，没想好可跳过。', example: '例如：主角觉醒记忆，靠预知把所有人玩弄于股掌。' },
  { key: 'chapters', title: '大概想写多少章？', hint: '只是规划参考，默认 20 章，之后随时调整。', example: '20' },
  { key: 'generateWorld', title: '要让 AI 生成世界观吗？', hint: '根据名称与简介，AI 会生成世界名称与世界设定；不满意的话到下一步还能手改。' },
];

const QUICKTRAVEL_QUESTIONS: WorkbenchQuestion[] = [
  { key: 'name', required: true, title: '先给它起个名字', hint: '这个名字会显示在书架上，之后随时可以改。', example: '例如：世界任务档案' },
  { key: 'intro', title: '想写一个什么样的故事？', hint: '用一两句说说整体调性和主角，具体单元留到每个世界里再填。', example: '例如：主角在不同世界完成任务，同时逐步揭开现实中的谜团……' },
  { key: 'quickSystemName', title: '跨单元机制叫什么？', hint: '这是串起所有世界的设定，可随时修改，也可以交给 AI 生成。', example: '例如：命运修正协议' },
  { key: 'quickGlobalRules', title: '跨单元共用规则是什么？', hint: '所有世界共用的任务、奖励、惩罚、记忆和切换规则。', example: '例如：每完成一个任务获得积分，可兑换能力……' },
];

export function CreateNovelScreen({
  creationMode: forcedCreationMode = 'interactive',
  guidedCreation = true,
}: {
  creationMode?: NovelCreationMode;
  /** Show the AI four-question onboarding for the public new-novel entry. */
  guidedCreation?: boolean;
}) {
  const theme = useTheme();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const draftIdParam = Array.isArray(params.draftId) ? params.draftId[0] : params.draftId;
  const createNovel = useTavernStore((state) => state.createNovel);
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const recordNovelContinuationUsage = useTavernStore(
    (state) => state.recordNovelContinuationUsage,
  );
  const novels = useTavernStore((state) => state.novels);
  const novelPromptDefaults = useTavernStore((state) => state.novelPromptDefaults);
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);

  const [draftId, setDraftId] = useState<string | undefined>(draftIdParam);
  const [hydratedDraft, setHydratedDraft] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<1 | 2 | 3>(1);
  // 立项引导（工作台模式）：第 1 步内部逐题问答的进度。
  const [questionIndex, setQuestionIndex] = useState(0);

  // Step 1
  const [name, setName] = useState('');
  const [workIntro, setWorkIntro] = useState('');
  const [creationMode, setCreationMode] = useState<NovelCreationMode>(forcedCreationMode);
  const [projectBrief, setProjectBrief] = useState<NovelProjectBrief>({
    premise: '', theme: '', protagonistArc: '', ending: '', plannedChapters: 20, firstChapterGoal: '',
  });
  const [workshopQuestionIndex, setWorkshopQuestionIndex] = useState(0);
  const [workshopProfile, setWorkshopProfile] = useState<NovelNarrativeProfile>(DEFAULT_NARRATIVE_PROFILE);
  const [workshopAnswers, setWorkshopAnswers] = useState<NovelCreationWorkshopAnswers>({
    world: '',
    protagonist: '',
    conflict: '',
    direction: '',
  });
  const [workshopDraft, setWorkshopDraft] = useState<NovelCreationWorkshopDraft | null>(null);
  const [novelFoundationPrompt, setNovelFoundationPrompt] = useState('');
  const [creationBlueprint, setCreationBlueprint] = useState<NovelCreationBlueprint | undefined>();
  const [workshopConfirmed, setWorkshopConfirmed] = useState(false);
  const [workshopError, setWorkshopError] = useState('');
  const [isGeneratingWorkshop, setIsGeneratingWorkshop] = useState(false);
  const [inspirationSeed, setInspirationSeed] = useState('');
  const [inspirations, setInspirations] = useState<NovelInspiration[]>([]);
  const [isGeneratingInspiration, setIsGeneratingInspiration] = useState(false);
  const [inspirationError, setInspirationError] = useState('');
  const storyKind = projectBrief.storyKind;
  const activeQuestions: WorkbenchQuestion[] =
    storyKind === 'wishful'
      ? WISHFUL_QUESTIONS
      : storyKind === 'quicktravel'
        ? QUICKTRAVEL_QUESTIONS
        : SERIALIZED_QUESTIONS;
  const safeQuestionIndex = Math.min(questionIndex, activeQuestions.length - 1);
  const currentQuestion = activeQuestions[safeQuestionIndex];
  const [coverImageUri, setCoverImageUri] = useState<string | undefined>();
  const [chatBackgroundUri, setChatBackgroundUri] = useState<string | undefined>();
  const [chatBackgroundOpacity, setChatBackgroundOpacity] = useState(
    DEFAULT_CHAT_BACKGROUND_OPACITY,
  );
  const [quickTravelEnabled, setQuickTravelEnabled] = useState(false);
  const [quickTravelSystemName, setQuickTravelSystemName] = useState(EMPTY_QUICK_TRAVEL_CONFIG.systemName);
  const [quickTravelGlobalRules, setQuickTravelGlobalRules] = useState('');
  const [quickWorlds, setQuickWorlds] = useState<QuickWorldDraft[]>([
    { id: 'world-draft-1', name: '', generationBrief: '', worldEra: '', worldRules: '', mission: '', entryScene: '', originalPlot: { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' } },
  ]);
  const [isGeneratingQuickSystem, setIsGeneratingQuickSystem] = useState(false);
  const [generatingQuickWorldId, setGeneratingQuickWorldId] = useState<string | null>(null);
  const [worldMission, setWorldMission] = useState('');
  const [originalPlot, setOriginalPlot] = useState('');
  const [originalPlotKnown, setOriginalPlotKnown] = useState('');
  const [originalEnding, setOriginalEnding] = useState('');

  // Step 2
  const [isGeneratingFramework, setIsGeneratingFramework] = useState(false);
  const [canUndoFrameworkAi, setCanUndoFrameworkAi] = useState(false);
  const frameworkAiSnapshotRef = useRef<{
    worldName: string;
    worldEra: string;
    gameRules: string;
  } | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [playerPersona, setPlayerPersona] = useState('');
  const [playerMotive, setPlayerMotive] = useState('');
  const [playerProfile, setPlayerProfile] = useState<NovelPlayerProfileFields>(
    EMPTY_PLAYER_PROFILE_FIELDS,
  );
  const [worldName, setWorldName] = useState('');
  const [worldEra, setWorldEra] = useState('');
  const [gameRules, setGameRules] = useState('');
  const [characterCardAppearanceId, setCharacterCardAppearanceId] = useState(DEFAULT_CHARACTER_CARD_APPEARANCE_ID);
  const [autoSuggestRoutes, setAutoSuggestRoutes] = useState(false);
  const [cast, setCast] = useState<NovelCastCharacter[]>([]);

  // Step 3 — 默认提示词/文风与选项
  const [isExitDialogOpen, setIsExitDialogOpen] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);
  const [formError, setFormError] = useState('');
  const pendingLeaveActionRef = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const createScrollRef = useRef<ScrollView>(null);

  function scrollCreateFieldIntoView(
    event: Parameters<NonNullable<TextInputProps['onFocus']>>[0],
  ) {
    const target = Number((event as { nativeEvent: { target: number } }).nativeEvent.target);
    requestAnimationFrame(() => {
      createScrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(target, 140, true);
    });
  }

  const blueprintProtagonistCore = creationBlueprint?.protagonistCore;
  const frameworkForAi = {
    playerName: playerName.trim() || blueprintProtagonistCore?.name?.trim() || '',
    playerPersona: playerPersona.trim() || blueprintProtagonistCore?.identity?.trim() || '',
    playerMotive: playerMotive.trim() || blueprintProtagonistCore?.goal?.trim() || '',
    ...playerProfile,
    playerGender: playerProfile.playerGender.trim() || blueprintProtagonistCore?.gender?.trim() || '',
    worldName,
    worldEra,
    worldConflict: '',
    worldTone: '',
    mainPlot: '',
    initialStoryState: '',
    gameRules,
  };
  const chatBackgroundIsVideo = isNovelVideoUri(chatBackgroundUri);
  const isWorkbenchCreation = creationMode === 'workbench';
  // Keep this tied to the route, not draftId state: step-2 AI may persist a
  // temporary draft before publish, but the public new-novel flow must still
  // land on the ordinary novel page after creation.
  const isGuidedCreation = guidedCreation && !draftIdParam && !isWorkbenchCreation;
  const showCreationWorkshop = isGuidedCreation && !workshopConfirmed;

  useEffect(() => {
    if (!draftIdParam || hydratedDraft) {
      return;
    }

    const draft = novels.find((item) => item.id === draftIdParam);

    if (!draft) {
      const timer = setTimeout(() => setHydratedDraft(true), 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setDraftId(draft.id);
      const restoredStep = draft.createStep === 2 || draft.createStep === 3 ? draft.createStep : 1;
      setStep(restoredStep);
      setMaxReachedStep(restoredStep);
      setName(draft.name === '未命名草稿' ? '' : draft.name);
      setWorkIntro(mergeIntroForDisplay(draft.shortIntro, draft.detailedIntro));
      setCreationMode(draft.creationMode === 'workbench' ? 'workbench' : 'interactive');
      setProjectBrief({
        ...(draft.projectBrief ?? {
          premise: '', theme: '', protagonistArc: '', ending: '', plannedChapters: 20, firstChapterGoal: '',
        }),
        storyKind: draft.projectBrief?.storyKind
          ?? (draft.quickTravel?.config.enabled ? 'quicktravel' : undefined),
      });
      setCoverImageUri(draft.coverImageUri);
      setChatBackgroundUri(draft.chatBackgroundUri);
      setChatBackgroundOpacity(draft.chatBackgroundOpacity ?? DEFAULT_CHAT_BACKGROUND_OPACITY);
      setQuickTravelEnabled(Boolean(draft.quickTravel?.config.enabled));
      setQuickTravelSystemName(draft.quickTravel?.config.systemName ?? EMPTY_QUICK_TRAVEL_CONFIG.systemName);
      setQuickTravelGlobalRules(draft.quickTravel?.config.globalRules ?? '');
      const draftWorlds = draft.quickTravel?.worlds ?? [];
      const draftSubWorlds = draftWorlds.filter((world) => !world.isMainWorld);
      setQuickWorlds(draftSubWorlds.length ? draftSubWorlds.map((world) => ({
        id: world.id, name: world.name, generationBrief: world.generationBrief ?? '', worldEra: world.worldEra, worldRules: world.worldRules,
        mission: world.mission, entryScene: world.entryScene, originalPlot: world.originalPlot, outline: world.outline,
      })) : [{ id: 'world-draft-1', name: '', generationBrief: '', worldEra: '', worldRules: '', mission: '', entryScene: '', originalPlot: { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' } }]);
      const draftWorld = draftWorlds.find(
        (world) => world.id === draft.quickTravel?.activeWorldId,
      ) ?? draftSubWorlds[0];
      setWorldMission(draftWorld?.mission ?? '');
      setOriginalPlot(draftWorld?.originalPlot.premise ?? '');
      setOriginalPlotKnown(draftWorld?.originalPlot.knownToProtagonist ?? '');
      setOriginalEnding(draftWorld?.originalPlot.originalEnding ?? '');
      const restoredProtagonistCore = draft.creationBlueprint?.protagonistCore;
      setPlayerName(
        (typeof draft.playerName === 'string' ? draft.playerName.trim() : '')
        || restoredProtagonistCore?.name?.trim()
        || '',
      );
      setPlayerPersona(
        (typeof draft.playerPersona === 'string' ? draft.playerPersona.trim() : '')
        || restoredProtagonistCore?.identity?.trim()
        || '',
      );
      setPlayerMotive(
        (typeof draft.playerMotive === 'string' ? draft.playerMotive.trim() : '')
        || restoredProtagonistCore?.goal?.trim()
        || '',
      );
      const restoredPlayerProfile = normalizePlayerProfileFields(draft);
      setPlayerProfile({
        ...restoredPlayerProfile,
        playerGender: restoredPlayerProfile.playerGender.trim()
          || restoredProtagonistCore?.gender?.trim()
          || '',
      });
      setWorldName(draft.worldName);
      setWorldEra(draft.worldEra);
      setGameRules(draft.gameRules ?? '');
      setCharacterCardAppearanceId(draft.characterCardAppearanceId || DEFAULT_CHARACTER_CARD_APPEARANCE_ID);
      setAutoSuggestRoutes(Boolean(draft.autoSuggestRoutes));
      setCast(Array.isArray(draft.cast) ? draft.cast : []);
      setNovelFoundationPrompt(draft.foundationPrompt ?? '');
      setCreationBlueprint(draft.creationBlueprint);
      if (draft.creationBlueprint?.profile) {
        setWorkshopProfile(draft.creationBlueprint.profile);
      }
      setHydratedDraft(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    draftIdParam,
    hydratedDraft,
    novels,
  ]);

  function buildInput(options: { isDraft: boolean; createStep: 1 | 2 | 3 }): CreateNovelInput {
    // A guided workshop can be saved before the first cast card is created.
    // Keep its protagonist anchor in that draft instead of replacing it with
    // the empty mirror returned for a cast without a marked protagonist.
    const playerMirror = mirrorProtagonistToPlayerFields(cast, {
      playerName,
      playerPersona,
      playerMotive,
      ...playerProfile,
    });
    const { shortIntro, detailedIntro } = splitIntroForStorage(workIntro);
    const now = new Date().toISOString();
    const quickTravel: QuickTravelArchive | undefined = ENABLE_QUICK_TRAVEL && quickTravelEnabled
      ? {
          config: {
            ...EMPTY_QUICK_TRAVEL_CONFIG,
            enabled: true,
            systemName: quickTravelSystemName.trim() || EMPTY_QUICK_TRAVEL_CONFIG.systemName,
            globalRules: quickTravelGlobalRules.trim(),
          },
          worlds: [
            {
              id: draftId ? `main-world-${draftId}` : `main-world-draft-${Date.now()}`,
              isMainWorld: true,
              name: worldName.trim() || name.trim(),
              worldEra: worldEra.trim(),
              worldRules: gameRules.trim(),
              protagonistIdentity: playerPersona.trim(),
              entryScene: '',
              mission: '',
              cast,
              characterDossiers: ensureNovelDossiers({ cast, characterDossiers: [] }),
              loreEntries: [],
              originalPlot: createEmptyOriginalPlot(),
              runtime: createEmptyWorldRuntime(),
              status: 'active' as const,
              createdAt: now,
              updatedAt: now,
            },
            ...quickWorlds.map((world, index) => ({
              id: world.id || (draftId ? `world-${draftId}-${index}` : `world-draft-${Date.now()}-${index}`),
              name: world.name.trim() || `${name.trim()}世界${index + 1}`,
              generationBrief: (world.generationBrief ?? '').trim(),
              worldEra: world.worldEra.trim(),
              worldRules: world.worldRules.trim(),
              protagonistIdentity: playerPersona.trim(),
              entryScene: world.entryScene.trim(),
              mission: world.mission.trim(),
              cast: cast.filter((character) => character.isProtagonist),
              characterDossiers: ensureNovelDossiers({
                cast: cast.filter((character) => character.isProtagonist),
                characterDossiers: [],
              }),
              loreEntries: [],
              originalPlot: {
                ...world.originalPlot,
                premise: world.originalPlot.premise.trim(),
                knownToProtagonist: world.originalPlot.knownToProtagonist.trim(),
                originalEnding: world.originalPlot.originalEnding.trim(),
              },
              outline: world.outline,
              runtime: {
                currentScene: '',
                currentChapter: 0,
                mission: world.mission.trim(),
                missionStatus: 'not_started' as const,
                completedObjectives: [],
                deviations: [],
                currentEnding: '',
              },
              status: 'active' as const,
              createdAt: now,
              updatedAt: now,
            })),
          ],
          activeWorldId: quickWorlds[0]?.id ?? (draftId ? `main-world-${draftId}` : undefined),
          settlements: [],
        }
      : undefined;

    return {
      name: name.trim(),
      shortIntro,
      detailedIntro,
      systemPrompt: novelPromptDefaults.systemPrompt,
      writingStyle: '',
      shortTermMemoryPrompt: novelPromptDefaults.shortTermMemoryPrompt,
      midTermMemoryPrompt: novelPromptDefaults.midTermMemoryPrompt,
      longTermMemoryPrompt: novelPromptDefaults.longTermMemoryPrompt,
      ...playerMirror,
      worldName,
      worldEra,
      worldConflict: '',
      worldTone: '',
      mainPlot: '',
      initialStoryState: '',
      gameRules,
      autoSuggestRoutes,
      relationGraphEnabled: false,
      characterCardAppearanceId,
      cast,
      characterDossiers: ensureNovelDossiers({ cast, characterDossiers: [] }),
      loreEntries: [],
      relationGraphs: [],
      openingMessage: '',
      defaultModelId: '',
      defaultProviderId: undefined,
      coverImageUri,
      chatBackgroundUri,
      chatBackgroundOpacity,
      quickTravel,
      creationMode,
      foundationPrompt: novelFoundationPrompt.trim() || undefined,
      creationBlueprint,
      projectBrief: creationMode === 'workbench' ? projectBrief : undefined,
      outline: creationMode === 'workbench' ? createOutlineFromProjectBrief(projectBrief, now) : undefined,
      // “工作台”是创建/编辑界面，不代表作品来自续写导入。
      // 续写工程只由 /novel/continue 创建；旧草稿则保留原有标记。
      isContinuationProject: draftId
        ? novels.find((item) => item.id === draftId)?.isContinuationProject === true
        : false,
      isDraft: options.isDraft,
      createStep: options.createStep,
    };
  }

  function dismissExitDialog() {
    setIsExitDialogOpen(false);
    pendingLeaveActionRef.current = null;
  }

  function leaveCreateScreen() {
    const action = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    setIsExitDialogOpen(false);
    // Flip prevent-remove off first; dispatch/back must run after re-render.
    setAllowLeave(true);
    setTimeout(() => {
      if (action) {
        navigation.dispatch(action);
        return;
      }
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/(tabs)/novels' as Href);
    }, 0);
  }

  function persistDraft() {
    const input = buildInput({ isDraft: true, createStep: maxReachedStep });

    if (draftId) {
      updateNovel(draftId, input);
      return draftId;
    }

    const savedId = createNovel(input);
    setDraftId(savedId);
    return savedId;
  }

  function handleBack() {
    if (step === 1 && showCreationWorkshop && workshopQuestionIndex > 0) {
      setWorkshopQuestionIndex((current) => Math.max(0, current - 1));
      setWorkshopError('');
      return;
    }
    if (step === 1 && isWorkbenchCreation && storyKind) {
      if (safeQuestionIndex > 0) {
        setQuestionIndex(safeQuestionIndex - 1);
      } else {
        setProjectBrief((current) => ({ ...current, storyKind: undefined }));
        setQuickTravelEnabled(false);
        setQuestionIndex(0);
      }
      setFormError('');
      return;
    }

    if (step > 1) {
      setStep((current) => (current === 3 ? 2 : 1));
      setFormError('');
      return;
    }

    // Use a Modal instead of Alert — RN Web / some Android builds ignore multi-button Alert.
    setIsExitDialogOpen(true);
  }

  function handleExitDiscard() {
    leaveCreateScreen();
  }

  function handleExitSaveDraft() {
    persistDraft();
    leaveCreateScreen();
  }

  usePreventRemove(!allowLeave, ({ data }) => {
    pendingLeaveActionRef.current = data.action;
    setIsExitDialogOpen(true);
  });

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isExitDialogOpen) {
        dismissExitDialog();
        return true;
      }
      if (step === 1 && isWorkbenchCreation && storyKind) {
        if (safeQuestionIndex > 0) {
          setQuestionIndex(safeQuestionIndex - 1);
        } else {
          setProjectBrief((current) => ({ ...current, storyKind: undefined }));
          setQuickTravelEnabled(false);
          setQuestionIndex(0);
        }
        setFormError('');
        return true;
      }
      if (step === 1 && showCreationWorkshop && workshopQuestionIndex > 0) {
        setWorkshopQuestionIndex((current) => Math.max(0, current - 1));
        setWorkshopError('');
        return true;
      }
      if (step > 1) {
        setStep((current) => (current === 3 ? 2 : 1));
        setFormError('');
        return true;
      }
      setIsExitDialogOpen(true);
      return true;
    });

    return () => sub.remove();
  }, [
    step,
    isExitDialogOpen,
    isWorkbenchCreation,
    showCreationWorkshop,
    storyKind,
    safeQuestionIndex,
    workshopQuestionIndex,
  ]);

  function goToStep(nextStep: 1 | 2 | 3) {
    if (nextStep > maxReachedStep) {
      return;
    }

    setFormError('');
    if (nextStep === 1) {
      setQuestionIndex(0);
    }
    setStep(nextStep);
  }

  function goNext() {
    // Required-field checks run on publish only; steps stay freely navigable.
    setFormError('');
    setStep((current) => {
      const next = current === 1 ? 2 : 3;
      setMaxReachedStep((reached) => (next > reached ? next : reached));
      return next;
    });
  }

  function applyFrameworkFields(next: {
    worldName: string;
    worldEra: string;
    gameRules: string;
  }) {
    setWorldName(next.worldName);
    setWorldEra(next.worldEra);
    setGameRules(next.gameRules);
  }

  function updateQuickWorld(id: string, updates: Partial<QuickWorldDraft>) {
    setQuickWorlds((worlds) => worlds.map((world) => world.id === id ? { ...world, ...updates } : world));
  }

  async function handleQuickSystemAi() {
    if (isGeneratingQuickSystem || !name.trim()) return;
    setIsGeneratingQuickSystem(true);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, { purpose: 'utility' });
      const next = await generateQuickTravelSystem({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        novelName: name,
        intro: workIntro,
        current: { systemName: quickTravelSystemName, globalRules: quickTravelGlobalRules },
      });
      setQuickTravelSystemName(next.systemName);
      setQuickTravelGlobalRules(next.globalRules);
    } catch (error) {
      showAppAlert('快穿系统生成失败', error instanceof Error ? error.message : '无法生成快穿系统。');
    } finally {
      setIsGeneratingQuickSystem(false);
    }
  }

  async function handleQuickWorldAi(world: QuickWorldDraft) {
    if (generatingQuickWorldId || !name.trim()) return;
    setGeneratingQuickWorldId(world.id);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, { purpose: 'utility' });
      const next = await generateQuickTravelWorldPlot({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        novelName: name,
        intro: workIntro,
        systemRules: quickTravelGlobalRules,
        protagonistIdentity: [playerName.trim(), playerPersona.trim(), playerMotive.trim()]
          .filter(Boolean)
          .join('\n'),
        current: {
          name: world.name,
          worldEra: world.worldEra,
          worldRules: world.worldRules,
          generationBrief: world.generationBrief ?? '',
          mission: world.mission,
          originalPlot: world.originalPlot,
        },
      });
      updateQuickWorld(world.id, next);
    } catch (error) {
      showAppAlert('小世界剧情生成失败', error instanceof Error ? error.message : '无法生成小世界剧情。');
    } finally {
      setGeneratingQuickWorldId(null);
    }
  }

  function clearFrameworkAiFields() {
    if (!worldName.trim() && !worldEra.trim() && !gameRules.trim()) {
      return;
    }

    frameworkAiSnapshotRef.current = {
      worldName,
      worldEra,
      gameRules,
    };
    applyFrameworkFields({
      worldName: '',
      worldEra: '',
      gameRules: '',
    });
    setCanUndoFrameworkAi(true);
  }

  function undoFrameworkAi() {
    const snapshot = frameworkAiSnapshotRef.current;
    if (!snapshot) {
      return;
    }

    applyFrameworkFields(snapshot);
    frameworkAiSnapshotRef.current = null;
    setCanUndoFrameworkAi(false);
  }

  async function handleFrameworkAi() {
    if (isGeneratingFramework) {
      return;
    }

    if (!name.trim()) {
      showAppAlert('请先填写小说名称', 'AI 需要名称与介绍作为生成依据。');
      return;
    }

    setIsGeneratingFramework(true);
    setFormError('');

    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        purpose: 'utility',
      });

      if (
        !apiSettings.apiKey.trim()
      ) {
        showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
        return;
      }

      frameworkAiSnapshotRef.current = {
        worldName,
        worldEra,
        gameRules,
      };

      // 先落草稿：断点恢复 + 让框架生成的 token 统计可归属到小说。
      const draftNovelId = persistDraft();

      const next = await generateNovelFramework({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        novelName: name,
        intro: workIntro,
        current: {
          ...frameworkForAi,
          cast: [],
        },
        onUsage: (usage) => {
          if (draftNovelId && usage.completionTokens > 0) {
            recordNovelContinuationUsage(
              draftNovelId,
              'create-framework',
              usage.completionTokens,
            );
          }
        },
      });

      applyFrameworkFields({
        worldName: next.worldName,
        worldEra: next.worldEra,
        gameRules: next.gameRules,
      });
      setCanUndoFrameworkAi(true);
      setMaxReachedStep((reached) => (reached < 2 ? 2 : reached));
      setStep(2);
    } catch (error) {
      frameworkAiSnapshotRef.current = null;
      setCanUndoFrameworkAi(false);
      showAppAlert('AI 生成失败', error instanceof Error ? error.message : '无法生成设定。');
    } finally {
      setIsGeneratingFramework(false);
    }
  }

  function applyWorkshopDraft(draft: NovelCreationWorkshopDraft) {
    const fill = (current: string, next: string) => current.trim() || next.trim();
    const blueprint = buildNovelCreationBlueprint(draft);
    const protagonist = buildWorkshopProtagonistDefaults(draft);
    const runtime = draft.runtimeSeed;
    const wantsQuickTravel = ENABLE_QUICK_TRAVEL && draft.profile.structure === 'multi_world';
    const currentWorld = quickWorlds[0];

    setName((current) => fill(current, draft.title));
    setNovelFoundationPrompt(draft.foundationPrompt);
    setCreationBlueprint(blueprint);
    setWorkIntro((current) => fill(current, draft.brief));
    setWorldName((current) => fill(current, draft.worldName));
    setWorldEra((current) => fill(current, draft.worldEra));
    setGameRules((current) => fill(current, draft.gameRules));
    // Keep the workshop protagonist anchor available to the later cast-card
    // generator. Without this bridge the first character request can invent
    // a different name even when the author already supplied one.
    setPlayerName((current) => fill(current, protagonist.playerName));
    setPlayerPersona((current) => fill(current, protagonist.playerPersona));
    setPlayerMotive((current) => fill(current, protagonist.playerMotive));
    setPlayerProfile((current) => ({
      ...current,
      playerGender: fill(current.playerGender, protagonist.playerGender),
    }));

    // The workshop only selects the execution profile. Detailed character data
    // remains owned by cast cards; quick-travel world details remain owned by
    // the existing world generator/editor.
    setQuickTravelEnabled(wantsQuickTravel);
    if (wantsQuickTravel) {
      setQuickTravelSystemName((current) => fill(current, runtime.systemName));
      setQuickTravelGlobalRules((current) => fill(current, runtime.globalRules));
      setQuickWorlds([{
        ...(currentWorld ?? {
          id: 'world-draft-workshop',
          name: '',
          generationBrief: '',
          worldEra: '',
          worldRules: '',
          mission: '',
          entryScene: '',
          originalPlot: { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' },
        }),
        name: currentWorld?.name?.trim() || draft.worldName.trim(),
        generationBrief: currentWorld?.generationBrief?.trim() || runtime.worldSeed.trim() || draft.brief.trim(),
        worldEra: currentWorld?.worldEra?.trim() || draft.worldEra.trim(),
        worldRules: currentWorld?.worldRules?.trim() || draft.gameRules.trim(),
        mission: currentWorld?.mission?.trim() || runtime.mission.trim(),
        entryScene: currentWorld?.entryScene?.trim() || runtime.entryScene.trim(),
        originalPlot: {
          ...(currentWorld?.originalPlot ?? { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' }),
          premise: currentWorld?.originalPlot?.premise?.trim() || runtime.originalPlot.premise.trim(),
          knownToProtagonist: currentWorld?.originalPlot?.knownToProtagonist?.trim() || runtime.originalPlot.knownToProtagonist.trim(),
          originalEnding: currentWorld?.originalPlot?.originalEnding?.trim() || runtime.originalPlot.originalEnding.trim(),
        },
      }]);
    } else {
      setQuickTravelSystemName(EMPTY_QUICK_TRAVEL_CONFIG.systemName);
      setQuickTravelGlobalRules('');
    }

    setWorkshopConfirmed(true);
    setWorkshopError('');
    setMaxReachedStep((reached) => (reached < 2 ? 2 : reached));
    setStep(2);
  }

  async function handleWorkshopGenerate() {
    if (isGeneratingWorkshop) {
      return;
    }

    if (!name.trim()) {
      setWorkshopError('请先填写小说名称。');
      return;
    }

    if (!Object.values(workshopAnswers).some((answer) => answer.trim())) {
      setWorkshopError('至少回答一个问题，再让 AI 整理故事方案。');
      return;
    }

    setIsGeneratingWorkshop(true);
    setWorkshopError('');

    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, { purpose: 'utility' });
      if (!apiSettings.apiKey.trim()) {
        throw new Error('尚未配置可用的模型 Key');
      }
      const draft = await generateNovelCreationWorkshop({
        apiSettings,
        title: name,
        answers: workshopAnswers,
        profile: workshopProfile,
        maxTokens: generationSettings.novelCreateMaxTokens,
      });
      setWorkshopDraft(draft);
    } catch (error) {
      const fallback = normalizeNovelCreationWorkshopDraft(null, workshopAnswers, name, workshopProfile);
      setWorkshopDraft(fallback);
      setWorkshopError(
        `${error instanceof Error ? error.message : 'AI 暂时无法回应'}，已生成基础草案，可继续手动完善。`,
      );
    } finally {
      setIsGeneratingWorkshop(false);
    }
  }

  function handleWorkshopNext() {
    const questions = getNovelCreationWorkshopQuestions(workshopProfile);
    if (workshopQuestionIndex < questions.length - 1) {
      setWorkshopQuestionIndex((current) => current + 1);
      setWorkshopError('');
      return;
    }
    void handleWorkshopGenerate();
  }

  function resetWorkshopDraft() {
    setWorkshopDraft(null);
    setWorkshopConfirmed(false);
    setWorkshopQuestionIndex(0);
    setWorkshopError('');
  }

  function updateWorkshopProfile(updates: Partial<NovelNarrativeProfile>) {
    const next: NovelNarrativeProfile = { ...workshopProfile, ...updates };
    if (next.structure === 'single_world' && (next.entry === 'system_task' || next.entry === 'breakthrough')) {
      next.entry = 'none';
    }
    if (next.structure === 'multi_world' && next.entry === 'none') {
      next.entry = 'system_task';
    }
    next.knownPlot = next.entry === 'book_transmigration' || next.knownPlot;
    if (next.entry !== 'book_transmigration' && updates.entry && updates.entry !== 'book_transmigration') {
      next.knownPlot = false;
    }
    setWorkshopProfile(next);
    setWorkshopAnswers({ world: '', protagonist: '', conflict: '', direction: '' });
    setWorkshopDraft(null);
    setWorkshopQuestionIndex(0);
    setWorkshopError('');
  }

  async function handleGenerateInspirations() {
    if (isGeneratingInspiration) {
      return;
    }

    setIsGeneratingInspiration(true);
    setInspirationError('');

    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, { purpose: 'utility' });
      if (!apiSettings.apiKey.trim()) {
        throw new Error('尚未配置可用的模型 Key');
      }
      const next = await generateNovelInspirations({
        apiSettings,
        seed: inspirationSeed,
        maxTokens: generationSettings.novelCreateMaxTokens,
      });
      setInspirations(next);
    } catch (error) {
      setInspirationError(error instanceof Error ? error.message : '暂时没有找到合适的灵感，请重试。');
    } finally {
      setIsGeneratingInspiration(false);
    }
  }

  function applyInspiration(inspiration: NovelInspiration) {
    const profile = !ENABLE_QUICK_TRAVEL && inspiration.profile.structure === 'multi_world'
      ? { ...inspiration.profile, structure: 'single_world' as const, entry: 'none' as const }
      : inspiration.profile;

    setName(inspiration.title);
    setWorkshopProfile(profile);
    setWorkshopAnswers({
      world: inspiration.world,
      protagonist: inspiration.protagonist,
      conflict: inspiration.conflict,
      direction: inspiration.direction,
    });
    setWorkshopQuestionIndex(0);
    setWorkshopDraft(null);
    setWorkshopConfirmed(false);
    setWorkshopError('');
    setInspirationError('');
  }

  function renderCreationWorkshop() {
    const questions = getNovelCreationWorkshopQuestions(workshopProfile);
    const question = questions[workshopQuestionIndex];
    const answer = workshopAnswers[question.key];
    const progress = ((workshopQuestionIndex + 1) / questions.length) * 100;

    return (
      <View style={styles.workshopBlock}>
        <ThemedText type="code" themeColor="accent">
          AI 创作设定
        </ThemedText>
        <ThemedText style={styles.workshopIntroTitle}>
          先把故事说清楚，再开始写。
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          先确定故事蓝图的几个维度，再回答四个问题。AI 会补全稳定的创作设定；具体角色卡和小世界仍交给后续专用工具。
        </ThemedText>

        <ThemedView
          type="surface"
          style={[styles.inspirationPanel, { borderColor: theme.accent, backgroundColor: theme.accentMuted }]}>
          <View style={styles.aiHeader}>
            <View style={styles.inspirationHeading}>
              <ThemedText type="code" themeColor="accent">灵感起点</ThemedText>
              <ThemedText type="smallBold">还没有完整想法？先找一个值得写的故事种子。</ThemedText>
            </View>
            <ThemedText type="code" themeColor="textMuted">3 选 1</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            可以留空，也可以只写题材、意象、关系或不想出现的套路。选中后会自动带入下方创作问答，所有内容都能继续修改。
          </ThemedText>
          <NovelFormField
            hideLabel
            multiline
            minHeight={92}
            value={inspirationSeed}
            placeholder="可选，例如：潮湿海港、失忆、成年人的克制感；不要系统升级流"
            onChangeText={setInspirationSeed}
          />
          <Pressable
            disabled={isGeneratingInspiration}
            onPress={() => void handleGenerateInspirations()}
            style={({ pressed }) => [
              styles.aiButton,
              { alignSelf: 'flex-start', backgroundColor: theme.accent },
              (pressed || isGeneratingInspiration) && { opacity: 0.7 },
            ]}>
            <ThemedText type="smallBold" style={styles.aiButtonText}>
              {isGeneratingInspiration
                ? '正在捕捉灵感…'
                : inspirations.length > 0
                  ? '换一批灵感'
                  : '给我 3 个灵感'}
            </ThemedText>
          </Pressable>
          {inspirationError ? (
            <ThemedText type="small" themeColor="accent">{inspirationError}</ThemedText>
          ) : null}
          {inspirations.length > 0 ? (
            <View style={styles.inspirationList}>
              {inspirations.map((inspiration, index) => (
                <View
                  key={inspiration.id}
                  style={[styles.inspirationCard, { borderColor: theme.border, backgroundColor: theme.background }]}>
                  <View style={styles.inspirationCardHeader}>
                    <ThemedText type="code" themeColor="accent">0{index + 1}</ThemedText>
                    <View style={styles.inspirationCardTitle}>
                      <ThemedText type="smallBold">{inspiration.title}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">{inspiration.hook}</ThemedText>
                    </View>
                  </View>
                  <ThemedText type="small" themeColor="textMuted">
                    {inspiration.protagonist}{'\n'}{inspiration.conflict}
                  </ThemedText>
                  <Pressable
                    onPress={() => applyInspiration(inspiration)}
                    style={({ pressed }) => [
                      styles.inspirationUseButton,
                      { borderColor: theme.accent },
                      pressed && { opacity: 0.7 },
                    ]}>
                    <ThemedText type="smallBold" themeColor="accent">用这个灵感继续 →</ThemedText>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </ThemedView>

        <View style={styles.kindPicker}>
          <ThemedText type="smallBold">故事骨架</ThemedText>
          {NARRATIVE_STRUCTURE_OPTIONS
            .filter((option) => ENABLE_QUICK_TRAVEL || option.value === 'single_world')
            .map((option) => (
              <Pressable
                key={option.value}
                onPress={() => updateWorkshopProfile({ structure: option.value })}
                style={({ pressed }) => [
                  styles.kindOption,
                  {
                    borderColor: workshopProfile.structure === option.value ? theme.accent : theme.border,
                    backgroundColor: workshopProfile.structure === option.value
                      ? theme.accentMuted
                      : theme.backgroundElement,
                  },
                  pressed && { opacity: 0.7 },
                ]}>
                <ThemedText type="smallBold">{option.label}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">{option.description}</ThemedText>
              </Pressable>
            ))}
        </View>

        <View style={styles.kindPicker}>
          <ThemedText type="smallBold">进入方式</ThemedText>
          {NARRATIVE_ENTRY_OPTIONS
            .filter((option) => ENABLE_QUICK_TRAVEL || option.value === 'none' || option.value === 'book_transmigration')
            .filter((option) => workshopProfile.structure === 'multi_world' || option.value === 'none' || option.value === 'book_transmigration')
            .map((option) => (
              <Pressable
                key={option.value}
                onPress={() => updateWorkshopProfile({
                  entry: option.value,
                  knownPlot: option.value === 'book_transmigration',
                })}
                style={({ pressed }) => [
                  styles.kindOption,
                  {
                    borderColor: workshopProfile.entry === option.value ? theme.accent : theme.border,
                    backgroundColor: workshopProfile.entry === option.value
                      ? theme.accentMuted
                      : theme.backgroundElement,
                  },
                  pressed && { opacity: 0.7 },
                ]}>
                <ThemedText type="smallBold">{option.label}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">{option.description}</ThemedText>
              </Pressable>
            ))}
        </View>

        <View style={styles.kindPicker}>
          <ThemedText type="smallBold">推进重点</ThemedText>
          {NARRATIVE_FOCUS_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => updateWorkshopProfile({ focus: option.value })}
              style={({ pressed }) => [
                styles.kindOption,
                {
                  borderColor: workshopProfile.focus === option.value ? theme.accent : theme.border,
                  backgroundColor: workshopProfile.focus === option.value
                    ? theme.accentMuted
                    : theme.backgroundElement,
                },
                pressed && { opacity: 0.7 },
              ]}>
              <ThemedText type="smallBold">{option.label}</ThemedText>
              <ThemedText type="small" themeColor="textMuted">{option.description}</ThemedText>
            </Pressable>
          ))}
        </View>

        <NovelFormField
          label="小说名称"
          required
          value={name}
          placeholder="例如：潮汐之后"
          onChangeText={setName}
        />

        <View style={styles.workshopProgressMeta}>
          <ThemedText type="small" themeColor="textMuted">
            第 {workshopQuestionIndex + 1} / {questions.length} 问
          </ThemedText>
          <ThemedText type="small" themeColor="accent">
            设定生成
          </ThemedText>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.accent, width: `${progress}%` as DimensionValue }]} />
        </View>

        <ThemedView type="surface" style={[styles.workshopQuestionCard, { borderColor: theme.border }]}>
          <ThemedText style={styles.questionTitle}>{question.title}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">{question.hint}</ThemedText>
          <NovelFormField
            hideLabel
            multiline
            minHeight={150}
            value={answer}
            placeholder={question.placeholder}
            onChangeText={(value) => setWorkshopAnswers((current) => ({ ...current, [question.key]: value }))}
          />
        </ThemedView>

        {workshopDraft ? (
          <ThemedView type="surface" style={[styles.workshopResultCard, { borderColor: theme.accent }]}>
            <View style={styles.aiHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <ThemedText type="smallBold">AI 补全的小说创作设定</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  这是后续 Narrator 会遵循的稳定设定，可在确认前直接修改。
                </ThemedText>
              </View>
              <ThemedText type="code" themeColor="accent">待确认</ThemedText>
            </View>
            <ThemedText type="smallBold">{workshopDraft.title || name || '未命名小说'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{workshopDraft.brief || '暂未形成简介。'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              故事目标：{workshopDraft.protagonistCoreGoal || '待补充'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              主要冲突：{workshopDraft.premise || '待补充'}
            </ThemedText>
            {workshopProfile.structure === 'multi_world' ? (
              <ThemedText type="small" themeColor="textSecondary">
                执行方式：已有快穿世界生成器（{workshopDraft.runtimeSeed.mission || '首个世界待生成'}）
              </ThemedText>
            ) : null}
            <NovelFormField
              label="小说创作设定（可编辑）"
              multiline
              minHeight={260}
              value={workshopDraft.foundationPrompt}
              onChangeText={(value) => setWorkshopDraft((current) => current
                ? { ...current, foundationPrompt: value }
                : current)}
            />
            <View style={styles.workshopResultActions}>
              <Pressable
                onPress={() => applyWorkshopDraft(workshopDraft)}
                style={({ pressed }) => [
                  styles.aiButton,
                  { backgroundColor: theme.accent },
                  pressed && { opacity: 0.75 },
                ]}>
                <ThemedText type="smallBold" style={styles.aiButtonText}>采用设定，继续设置</ThemedText>
              </Pressable>
              <Pressable
                onPress={resetWorkshopDraft}
                style={({ pressed }) => [
                  styles.aiGhostButton,
                  { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                  pressed && { opacity: 0.75 },
                ]}>
                <ThemedText type="code" themeColor="accent">重新回答</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        ) : null}

        {workshopError ? (
          <ThemedText type="small" themeColor="accent">{workshopError}</ThemedText>
        ) : null}

        <View style={styles.workshopActions}>
          {workshopQuestionIndex > 0 ? (
            <Pressable
              onPress={() => setWorkshopQuestionIndex((current) => Math.max(0, current - 1))}
              style={({ pressed }) => [styles.skipButton, { borderColor: theme.border }, pressed && styles.pressed]}>
              <ThemedText type="smallBold" themeColor="textMuted">上一问</ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            onPress={handleWorkshopNext}
            disabled={isGeneratingWorkshop}
            style={({ pressed }) => [
              styles.saveButton,
              { flex: 1, backgroundColor: theme.accent },
              (pressed || isGeneratingWorkshop) && { opacity: 0.7 },
            ]}>
            <ThemedText type="smallBold" style={styles.saveButtonText}>
              {isGeneratingWorkshop
                ? 'AI 整理中…'
                : workshopQuestionIndex === questions.length - 1
                  ? '让 AI 整理方案'
                  : '下一问'}
            </ThemedText>
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            setWorkshopConfirmed(true);
            setWorkshopError('');
          }}
          style={({ pressed }) => [styles.workshopManualButton, pressed && { opacity: 0.7 }]}>
          <ThemedText type="small" themeColor="textMuted">暂不使用 AI，手动填写</ThemedText>
        </Pressable>
      </View>
    );
  }

  function handlePublish() {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setFormError('请填写小说名称后再创建。');
      setStep(1);
      return;
    }

    if (creationMode === 'workbench' && !storyKind) {
      setFormError('请先选择这本书的叙事结构。');
      setStep(1);
      return;
    }

    if (
      creationMode === 'workbench' &&
      storyKind === 'serialized' &&
      (!projectBrief.premise.trim() || !projectBrief.ending.trim() || !projectBrief.firstChapterGoal.trim())
    ) {
      setFormError('主线推进结构需要填写主线、结局方向与第一章目标。');
      setStep(1);
      return;
    }

    if (
      !novelPromptDefaults.systemPrompt.trim() ||
      !novelPromptDefaults.shortTermMemoryPrompt.trim() ||
      !novelPromptDefaults.midTermMemoryPrompt.trim() ||
      !novelPromptDefaults.longTermMemoryPrompt.trim()
    ) {
      setFormError('请先在「小说配置」填写完整的提示词默认。');
      setStep(3);
      return;
    }

    const input = buildInput({ isDraft: false, createStep: 3 });

    const novelId = draftId ?? createNovel(input);
    if (draftId) {
      updateNovel(draftId, input);
    }

    setFormError('');
    setAllowLeave(true);
    setTimeout(() => {
      if (creationMode === 'workbench') {
        router.replace(`/novel/world-outline/${novelId}` as Href);
        return;
      }
      if (isGuidedCreation) {
        router.replace(`/novel/${novelId}` as Href);
        return;
      }
      router.replace('/(tabs)/novels' as Href);
    }, 0);
  }

  const isLastWorkbenchQuestion =
    step === 1 && isWorkbenchCreation && Boolean(storyKind) && safeQuestionIndex >= activeQuestions.length - 1;
  const isPickingStoryKind = step === 1 && isWorkbenchCreation && !storyKind;

  function handleFooterNext() {
    if (step === 1 && isWorkbenchCreation && storyKind && safeQuestionIndex < activeQuestions.length - 1) {
      setQuestionIndex(safeQuestionIndex + 1);
      return;
    }
    goNext();
  }

  function handleStoryKindSelect(kind: NovelStoryKind) {
    setProjectBrief((current) => ({ ...current, storyKind: kind }));
    setQuickTravelEnabled(kind === 'quicktravel');
    setQuestionIndex(0);
    setFormError('');
  }

  function renderQuestionInput(q: WorkbenchQuestion) {
    switch (q.key) {
      case 'name':
        return <NovelFormField hideLabel value={name} placeholder={q.example} onChangeText={setName} />;
      case 'intro':
        return <NovelFormField hideLabel multiline minHeight={150} value={workIntro} placeholder={q.example} onChangeText={setWorkIntro} />;
      case 'premise':
      case 'wishPoint':
        return <NovelFormField hideLabel multiline minHeight={110} value={projectBrief.premise} placeholder={q.example} onChangeText={(premise) => setProjectBrief((current) => ({ ...current, premise }))} />;
      case 'theme':
        return <NovelFormField hideLabel value={projectBrief.theme} placeholder={q.example} onChangeText={(theme) => setProjectBrief((current) => ({ ...current, theme }))} />;
      case 'arc':
        return <NovelFormField hideLabel multiline minHeight={110} value={projectBrief.protagonistArc} placeholder={q.example} onChangeText={(protagonistArc) => setProjectBrief((current) => ({ ...current, protagonistArc }))} />;
      case 'ending':
        return <NovelFormField hideLabel multiline minHeight={110} value={projectBrief.ending} placeholder={q.example} onChangeText={(ending) => setProjectBrief((current) => ({ ...current, ending }))} />;
      case 'chapters':
        return <NovelFormField hideLabel preserveDraft keyboardType="number-pad" value={String(projectBrief.plannedChapters)} placeholder={q.example} onChangeText={(value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            setProjectBrief((current) => ({ ...current, plannedChapters: parsed }));
          }
        }} />;
      case 'firstChapterGoal':
        return <NovelFormField hideLabel multiline minHeight={110} value={projectBrief.firstChapterGoal} placeholder={q.example} onChangeText={(firstChapterGoal) => setProjectBrief((current) => ({ ...current, firstChapterGoal }))} />;
      case 'quickSystemName':
        return (
          <>
            <NovelFormField hideLabel value={quickTravelSystemName} placeholder={q.example} onChangeText={setQuickTravelSystemName} />
            <Pressable
              disabled={isGeneratingQuickSystem || !name.trim()}
              onPress={() => void handleQuickSystemAi()}
              style={({ pressed }) => [
                styles.aiGhostButton,
                { alignSelf: 'flex-start', borderColor: theme.border, backgroundColor: theme.backgroundElement },
                (pressed || isGeneratingQuickSystem) && { opacity: 0.6 },
              ]}>
              <ThemedText type="code" themeColor="accent">
                {isGeneratingQuickSystem ? '生成中…' : 'AI 生成系统与规则'}
              </ThemedText>
            </Pressable>
          </>
        );
      case 'quickGlobalRules':
        return <NovelFormField hideLabel multiline minHeight={140} value={quickTravelGlobalRules} placeholder={q.example} onChangeText={setQuickTravelGlobalRules} />;
      case 'generateWorld':
        return (
          <Pressable
            disabled={isGeneratingFramework || !name.trim()}
            onPress={() => void handleFrameworkAi()}
            style={({ pressed }) => [
              styles.aiButton,
              { alignSelf: 'flex-start', backgroundColor: theme.accent },
              (pressed || isGeneratingFramework || !name.trim()) && { opacity: 0.75 },
            ]}>
            <ThemedText type="smallBold" style={styles.aiButtonText}>
              {isGeneratingFramework ? '生成中…' : 'AI 生成世界观'}
            </ThemedText>
          </Pressable>
        );
      default:
        return null;
    }
  }

  function renderStoryKindPicker() {
    const options: { kind: NovelStoryKind; title: string; hint: string }[] = [
      { kind: 'wishful', title: '目标兑现', hint: '围绕主角愿望设计优势、阻力、回报与升级节奏' },
      ...(ENABLE_QUICK_TRAVEL
        ? [{ kind: 'quicktravel' as NovelStoryKind, title: '世界任务', hint: '由多个相对独立的世界组成，同时保留跨单元主线' }]
        : []),
      { kind: 'serialized', title: '主线推进', hint: '围绕一条核心矛盾持续发展并逐步回收伏笔' },
    ];
    return (
      <ThemedView type="surface" style={[styles.aiCard, { borderColor: theme.border }]}>
        <ThemedText style={styles.questionTitle}>这本书如何推进？</ThemedText>
        <ThemedText type="small" themeColor="textMuted">选一种，后面只问这种结构真正需要的内容。</ThemedText>
        <View style={styles.kindPicker}>
          {options.map((option) => (
            <Pressable
              key={option.kind}
              onPress={() => handleStoryKindSelect(option.kind)}
              style={({ pressed }) => [
                styles.kindOption,
                { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.7 },
              ]}>
              <ThemedText type="smallBold">{option.title}</ThemedText>
              <ThemedText type="small" themeColor="textMuted">{option.hint}</ThemedText>
            </Pressable>
          ))}
        </View>
      </ThemedView>
    );
  }

  function renderWorkbenchInterview() {
    if (!storyKind) {
      return renderStoryKindPicker();
    }
    const progress = ((safeQuestionIndex + 1) / activeQuestions.length) * 100;
    return (
      <>
        <View style={styles.questionMeta}>
          <ThemedText type="small" themeColor="textMuted">
            第 {safeQuestionIndex + 1} / {activeQuestions.length} 问
          </ThemedText>
          <ThemedText type="small" themeColor={currentQuestion.required ? 'accent' : 'textMuted'}>
            {currentQuestion.required ? '必填' : '选填 · 可跳过'}
          </ThemedText>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.progressFill, { backgroundColor: theme.accent, width: `${progress}%` as DimensionValue }]} />
        </View>
        <ThemedView type="surface" style={[styles.aiCard, { borderColor: theme.border }]}>
          <ThemedText style={styles.questionTitle}>{currentQuestion.title}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">{currentQuestion.hint}</ThemedText>
          {renderQuestionInput(currentQuestion)}
        </ThemedView>
      </>
    );
  }

  return (
    <ThemedView decorated style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView
            ref={createScrollRef}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <View style={styles.headerTopRow}>
                <Pressable onPress={handleBack} style={styles.backButton}>
                  <ThemedText type="small" themeColor="accent">
                    {step === 1 ? (isWorkbenchCreation && storyKind ? '上一步' : '返回') : '上一步'}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setIsExitDialogOpen(true)}
                  style={({ pressed }) => [
                    styles.exitTopButton,
                    { borderColor: theme.border },
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="退出创建">
                  <ThemedText type="small" themeColor="textMuted">退出</ThemedText>
                </Pressable>
              </View>
              <ThemedText type="code" themeColor="accent">
                NOVEL STUDIO
              </ThemedText>
              <ThemedText type="title" style={styles.title}>
                {isWorkbenchCreation ? '创建小说项目' : '新建小说'}
              </ThemedText>
              <NovelCreateStepIndicator
                step={step}
                maxReachedStep={maxReachedStep}
                onStepPress={goToStep}
              />
            </View>

            {step === 1 ? (
              <View style={styles.stepBlock}>
                {showCreationWorkshop ? (
                  renderCreationWorkshop()
                ) : isWorkbenchCreation ? (
                  renderWorkbenchInterview()
                ) : (
                  <>
                    {!isWorkbenchCreation ? <NovelImagePickerField
                  label="封面图"
                  hint="可选。从手机相册选择一张图片作为列表封面。"
                  kind="cover"
                  uri={coverImageUri}
                  onChangeUri={setCoverImageUri}
                /> : null}
                {!isWorkbenchCreation ? <NovelImagePickerField
                  label="对话背景图"
                  hint="可选。安卓选择后可按 9:16 裁剪，避免进入对话后画面被遮掉；可调节不透明度。"
                  kind="background"
                  uri={chatBackgroundIsVideo ? undefined : chatBackgroundUri}
                  onChangeUri={setChatBackgroundUri}
                  opacity={chatBackgroundOpacity}
                  onChangeOpacity={setChatBackgroundOpacity}
                /> : null}
                {!isWorkbenchCreation ? <NovelVideoPickerField
                  uri={chatBackgroundIsVideo ? chatBackgroundUri : undefined}
                  onChangeUri={setChatBackgroundUri}
                /> : null}
                <NovelFormField
                  label="小说名称"
                  required
                  value={name}
                  placeholder="例如：雨夜旧城区"
                  onChangeText={setName}
                />
                  </>
                )}
              </View>
            ) : null}

            {step === 2 ? (
              <View style={styles.stepBlock}>
                {!isWorkbenchCreation ? <ThemedView type="surface" style={[styles.aiCard, { borderColor: theme.border }]}>
                  <View style={styles.aiHeader}>
                    <ThemedText type="smallBold">设定工具</ThemedText>
                    <View style={styles.aiActions}>
                      <Pressable
                        disabled={!canUndoFrameworkAi || isGeneratingFramework}
                        onPress={undoFrameworkAi}
                        style={({ pressed }) => [
                          styles.aiGhostButton,
                          {
                            borderColor: theme.border,
                            backgroundColor: theme.backgroundElement,
                            opacity: !canUndoFrameworkAi || isGeneratingFramework ? 0.4 : 1,
                          },
                          pressed && { opacity: 0.75 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="撤销上次 AI">
                        <ThemedText type="code" themeColor="accent">
                          撤销上次
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        disabled={isGeneratingFramework}
                        onPress={clearFrameworkAiFields}
                        style={({ pressed }) => [
                          styles.aiGhostButton,
                          {
                            borderColor: theme.border,
                            backgroundColor: theme.backgroundElement,
                          },
                          (pressed || isGeneratingFramework) && { opacity: 0.75 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="清空设定">
                        <ThemedText type="code" themeColor="accent">
                          清空设定
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                  <ThemedText type="small" themeColor="textMuted">
                    可手改下方各项。已填内容不会被 AI 覆盖（需先清空再重新生成）。
                  </ThemedText>
                </ThemedView> : null}

                {!isWorkbenchCreation ? <AccordionSection title="故事与执行方式" defaultOpen>
                  <NovelFormField
                    label="作品介绍"
                    value={workIntro}
                    placeholder="题材、氛围、主线方向、想要的玩法……越具体，AI 生成越准。这里用于生成与展示；采用 AI 整理后的创作设定才会注入对话提示词。"
                    multiline
                    minHeight={160}
                    onFocus={scrollCreateFieldIntoView}
                    onChangeText={setWorkIntro}
                  />
                  {ENABLE_QUICK_TRAVEL ? <View style={styles.switchRow}>
                    <View style={styles.switchCopy}>
                      <ThemedText type="smallBold">快穿模式</ThemedText>
                      <ThemedText type="small" themeColor="textMuted">
                        开启后保存系统设定、当前世界任务和原定剧情，支持后续扩展多个小世界。
                      </ThemedText>
                    </View>
                    <Switch
                      value={quickTravelEnabled}
                      onValueChange={setQuickTravelEnabled}
                      trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }}
                      thumbColor={quickTravelEnabled ? theme.accent : theme.textMuted}
                    />
                  </View> : null}
                  {ENABLE_QUICK_TRAVEL && quickTravelEnabled ? (
                    <>
                      <NovelFormField
                        label="系统名称"
                        value={quickTravelSystemName}
                        placeholder="例如：命运修正系统"
                        onChangeText={setQuickTravelSystemName}
                      />
                      <NovelFormField
                        label="全局快穿规则"
                        value={quickTravelGlobalRules}
                        placeholder="所有小世界共用的系统规则、奖励规则和记忆规则"
                        multiline
                        minHeight={120}
                        onChangeText={setQuickTravelGlobalRules}
                      />
                      <Pressable
                        disabled={isGeneratingQuickSystem || !name.trim()}
                        onPress={() => void handleQuickSystemAi()}
                        style={({ pressed }) => [
                          styles.aiButton,
                          { backgroundColor: theme.accent },
                          (pressed || isGeneratingQuickSystem || !name.trim()) && { opacity: 0.7 },
                        ]}>
                        <ThemedText type="smallBold" style={styles.aiButtonText}>
                          {isGeneratingQuickSystem ? '生成快穿系统中…' : '单独生成快穿系统与规则'}
                        </ThemedText>
                      </Pressable>
                    </>
                  ) : null}
                  <ThemedView type="surface" style={[styles.aiCard, { borderColor: theme.border }]}>
                    <View style={styles.aiHeader}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <ThemedText type="smallBold">AI 生成世界与规则</ThemedText>
                        <ThemedText type="small" themeColor="textMuted">
                          可选。根据名称与介绍自动生成世界名称、世界设定与游玩规则。主角请在后续「角色设定」中添加并生成。
                        </ThemedText>
                      </View>
                      <Pressable
                        disabled={isGeneratingFramework || !name.trim()}
                        onPress={() => {
                          void handleFrameworkAi();
                        }}
                        style={({ pressed }) => [
                          styles.aiButton,
                          { backgroundColor: theme.accent },
                          (pressed || isGeneratingFramework || !name.trim()) && { opacity: 0.75 },
                        ]}>
                        <ThemedText type="smallBold" style={styles.aiButtonText}>
                          {isGeneratingFramework ? '生成中…' : 'AI 生成'}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </ThemedView>
                </AccordionSection> : null}

                <AccordionSection title="角色设定" defaultOpen>
                  <NovelCastEditor
                    cast={cast}
                    novelName={name}
                    intro={workIntro}
                    appearanceId={characterCardAppearanceId}
                    framework={{
                      playerName,
                      playerPersona,
                      playerMotive,
                      ...playerProfile,
                      worldName,
                      worldEra,
                      worldConflict: '',
                      worldTone: '',
                      mainPlot: '',
                      initialStoryState: '',
                      gameRules,
                    }}
                    worldContext={
                      ENABLE_QUICK_TRAVEL && quickTravelEnabled && quickWorlds.length > 0
                        ? buildQuickTravelCharacterContext(quickWorlds[0])
                        : undefined
                    }
                    onChange={setCast}
                  />
                </AccordionSection>

                <AccordionSection title={ENABLE_QUICK_TRAVEL && quickTravelEnabled ? '主世界设定' : '世界设定'}>
                  <NovelFormField
                    label={ENABLE_QUICK_TRAVEL && quickTravelEnabled ? '主世界名称' : '世界名称'}
                    value={worldName}
                    placeholder="故事开展的世界/国家名"
                    onChangeText={setWorldName}
                  />
                  <NovelFormField
                    label={ENABLE_QUICK_TRAVEL && quickTravelEnabled ? '主世界设定' : '世界设定'}
                    value={worldEra}
                    placeholder="例：中世纪奇幻，科技低下，魔法昌盛；符文与元素魔法并存，高阶魔法师与战士主导社会。"
                    multiline
                    minHeight={140}
                    onFocus={scrollCreateFieldIntoView}
                    onChangeText={setWorldEra}
                  />
                </AccordionSection>

                {!isWorkbenchCreation && !(ENABLE_QUICK_TRAVEL && quickTravelEnabled) ? <AccordionSection title="游玩规则">
                  <NovelFormField
                    label="游玩规则"
                    value={gameRules}
                    placeholder="AI扮演角色时需要遵守的法则"
                    multiline
                    minHeight={120}
                    onFocus={scrollCreateFieldIntoView}
                    onChangeText={setGameRules}
                  />
                </AccordionSection> : null}
                {ENABLE_QUICK_TRAVEL && quickTravelEnabled ? (
                  <QuickTravelWorldDraftEditor
                    worlds={quickWorlds}
                    generatingWorldId={generatingQuickWorldId}
                    onAdd={() => setQuickWorlds((worlds) => [...worlds, { id: `world-draft-${Date.now()}`, name: '', generationBrief: '', worldEra: '', worldRules: '', mission: '', entryScene: '', originalPlot: { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' }, outline: createEmptyWorldOutline() }])}
                    onChange={updateQuickWorld}
                    onGenerate={handleQuickWorldAi}
                  />
                ) : null}
                {false && quickTravelEnabled ? (
                  <AccordionSection title="快穿世界剧情">
                    <NovelFormField
                      label="本世界任务"
                      value={worldMission}
                      placeholder="主角进入本世界后需要完成的任务"
                      multiline
                      minHeight={100}
                      onChangeText={setWorldMission}
                    />
                    <NovelFormField
                      label="原定剧情"
                      value={originalPlot}
                      placeholder="没有主角介入时，本世界原本会如何发展"
                      multiline
                      minHeight={180}
                      onChangeText={setOriginalPlot}
                    />
                    <NovelFormField
                      label="主角已知剧情"
                      value={originalPlotKnown}
                      placeholder="系统实际告诉主角的剧情，可只填写部分内容"
                      multiline
                      minHeight={140}
                      onChangeText={setOriginalPlotKnown}
                    />
                    <NovelFormField
                      label="原定结局"
                      value={originalEnding}
                      placeholder="没有主角介入时的原定结局"
                      multiline
                      minHeight={120}
                      onChangeText={setOriginalEnding}
                    />
                  </AccordionSection>
                ) : null}
              </View>
            ) : null}

            {step === 3 ? (
              <View style={styles.stepBlock}>
                <ThemedView type="surface" style={[styles.aiCard, { borderColor: theme.border }]}>
                  <ThemedText type="smallBold">模型与选项</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    编辑默认提示词与可选文风，并设定行动预测。正文跟随系统写作模型；记忆提示词在「小说配置」，卡面款式可在角色知识库切换。
                  </ThemedText>
                </ThemedView>

                <ThemedView
                  type="surface"
                  style={[
                    styles.promptSelectCard,
                    { borderColor: theme.accent, backgroundColor: theme.accentMuted },
                  ]}>
                  <View style={styles.promptSelectHeader}>
                    <ThemedText type="smallBold">提示词方案</ThemedText>
                    <ThemedText type="code" themeColor="accent">
                      默认提示词 / 文风
                    </ThemedText>
                  </View>
                  <NovelSystemPromptEditor />
                  <Pressable
                    onPress={() => router.push('/(tabs)/novel-settings' as Href)}
                    style={({ pressed }) => [
                      styles.aiGhostButton,
                      {
                        alignSelf: 'flex-start',
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                      pressed && { opacity: 0.75 },
                    ]}>
                    <ThemedText type="code" themeColor="accent">
                      前往小说配置 · 记忆提示词
                    </ThemedText>
                  </Pressable>
                </ThemedView>

                <View style={styles.switchRow}>
                  <View style={styles.switchCopy}>
                    <ThemedText type="smallBold">行动预测</ThemedText>
                    <ThemedText type="small" themeColor="textMuted">
                      开启后每轮给出行动预测（ABCD），气泡内可点选。
                    </ThemedText>
                  </View>
                  <Switch
                    value={autoSuggestRoutes}
                    onValueChange={setAutoSuggestRoutes}
                    trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }}
                    thumbColor={autoSuggestRoutes ? theme.accent : theme.textMuted}
                  />
                </View>
              </View>
            ) : null}

            {formError ? (
              <ThemedText type="small" themeColor="accent">
                {formError}
              </ThemedText>
            ) : null}
          </ScrollView>

          {!showCreationWorkshop ? <View
            style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            {step < 3 ? (
              <View style={styles.footerActions}>
                {step === 1 && isWorkbenchCreation && !isPickingStoryKind && !currentQuestion.required && !isLastWorkbenchQuestion ? (
                  <Pressable
                    onPress={handleFooterNext}
                    style={({ pressed }) => [
                      styles.skipButton,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" themeColor="textMuted">
                      跳过
                    </ThemedText>
                  </Pressable>
                ) : null}
                {!isPickingStoryKind ? (
                  <Pressable
                    onPress={handleFooterNext}
                    style={({ pressed }) => [
                      styles.saveButton,
                      { flex: 1, backgroundColor: theme.accent },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" style={styles.saveButtonText}>
                      {step === 1 && isWorkbenchCreation && !isLastWorkbenchQuestion ? '继续' : '下一步'}
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <Pressable
                onPress={handlePublish}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: theme.accent },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={styles.saveButtonText}>
                  创建小说
                </ThemedText>
              </Pressable>
            )}
          </View> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal
        visible={isExitDialogOpen}
        transparent
        animationType="fade"
        onRequestClose={dismissExitDialog}
        statusBarTranslucent>
        <Pressable style={styles.exitOverlay} onPress={dismissExitDialog}>
          <Pressable
            style={[styles.exitCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() => undefined}>
            <ThemedText type="smallBold" style={styles.exitTitle}>
              退出新建小说
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              是否保存为草稿？未创建的内容可稍后从书架继续完善。
            </ThemedText>
            <View style={styles.exitActions}>
              <Pressable
                onPress={dismissExitDialog}
                style={({ pressed }) => [
                  styles.exitButton,
                  { borderColor: theme.border },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  取消
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={handleExitDiscard}
                style={({ pressed }) => [
                  styles.exitButton,
                  { borderColor: theme.border },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="accent">
                  不保存
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={handleExitSaveDraft}
                style={({ pressed }) => [
                  styles.exitPrimaryButton,
                  { backgroundColor: theme.accent },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={styles.saveButtonText}>
                  保存草稿
                </ThemedText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

export default function NovelCreateRoute() {
  const params = useLocalSearchParams();
  const draftId = Array.isArray(params.draftId) ? params.draftId[0] : params.draftId;

  // Existing shelf drafts still use the legacy editor until they are
  // published. Fresh projects enter the smaller creation module.
  return draftId
    ? <CreateNovelScreen guidedCreation={false} />
    : <NewNovelCreationScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.two,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
  },
  exitTopButton: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 36,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 36,
    lineHeight: 40,
  },
  stepBlock: {
    gap: Spacing.three,
  },
  workshopBlock: {
    gap: Spacing.three,
  },
  inspirationPanel: {
    borderWidth: 1,
    borderRadius: 22,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  inspirationHeading: {
    flex: 1,
    gap: 4,
  },
  inspirationList: {
    gap: Spacing.two,
  },
  inspirationCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  inspirationCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  inspirationCardTitle: {
    flex: 1,
    gap: 3,
  },
  inspirationUseButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workshopIntroTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  workshopProgressMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workshopQuestionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  workshopResultCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  workshopResultActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  workshopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  workshopManualButton: {
    alignSelf: 'center',
    paddingVertical: Spacing.one,
  },
  aiCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  aiActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  required: {
    color: '#c45c3a',
    fontWeight: '700',
  },
  aiGhostButton: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 36,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiButton: {
    borderRadius: 16,
    minHeight: 36,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiButtonText: {
    color: '#120c09',
  },
  aiInput: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 110,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  switchCopy: {
    flex: 1,
    gap: 2,
  },
  field: {
    gap: Spacing.two,
  },
  promptSelectCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  promptSelectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#120c09',
  },
  pressed: {
    opacity: 0.75,
  },
  exitOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    backgroundColor: 'rgba(23, 18, 15, 0.35)',
  },
  exitCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  exitTitle: {
    fontSize: 18,
  },
  exitActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  exitButton: {
    minHeight: 40,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitPrimaryButton: {
    minHeight: 40,
    borderRadius: 18,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  questionTitle: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  skipButton: {
    minHeight: 52,
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindPicker: {
    gap: Spacing.two,
  },
  kindOption: {
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: 4,
  },
});
