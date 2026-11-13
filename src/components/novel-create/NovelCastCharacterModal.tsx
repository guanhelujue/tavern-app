import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CharacterPortraitPickerModal } from '@/components/CharacterPortraitPickerModal';
import {
  DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
  getCharacterCardAppearance,
} from '@/constants/character-card-appearances';
import { Spacing } from '@/constants/theme';
import { CharacterDossierBook } from '@/features/character-dossier-v2/CharacterDossierBook';
import { normalizeCharacterAiSummary } from '@/features/character-dossier-v2/ai-summary';
import { diagnoseCharacterDossier } from '@/features/character-dossier-v2/diagnostics';
import { normalizeCharacterDossierV2 } from '@/features/character-dossier-v2/model';
import { applyPortraitFieldProposals } from '@/features/character-dossier-v2/portrait-proposal';
import {
  createEmptyCastCharacter,
  generateNovelCastCharacter,
  type NovelFrameworkDraft,
} from '@/services/novel-create-ai';
import {
  analyzeCharacterPortrait,
  type CharacterPortraitAnalysisResult,
} from '@/services/character-portrait-analysis';
import { generateCharacterBiography } from '@/services/character-biography-generation';
import {
  loadCharacterBiographies,
  saveCharacterBiographies,
} from '@/services/character-biography-storage';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import type {
  NovelCastCharacter,
  NovelCharacterBiography,
} from '@/types/tavern';
import { buildCharacterPortraitPrompt } from '@/utils/character-card-portraits';
import type { PortraitFocus } from '@/utils/portrait-focus';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { normalizeCastPrivacyFields } from '@/utils/novel-dossiers';
import { resolveCharacterCardUiTheme } from '@/utils/character-card-ui-theme';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StatusBar } from 'expo-status-bar';

const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 420;
type CharacterSheetPage = 0 | 1 | 2;

type NovelCastCharacterModalProps = {
  visible: boolean;
  initial?: NovelCastCharacter | null;
  /** 定稿经历 — injected; filled on scene end (or manual). Never by cast AI. */
  initialExperience?: string;
  novelName: string;
  intro: string;
  framework: Omit<NovelFrameworkDraft, 'cast'>;
  /** Other characters on this novel — AI uses them for anti-clone. */
  existingCast?: NovelCastCharacter[];
  novelId?: string;
  onClose: () => void;
  onSave: (character: NovelCastCharacter, experience: string) => void;
  /** Require a name before confirm (knowledge-base flow). */
  requireName?: boolean;
  /** Novel-level appearance id; drives edit-panel chrome. */
  appearanceId?: string | null;
  /** Full active quick-travel world context for character generation. */
  worldContext?: string;
};

export function NovelCastCharacterModal({
  visible,
  initial,
  initialExperience = '',
  novelName,
  intro,
  framework,
  existingCast = [],
  novelId,
  onClose,
  onSave,
  requireName = false,
  appearanceId,
  worldContext,
}: NovelCastCharacterModalProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const colorScheme = useColorScheme();
  const { width: windowWidth } = useWindowDimensions();
  const compactWorkspace = windowWidth < 760;
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const writingExtensions = useTavernStore((state) => state.contentStyleSettings);
  const recordNovelContinuationUsage = useTavernStore((state) => state.recordNovelContinuationUsage);
  const [draft, setDraft] = useState<NovelCastCharacter>(createEmptyCastCharacter());
  const [experienceText, setExperienceText] = useState('');
  const [aiBrief, setAiBrief] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzingPortrait, setIsAnalyzingPortrait] = useState(false);
  const [portraitProposal, setPortraitProposal] = useState<CharacterPortraitAnalysisResult | null>(null);
  const [selectedPortraitPaths, setSelectedPortraitPaths] = useState<string[]>([]);
  const [canUndoAi, setCanUndoAi] = useState(false);
  const [sheetPage, setSheetPage] = useState<CharacterSheetPage>(0);
  /** Existing named card → AI panel collapsed by default (cleaner edit). */
  const [isExistingCharacter, setIsExistingCharacter] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [portraitPickerOpen, setPortraitPickerOpen] = useState(false);
  const [portraitTarget, setPortraitTarget] = useState<'public' | 'private'>('public');
  const [biographyGeneratingId, setBiographyGeneratingId] = useState<string | null>(null);
  const [biographyStorageBusy, setBiographyStorageBusy] = useState(false);
  const [consoleReveal] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));
  const aiSnapshotRef = useRef<NovelCastCharacter | null>(null);
  const sheetPageRef = useRef<CharacterSheetPage>(0);
  const draftRef = useRef(draft);
  const experienceTextRef = useRef(experienceText);
  const bodyScrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    sheetPageRef.current = sheetPage;
    draftRef.current = draft;
    experienceTextRef.current = experienceText;
  }, [draft, experienceText, sheetPage]);

  useEffect(() => {
    consoleReveal.stopAnimation();
    if (!visible) {
      consoleReveal.setValue(0);
      return;
    }
    if (!motionEnabled) {
      consoleReveal.setValue(1);
      return;
    }
    consoleReveal.setValue(0);
    Animated.spring(consoleReveal, {
      toValue: 1,
      damping: 19,
      stiffness: 132,
      mass: 0.78,
      useNativeDriver: true,
    }).start();
  }, [consoleReveal, motionEnabled, visible]);

  const resolvedAppearance = useMemo(
    () => getCharacterCardAppearance(appearanceId ?? DEFAULT_CHARACTER_CARD_APPEARANCE_ID),
    [appearanceId],
  );

  const chrome = useMemo(() => {
    const appearanceChrome = resolveCharacterCardUiTheme(resolvedAppearance.id);
    if (Platform.OS === 'web') return appearanceChrome;
    return {
      ...appearanceChrome,
      background: theme.background,
      border: theme.border,
      accent: theme.primary,
      accentContrast: theme.onPrimary,
      text: theme.text,
      textMuted: theme.textMuted,
      label: theme.textMuted,
      inputBackground: theme.backgroundElement,
      inputBorder: theme.border,
      stamp: theme.primary,
      stampBackground: theme.primaryContainer,
      headerTitle: theme.text,
      headerSubtitle: theme.textMuted,
      headerBorder: theme.border,
      panelRadius: 12,
      inputRadius: 12,
    };
  }, [resolvedAppearance.id, theme]);

  const activeDossierV2 = useMemo(
    () => normalizeCharacterDossierV2(draft.dossierV2, draft),
    [draft],
  );
  const dossierDiagnostics = useMemo(
    () => diagnoseCharacterDossier({
      character: draft,
      dossier: activeDossierV2,
      otherCharacters: existingCast,
    }),
    [activeDossierV2, draft, existingCast],
  );

  const portraitPromptInput = useMemo(
    () => ({
        name: draft.name,
        age: draft.age,
        height: draft.height,
        weight: draft.weight,
        bodyFat: activeDossierV2.public.bodyFat,
        appearance: draft.appearance,
        privateBody: activeDossierV2.private,
      }),
    [
      activeDossierV2.private,
      activeDossierV2.public.bodyFat,
      draft.age,
      draft.appearance,
      draft.height,
      draft.name,
      draft.weight,
    ],
  );
  const portraitPrompt = useMemo(
    () => buildCharacterPortraitPrompt(portraitPromptInput),
    [portraitPromptInput],
  );

  function applyPortraitUri(uri: string | undefined, portraitFocus?: PortraitFocus) {
    const current = draftRef.current;
    const normalizedUri = uri?.trim() || undefined;
    const next = portraitTarget === 'private'
      ? {
          ...current,
          dossierV2: {
            ...normalizeCharacterDossierV2(current.dossierV2, current),
            private: {
              ...normalizeCharacterDossierV2(current.dossierV2, current).private,
              portraitUri: normalizedUri,
              portraitFocus: normalizedUri ? portraitFocus : undefined,
            },
          },
        }
      : {
          ...current,
          portraitUri: normalizedUri,
          portraitFocus: normalizedUri ? portraitFocus : undefined,
    };
    setDraft(next);
  }

  function openPortraitPicker(target: 'public' | 'private') {
    setPortraitTarget(target);
    setPortraitPickerOpen(true);
  }

  useEffect(() => {
    if (visible) {
      let cancelled = false;
      const empty = createEmptyCastCharacter();
      const base = initial ?? empty;
      const privacy = normalizeCastPrivacyFields(base.privacy);
      const nextDraftBase: NovelCastCharacter = {
        ...empty,
        ...base,
        id: base.id || empty.id,
        height: base.height ?? '',
        weight: base.weight ?? '',
        birthplace: base.birthplace ?? '',
        affiliation: base.affiliation ?? '',
        isProtagonist: base.isProtagonist === true,
        motive: base.motive ?? '',
        strengths: base.strengths ?? '',
        weaknesses: base.weaknesses ?? '',
        relations: base.relations,
        habits: '',
        secrets: '',
        notes: '',
        biographies: novelId ? undefined : base.biographies,
        ...(privacy ? { privacy } : { privacy: undefined }),
      };
      const nextDraft: NovelCastCharacter = {
        ...nextDraftBase,
        ...(base.dossierV2
          ? { dossierV2: normalizeCharacterDossierV2(base.dossierV2, nextDraftBase) }
          : { dossierV2: undefined }),
      };
      const timer = setTimeout(() => {
         setDraft(nextDraft);
         setExperienceText(initialExperience);
        setAiBrief('');
        setIsGenerating(false);
        setIsAnalyzingPortrait(false);
        setPortraitProposal(null);
        setSelectedPortraitPaths([]);
        setBiographyGeneratingId(null);
        const biographyOwner = novelId && nextDraft.id
          ? { novelId, characterId: nextDraft.id }
          : null;
        setBiographyStorageBusy(Boolean(biographyOwner));
        if (biographyOwner) {
          void loadCharacterBiographies(biographyOwner)
            .then((biographies) => {
              if (cancelled) return;
              setDraft((current) => current.id === nextDraft.id
                ? { ...current, biographies: biographies.length ? biographies : undefined }
                : current);
            })
            .catch((error) => {
              if (cancelled) return;
              showAppAlert(
                '小传读取失败',
                error instanceof Error ? error.message : '暂时无法读取人物小传。',
              );
            })
            .finally(() => {
              if (!cancelled) setBiographyStorageBusy(false);
            });
        }
        aiSnapshotRef.current = null;
        setCanUndoAi(false);
         setSheetPage(0);
         setPortraitTarget('public');
        const existing = Boolean(base.name?.trim());
        setIsExistingCharacter(existing);
        setAiPanelOpen(!existing);
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }
   }, [initial, initialExperience, novelId, visible]);

  useEffect(() => {
    if (visible) {
      bodyScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [sheetPage, visible]);

  const flipTo = useCallback((target: CharacterSheetPage) => {
    if (
      sheetPageRef.current === target
    ) {
      return;
    }
    setSheetPage(target);
    sheetPageRef.current = target;
  }, []);

  /** 固定页顺序：公开 → 私密 → 人物小传。 */
  const handleSwipeFlip = useCallback(
    (direction: 'left' | 'right') => {
      setSheetPage((current) => {
        const pages: CharacterSheetPage[] = [0, 1, 2];
        const currentIndex = Math.max(0, pages.indexOf(current));
        const targetIndex = direction === 'left'
          ? Math.min(pages.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
        const target = pages[targetIndex];
        if (current === target) {
          return current;
        }
        sheetPageRef.current = target;
        return target;
      });
    },
    [],
  );

  const pageSwipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(true)
        .activeOffsetX([-28, 28])
        .failOffsetY([-14, 14])
        .onEnd((event) => {
          'worklet';
          if (
            event.translationX <= -SWIPE_DISTANCE ||
            event.velocityX <= -SWIPE_VELOCITY
          ) {
            runOnJS(handleSwipeFlip)('left');
            return;
          }
          if (
            event.translationX >= SWIPE_DISTANCE ||
            event.velocityX >= SWIPE_VELOCITY
          ) {
            runOnJS(handleSwipeFlip)('right');
          }
        }),
    [handleSwipeFlip],
  );

  function updateField<K extends keyof NovelCastCharacter>(key: K, value: NovelCastCharacter[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function clearAiFillableFields() {
    const empty = createEmptyCastCharacter();
    const hasContent = [
      draft.name,
      ...(draft.aliases ?? []),
      draft.profession,
      draft.age,
      draft.gender,
      draft.height,
      draft.weight,
      draft.appearance,
      draft.personality,
      draft.speechStyle,
      draft.background,
      draft.motive,
      draft.strengths,
      draft.weaknesses,
    ].some((value) => (value ?? '').trim());

    if (!hasContent) {
      return;
    }

    aiSnapshotRef.current = { ...draft };
    const nextDraft: NovelCastCharacter = {
      ...empty,
      id: draft.id,
      isProtagonist: draft.isProtagonist === true,
      habits: '',
      secrets: '',
      notes: '',
      privacy: draft.privacy,
      portraitUri: draft.portraitUri,
      portraitFocus: draft.portraitFocus,
      dossierV2: draft.dossierV2,
      biographies: draft.biographies,
    };
    setDraft(nextDraft);
    setCanUndoAi(true);
  }

  function undoLastAi() {
    const snapshot = aiSnapshotRef.current;
    if (!snapshot) {
      return;
    }

    setDraft(snapshot);
    aiSnapshotRef.current = null;
    setCanUndoAi(false);
  }

  async function handleAiGenerate() {
    if (isGenerating || isAnalyzingPortrait) {
      return;
    }

    setIsGenerating(true);

    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        task: 'character', purpose: 'utility',
      });

      if (
        !apiSettings.apiKey.trim()
      ) {
        showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
        return;
      }

      aiSnapshotRef.current = { ...draft };

      const liveNovel = novelId
        ? useTavernStore.getState().novels.find((item) => item.id === novelId)
        : undefined;
      const next = await generateNovelCastCharacter({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        novelName,
        intro,
        framework,
        current: draft,
        existingCast,
        userBrief: aiBrief,
        nsfwEnabled: true,
        styleProfile: liveNovel?.novelStoryAnalysis?.styleProfile,
        worldContext,
        // 默认走单次快速生成；质量复核应由显式操作触发，避免阻塞角色卡返回。
        enableQualityAudit: false,
        onUsage: (usage) => {
          if (novelId && usage.completionTokens > 0) {
            recordNovelContinuationUsage(novelId, 'create-cast', usage.completionTokens);
          }
        },
      });

      setDraft(next);
      setCanUndoAi(true);
    } catch (error) {
      aiSnapshotRef.current = null;
      setCanUndoAi(false);
      showAppAlert('生成失败', error instanceof Error ? error.message : '无法生成角色设定。');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAnalyzePortrait(target: 'public' | 'private') {
    if (isGenerating || isAnalyzingPortrait) {
      return;
    }

    const current = draftRef.current;
    const dossier = normalizeCharacterDossierV2(current.dossierV2, current);
    const imageUri = target === 'private'
      ? dossier.private.portraitUri?.trim()
      : current.portraitUri?.trim();
    if (!imageUri) {
      showAppAlert(
        target === 'private' ? '缺少私密照' : '缺少日常照',
        target === 'private'
          ? '请先在私密档案中上传、选择或生成一张私密照。'
          : '请先在公开档案中上传、选择或生成一张日常立绘。',
      );
      return;
    }

    setIsAnalyzingPortrait(true);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        task: 'character', purpose: 'utility',
      });
      if (!apiSettings.apiKey.trim()) {
        showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
        return;
      }

      const result = await analyzeCharacterPortrait({
        apiSettings,
        imageUri,
        current,
        novelName,
        worldContext:
          worldContext
          || [framework.worldName, framework.worldEra, framework.worldTone, framework.gameRules]
            .filter(Boolean)
            .join('\n'),
        userInstruction: aiBrief,
        nsfwEnabled: true,
        target,
      });
      const usedTokens = result.promptTokens + result.completionTokens;
      if (novelId && usedTokens > 0) {
        recordNovelContinuationUsage(novelId, 'create-cast-vision', usedTokens);
      }
      if (!result.changes.length) {
        showAppAlert('没有可补全字段', '图片分析已完成，但当前档案没有可安全补入的空白字段。');
        return;
      }
      setPortraitProposal(result);
      setSelectedPortraitPaths(result.changes.map((change) => change.path));
    } catch (error) {
      aiSnapshotRef.current = null;
      setCanUndoAi(false);
      showAppAlert(
        '识图补全失败',
        error instanceof Error
          ? error.message
          : '无法读取图片。请确认辅助模型支持视觉输入。',
      );
    } finally {
      setIsAnalyzingPortrait(false);
    }
  }

  function applyPortraitProposal() {
    if (!portraitProposal || !selectedPortraitPaths.length) return;
    const current = draftRef.current;
    aiSnapshotRef.current = { ...current };
    setDraft(applyPortraitFieldProposals(
      current,
      portraitProposal.character,
      selectedPortraitPaths,
    ));
    setCanUndoAi(true);
    setPortraitProposal(null);
    setSelectedPortraitPaths([]);
  }

  function togglePortraitProposal(path: string) {
    setSelectedPortraitPaths((current) => current.includes(path)
      ? current.filter((item) => item !== path)
      : [...current, path]);
  }

  async function handleBiographyGenerate(request: string, biographyId?: string) {
    if (biographyGeneratingId) return false;
    const authorRequest = request.trim();
    if (!authorRequest) {
      showAppAlert('还没有创作要求', '先写下这篇小传里想看的内容。');
      return false;
    }

    const generatingKey = biographyId ?? 'new';
    setBiographyGeneratingId(generatingKey);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        task: 'character', purpose: 'utility',
      });
      if (!apiSettings.apiKey.trim()) {
        showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
        return false;
      }
      const current = draftRef.current;
      const dossierV2 = normalizeCharacterDossierV2(current.dossierV2, current);
      const result = await generateCharacterBiography({
        apiSettings,
        character: current,
        dossier: dossierV2,
        request: authorRequest,
        nsfwEnabled: true,
        writingExtensions,
        maxTokens: generationSettings.novelCreateMaxTokens,
      });
      const timestamp = new Date().toISOString();
      setDraft((live) => {
        const existing = live.biographies ?? [];
        const biographies: NovelCharacterBiography[] = biographyId
          ? existing.map((entry) => entry.id === biographyId
            ? {
                ...entry,
                title: result.title,
                content: result.content,
                request: authorRequest,
                updatedAt: timestamp,
              }
            : entry)
          : [
              ...existing,
              {
                id: `biography-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: result.title,
                request: authorRequest,
                content: result.content,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ];
        return { ...live, biographies };
      });
      const usedTokens = result.promptTokens + result.completionTokens;
      if (novelId && usedTokens > 0) {
        recordNovelContinuationUsage(novelId, 'create-character-biography', usedTokens);
      }
      if (result.truncated || result.usedRawResponse) {
        showAppAlert(
          result.truncated ? '小传尚未生成完整' : '小传原文已保留',
          [
            result.truncated
              ? '模型因输出长度上限停止，已保留全部收到的内容。可在系统设置中调高「AI 创作长度上限」（需在模型支持范围内），或缩短本次篇幅后重试。'
              : '',
            result.usedRawResponse ? '未能自动拆分标题和正文，完整原始返回已放入小传正文，供你自行整理。' : '',
            '可直接编辑标题和正文，整理后请保存角色。',
          ].filter(Boolean).join('\n\n'),
        );
      }
      return true;
    } catch (error) {
      showAppAlert(
        '小传生成失败',
        error instanceof Error ? error.message : '无法生成这篇小传，请稍后重试。',
      );
      return false;
    } finally {
      setBiographyGeneratingId(null);
    }
  }

  function handleBiographyUpdate(
    biographyId: string,
    patch: Partial<Pick<NovelCharacterBiography, 'title' | 'content'>>,
  ) {
    setDraft((current) => ({
      ...current,
      biographies: (current.biographies ?? []).map((entry) => entry.id === biographyId
        ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
        : entry),
    }));
  }

  async function handleBiographyDelete(biographyId: string) {
    if (biographyGeneratingId) return;
    const confirmed = await confirmAppAction(
      '移出人物小传',
      '这篇小传将被永久删除，且不会影响正文或人物设定。',
      { confirmLabel: '删除' },
    );
    if (!confirmed) return;
    setDraft((current) => {
      const biographies = (current.biographies ?? []).filter((entry) => entry.id !== biographyId);
      return { ...current, biographies: biographies.length ? biographies : undefined };
    });
  }

  async function handleConfirm() {
    if (biographyGeneratingId || biographyStorageBusy) {
      showAppAlert('小传仍在创作', '请等待生成完成后再保存角色。');
      return;
    }
    // 使用 draftRef，避免闭包拿到未含最新 portraitUri 的旧 draft
    const current = draftRef.current;
    const privacy = normalizeCastPrivacyFields(current.privacy);

    const normalizedBase = {
      ...current,
      name: current.name.trim(),
      profession: current.profession.trim(),
      age: current.age.trim(),
      gender: current.gender.trim(),
      height: current.height.trim(),
      weight: current.weight.trim(),
      birthplace: current.birthplace?.trim() ?? '',
      affiliation: current.affiliation?.trim() ?? '',
      appearance: current.appearance.trim(),
      personality: current.personality.trim(),
      speechStyle: current.speechStyle.trim(),
      background: current.background.trim(),
      isProtagonist: current.isProtagonist === true,
      motive: current.motive?.trim() ?? '',
      strengths: current.strengths?.trim() ?? '',
      weaknesses: current.weaknesses?.trim() ?? '',
      relations: current.relations?.length ? current.relations : undefined,
      habits: '',
      secrets: '',
      notes: '',
      portraitUri: current.portraitUri?.trim() || undefined,
      ...(current.portraitFocus ? { portraitFocus: current.portraitFocus } : {}),
      ...(privacy ? { privacy } : { privacy: undefined }),
      dossierV2: normalizeCharacterDossierV2(current.dossierV2, current),
    };
    const next = {
      ...normalizedBase,
      // Saving this shared editor makes the card author-maintained, including
      // cards originally extracted from an imported novel.
      generatedFromReply: false,
      aiSummary: normalizeCharacterAiSummary(
        current.aiSummary,
        normalizedBase,
        normalizedBase.dossierV2,
      ),
    };

    if (requireName && !next.name) {
      showAppAlert('缺少姓名', '请填写角色姓名。');
      return;
    }

    if (novelId) {
      setBiographyStorageBusy(true);
      try {
        await saveCharacterBiographies(
          { novelId, characterId: next.id },
          next.biographies ?? [],
        );
      } catch (error) {
        setBiographyStorageBusy(false);
        showAppAlert(
          '小传保存失败',
          error instanceof Error ? error.message : '人物小传未能写入独立存储。',
        );
        return;
      }
      setBiographyStorageBusy(false);
      const { biographies: _biographies, ...characterWithoutBiographies } = next;
      onSave(characterWithoutBiographies, experienceTextRef.current.trim());
      return;
    }

    onSave(next, experienceTextRef.current.trim());
  }

  const analysisTarget = sheetPage === 1 ? 'private' : 'public';
  const analysisImageUri = analysisTarget === 'private'
    ? activeDossierV2.private.portraitUri?.trim()
    : draft.portraitUri?.trim();
  const showAiPanel = Platform.OS === 'web'
    ? (sheetPage === 0 && (!isExistingCharacter || aiPanelOpen)) || sheetPage === 1
    : sheetPage !== 2 && aiPanelOpen;
  const showPageNavigationButtons = Platform.OS === 'web';
  const aiBusy = isGenerating || isAnalyzingPortrait;

  const editorBlock = (
    <>
      {showAiPanel ? (
        <View
          style={[
            styles.aiCard,
            {
              borderColor: chrome.border,
              backgroundColor: chrome.inputBackground,
              borderRadius: chrome.panelRadius,
            },
          ]}>
          <View style={styles.aiHeader}>
            <Text style={[styles.aiTitle, { color: chrome.text }]}>
              {analysisTarget === 'private' ? '私密照补全' : 'AI 补全'}
            </Text>
            <View style={styles.aiActions}>
              {isExistingCharacter && analysisTarget === 'public' ? (
                <Pressable
                  onPress={() => setAiPanelOpen(false)}
                  hitSlop={8}
                  style={({ pressed }) => [pressed && { opacity: 0.55 }]}>
                  <Text style={[styles.aiGhostText, { color: chrome.textMuted }]}>收起</Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={aiBusy || !analysisImageUri}
                onPress={() => {
                  void handleAnalyzePortrait(analysisTarget);
                }}
                style={({ pressed }) => [
                  styles.aiGhostButton,
                  {
                    borderColor: chrome.inputBorder,
                    backgroundColor: chrome.background,
                    opacity: aiBusy || !analysisImageUri ? 0.4 : 1,
                    borderRadius: chrome.inputRadius,
                  },
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={analysisTarget === 'private' ? '根据私密照补全私密档案' : '根据日常照补全公开档案'}>
                <Text style={[styles.aiGhostText, { color: chrome.accent }]}>
                  {isAnalyzingPortrait
                    ? '识图中…'
                    : analysisTarget === 'private'
                      ? '私密照识图'
                      : '日常照识图'}
                </Text>
              </Pressable>
              <Pressable
                disabled={!canUndoAi || aiBusy}
                onPress={undoLastAi}
                style={({ pressed }) => [
                  styles.aiGhostButton,
                  {
                    borderColor: chrome.inputBorder,
                    backgroundColor: chrome.background,
                    opacity: !canUndoAi || aiBusy ? 0.4 : 1,
                    borderRadius: chrome.inputRadius,
                  },
                  pressed && { opacity: 0.75 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="撤销上次 AI">
                <Text style={[styles.aiGhostText, { color: chrome.accent }]}>撤销上次</Text>
              </Pressable>
              {analysisTarget === 'public' ? <Pressable
                disabled={aiBusy}
                onPress={clearAiFillableFields}
                style={({ pressed }) => [
                  styles.aiGhostButton,
                  {
                    borderColor: chrome.inputBorder,
                    backgroundColor: chrome.background,
                    borderRadius: chrome.inputRadius,
                  },
                  (pressed || aiBusy) && { opacity: 0.75 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="清空角色设定">
                <Text style={[styles.aiGhostText, { color: chrome.accent }]}>清空设定</Text>
              </Pressable> : null}
              {analysisTarget === 'public' ? <Pressable
                disabled={aiBusy}
                onPress={() => {
                  void handleAiGenerate();
                }}
                style={({ pressed }) => [
                  styles.aiButton,
                  {
                    backgroundColor: chrome.accent,
                    borderRadius: chrome.inputRadius,
                  },
                  (pressed || aiBusy) && { opacity: 0.75 },
                ]}>
                <Text style={[styles.aiButtonText, { color: chrome.accentContrast }]}>
                  {isGenerating ? '生成中…' : 'AI 生成'}
                </Text>
              </Pressable> : null}
            </View>
          </View>
          <TextInput
            value={aiBrief}
            onChangeText={setAiBrief}
            multiline
            placeholder={analysisTarget === 'private'
              ? '可补充只适用于私密档案的说明；已有非空字段不会覆盖'
              : '可描述定位、气质反差等；AI 会避开已有角色，尽量拉大差分'}
            placeholderTextColor={chrome.textMuted}
            textAlignVertical="top"
            style={[
              styles.aiInput,
              {
                backgroundColor: chrome.background,
                borderColor: chrome.inputBorder,
                color: chrome.text,
                borderRadius: chrome.inputRadius,
              },
            ]}
          />
          <Text style={[styles.aiSourceHint, { color: chrome.textMuted }]}>
            {analysisTarget === 'private'
              ? '只读取私密照并只补全私密档案；图中可见内容标为“图片可见”，偏好、反应等非可见内容标为“设定推断”。已有非空字段不会覆盖。'
              : '只读取日常照并只补全公开档案；不会再从日常照生成或推断私密内容。已有非空字段不会覆盖。'}
          </Text>
        </View>
      ) : null}
      {dossierDiagnostics.length ? (
        <View
          style={[
            styles.diagnosticPanel,
            { borderColor: chrome.inputBorder, backgroundColor: chrome.inputBackground },
          ]}>
          <View style={styles.diagnosticHeader}>
            <Text style={[styles.diagnosticEyebrow, { color: chrome.accent }]}>CONSISTENCY SCAN</Text>
            <Text style={[styles.diagnosticCount, { color: chrome.textMuted }]}>发现 {dossierDiagnostics.length} 项待确认</Text>
          </View>
          <View style={styles.diagnosticList}>
            {dossierDiagnostics.map((diagnostic, index) => (
              <View key={`${diagnostic.code}-${index}`} style={styles.diagnosticRow}>
                <View
                  style={[
                    styles.diagnosticSignal,
                    {
                      backgroundColor: diagnostic.severity === 'warning'
                        ? '#b94a43'
                        : chrome.accent,
                    },
                  ]}
                />
                <Text style={[styles.diagnosticText, { color: chrome.text }]}>
                  {diagnostic.message}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.diagnosticFootnote, { color: chrome.textMuted }]}>仅提示，不会自动覆盖你的设定。</Text>
        </View>
      ) : null}
      <GestureDetector gesture={pageSwipeGesture}>
        <View collapsable={false}>
          <CharacterDossierBook
            appearanceId={resolvedAppearance.id}
            page={
              sheetPage === 0
                ? 'public'
                : sheetPage === 1
                  ? 'private'
                  : 'biography'
            }
            draft={draft}
            dossier={activeDossierV2}
            onDraftChange={updateField}
            onDossierChange={(dossierV2) => {
              setDraft((current) => ({ ...current, dossierV2 }));
            }}
            onImageRequest={openPortraitPicker}
            biographyGeneratingId={biographyStorageBusy ? 'storage' : biographyGeneratingId}
            onBiographyGenerate={handleBiographyGenerate}
            onBiographyUpdate={handleBiographyUpdate}
            onBiographyDelete={(biographyId) => {
              void handleBiographyDelete(biographyId);
            }}
          />
        </View>
      </GestureDetector>

      {sheetPage === 0 ? (
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={[styles.switchLabel, { color: chrome.text }]}>是否主角</Text>
            <Text style={[styles.sectionHint, { color: chrome.textMuted }]}>
              可勾选多名（如男女主）。主角人设会始终带入叙事；配角则提到名字时才会带上。
            </Text>
          </View>
          <Switch
            value={draft.isProtagonist === true}
            onValueChange={(value) => updateField('isProtagonist', value)}
            trackColor={{ false: chrome.border, true: chrome.accent }}
            thumbColor={draft.isProtagonist ? chrome.accentContrast : chrome.textMuted}
          />
        </View>
      ) : null}
    </>
  );

  return (
    <>
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.modalRoot}>
      {Platform.OS !== 'web' ? (
        <KeyboardAvoidingView
          style={[styles.mobileBackdrop, { backgroundColor: chrome.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 24) }]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          <View style={[styles.mobileHeader, { borderBottomColor: chrome.border }]}>
            <View style={styles.mobileHeaderCopy}>
              <Text style={[styles.mobileHeaderEyebrow, { color: chrome.accent }]}>人物详情</Text>
              <Text style={[styles.mobileHeaderTitle, { color: chrome.text }]} numberOfLines={1}>{draft.name.trim() || '未命名角色'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭角色编辑" onPress={onClose} style={[styles.mobileClose, { borderColor: chrome.border }]}><Text style={[styles.mobileCloseText, { color: chrome.accent }]}>×</Text></Pressable>
          </View>
          <View style={[styles.mobileTabs, { borderBottomColor: chrome.border }]}>
            {['公开', '私密', '小传'].map((label, index) => { const active = sheetPage === index; return <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => flipTo(index as CharacterSheetPage)} style={[styles.mobileTab, active && { backgroundColor: chrome.accent }]}><Text style={[styles.mobileTabText, { color: active ? chrome.accentContrast : chrome.textMuted }]}>{label}</Text></Pressable>; })}
          </View>
          <View style={[styles.mobileModelRow, { borderBottomColor: chrome.border }]}>
            <TaskModelSelector task="character" disabled={aiBusy || Boolean(biographyGeneratingId) || biographyStorageBusy} />
            {sheetPage !== 2 ? <Pressable accessibilityRole="button" onPress={() => setAiPanelOpen((open) => !open)} style={[styles.mobileAiToggle, { borderColor: chrome.border }]}><Text style={[styles.mobileAiToggleText, { color: chrome.accent }]}>{aiPanelOpen ? '收起 AI' : 'AI 补全'}</Text></Pressable> : null}
          </View>
          <ScrollView scrollComponent={GHScrollView} ref={bodyScrollRef} style={styles.mobileStage} contentContainerStyle={styles.mobileBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {editorBlock}
          </ScrollView>
          <View style={[styles.mobileSaveBar, { borderTopColor: chrome.border, backgroundColor: chrome.background }]}>
            <Pressable disabled={biographyStorageBusy} onPress={() => { void handleConfirm(); }} style={[styles.mobileSaveButton, { backgroundColor: chrome.accent }, biographyStorageBusy && { opacity: 0.5 }]}><Text style={[styles.mobileSaveText, { color: chrome.accentContrast }]}>{biographyStorageBusy ? '同步小传中…' : '保存角色'}</Text></Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior="height">
          <Pressable style={styles.dismiss} onPress={onClose} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: chrome.background,
                borderColor: chrome.border,
                borderTopLeftRadius: Math.max(chrome.panelRadius + 10, 18),
                borderTopRightRadius: Math.max(chrome.panelRadius + 10, 18),
                paddingBottom: Math.max(insets.bottom, Spacing.three),
              },
            ]}>
          <Animated.View
            style={[
              styles.commandShell,
              {
                borderColor: chrome.border,
                backgroundColor: chrome.inputBackground,
                opacity: consoleReveal,
                transform: [
                  {
                    translateY: consoleReveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-18, 0],
                    }),
                  },
                ],
              },
            ]}>
            <View
              style={[
                styles.commandCore,
                compactWorkspace && styles.commandCoreCompact,
                { borderColor: chrome.headerBorder, backgroundColor: chrome.background },
              ]}>
              <View style={[styles.commandIdentity, compactWorkspace && styles.commandIdentityCompact]}>
                <View style={[styles.commandSignal, { backgroundColor: chrome.accent }]} />
                <View style={styles.commandIdentityCopy}>
                  <Text style={[styles.commandEyebrow, { color: chrome.accent }]}>PERSONA WORKSPACE</Text>
                  <Text style={[styles.commandName, { color: chrome.text }]} numberOfLines={1}>
                    {draft.name.trim() || '未命名角色'}
                  </Text>
                </View>
                <Text style={[styles.commandCounter, { color: chrome.textMuted }]}>0{sheetPage + 1} / 03</Text>
              </View>

              {showPageNavigationButtons ? (
                <View style={[styles.pageRail, compactWorkspace && styles.pageRailCompact, { borderColor: chrome.headerBorder }]}>
                  {[
                    { index: 0 as CharacterSheetPage, label: '公开', caption: 'PUBLIC', enabled: true },
                    { index: 1 as CharacterSheetPage, label: '私密', caption: 'PRIVATE', enabled: true },
                    { index: 2 as CharacterSheetPage, label: '小传', caption: 'BIO', enabled: true },
                  ].filter((item) => item.enabled).map((item) => {
                    const active = sheetPage === item.index;
                    return (
                      <Pressable
                        key={item.index}
                        onPress={() => flipTo(item.index)}
                        style={({ pressed }) => [
                          styles.pageRailItem,
                          active && { backgroundColor: chrome.accent },
                          pressed && styles.commandPressed,
                        ]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}>
                        <Text
                          style={[
                            styles.pageRailIndex,
                            { color: active ? chrome.accentContrast : chrome.accent },
                          ]}>
                          0{item.index + 1}
                        </Text>
                        <View>
                          <Text
                            style={[
                              styles.pageRailLabel,
                              { color: active ? chrome.accentContrast : chrome.text },
                            ]}>
                            {item.label}
                          </Text>
                          <Text
                            style={[
                              styles.pageRailCaption,
                              { color: active ? chrome.accentContrast : chrome.textMuted },
                            ]}>
                            {item.caption}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.commandModel}>
                <TaskModelSelector task="character" disabled={aiBusy || Boolean(biographyGeneratingId) || biographyStorageBusy} />
              </View>

              <View
                style={[
                  styles.commandUtilities,
                  compactWorkspace && styles.commandUtilitiesCompact,
                ]}>
                {isExistingCharacter && sheetPage === 0 ? (
                  <Pressable
                    onPress={() => setAiPanelOpen((open) => !open)}
                    style={({ pressed }) => [
                      styles.utilityButton,
                      { borderColor: chrome.headerBorder },
                      pressed && styles.commandPressed,
                    ]}>
                    <Text style={[styles.utilityGlyph, { color: chrome.accent }]}>✦</Text>
                    {!compactWorkspace ? (
                      <Text style={[styles.utilityLabel, { color: chrome.text }]}>
                        {aiPanelOpen ? '收起 AI' : 'AI 补全'}
                      </Text>
                    ) : null}
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.closeIsland,
                    { borderColor: chrome.headerBorder, backgroundColor: chrome.inputBackground },
                    pressed && styles.commandPressed,
                  ]}
                  accessibilityLabel="关闭角色编辑">
                  <Text style={[styles.closeIslandText, { color: chrome.accent }]}>×</Text>
                </Pressable>
              </View>
            </View>
          </Animated.View>

          <View
            style={[
              styles.stageShell,
              { borderColor: chrome.border, backgroundColor: chrome.inputBackground },
            ]}>
            <View
              pointerEvents="none"
              style={[styles.stageHalo, { borderColor: chrome.accent, shadowColor: chrome.accent }]}
            />
            <View
              pointerEvents="none"
              style={[styles.stageAxis, { backgroundColor: chrome.headerBorder }]}
            />
            <ScrollView scrollComponent={GHScrollView}
              ref={bodyScrollRef}
              style={styles.stage}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled>
              <Animated.View
                style={{
                  opacity: consoleReveal,
                  transform: [
                    {
                      translateY: consoleReveal.interpolate({
                        inputRange: [0, 1],
                        outputRange: [34, 0],
                      }),
                    },
                  ],
                }}>
                {editorBlock}
              </Animated.View>
            </ScrollView>
          </View>

          <View
            style={[
              styles.saveDockShell,
              compactWorkspace && styles.saveDockShellCompact,
              { borderColor: chrome.border, backgroundColor: chrome.inputBackground },
            ]}>
            {!compactWorkspace ? (
            <View style={styles.saveDockMeta}>
              <View style={[styles.saveDockPulse, { backgroundColor: chrome.accent }]} />
              <View>
                <Text style={[styles.saveDockEyebrow, { color: chrome.textMuted }]}>LIVE DOSSIER</Text>
                <Text style={[styles.saveDockStatus, { color: chrome.text }]}>
                  {dossierDiagnostics.length
                    ? `${dossierDiagnostics.length} 项一致性提示 · 仍可按原设定保存`
                    : '所有改动将在确认后写入角色知识库'}
                </Text>
              </View>
            </View>
            ) : null}
            <Pressable
              disabled={biographyStorageBusy}
              onPress={() => {
                void handleConfirm();
              }}
              style={({ pressed }) => [
                styles.confirm,
                compactWorkspace && styles.confirmCompact,
                { backgroundColor: chrome.accent },
                biographyStorageBusy && { opacity: 0.48 },
                pressed && styles.confirmPressed,
              ]}>
              <Text style={[styles.confirmText, { color: chrome.accentContrast }]}>
                {biographyStorageBusy ? '同步小传中…' : '保存角色'}
              </Text>
              <View style={[styles.confirmGlyph, { backgroundColor: chrome.accentContrast }]}>
                <Text style={[styles.confirmGlyphText, { color: chrome.accent }]}>✓</Text>
              </View>
            </Pressable>
          </View>
          </View>
        </KeyboardAvoidingView>
      )}
      </GestureHandlerRootView>
    </Modal>
    <CharacterPortraitPickerModal
      visible={portraitPickerOpen}
      mode={portraitTarget}
      gender={draft.gender}
      currentUri={
        portraitTarget === 'private'
          ? activeDossierV2.private.portraitUri
          : draft.portraitUri
      }
      identityReferenceUri={portraitTarget === 'private' ? draft.portraitUri : undefined}
      privateReferenceUri={portraitTarget === 'public' ? activeDossierV2.private.portraitUri : undefined}
      portraitPrompt={portraitPrompt}
      portraitPromptInput={portraitPromptInput}
      onClose={() => setPortraitPickerOpen(false)}
      onSelect={(uri, portraitFocus) => applyPortraitUri(uri, portraitFocus)}
    />

    <Modal
      visible={Boolean(portraitProposal)}
      transparent
      animationType="fade"
      onRequestClose={() => setPortraitProposal(null)}>
      <View style={styles.proposalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setPortraitProposal(null)} />
        <View style={[styles.proposalSheet, { backgroundColor: chrome.background, borderColor: chrome.border }]}>
          <View style={styles.proposalHeader}>
            <View style={styles.proposalHeaderCopy}>
              <Text style={[styles.proposalEyebrow, { color: chrome.accent }]}>VISUAL FORENSICS / REVIEW</Text>
              <Text style={[styles.proposalTitle, { color: chrome.text }]}>
                {portraitProposal?.target === 'private' ? '确认私密照补全' : '确认日常照补全'}
              </Text>
              <Text style={[styles.proposalIntro, { color: chrome.textMuted }]}>可见事实与推断内容已分开标记，且只包含当前照片类型对应的字段。取消勾选即可拒绝单个字段，原有非空内容不会被覆盖。</Text>
            </View>
            <Pressable onPress={() => setPortraitProposal(null)} hitSlop={8}>
              <Text style={[styles.proposalClose, { color: chrome.textMuted }]}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.proposalList} contentContainerStyle={styles.proposalListContent}>
            {portraitProposal?.changes.map((change) => {
              const selected = selectedPortraitPaths.includes(change.path);
              return (
                <Pressable
                  key={change.path}
                  onPress={() => togglePortraitProposal(change.path)}
                  style={({ pressed }) => [
                    styles.proposalRow,
                    { borderColor: chrome.inputBorder, backgroundColor: chrome.inputBackground },
                    selected && { borderLeftColor: chrome.accent, borderLeftWidth: 4 },
                    pressed && styles.commandPressed,
                  ]}>
                  <View style={[styles.proposalCheck, { borderColor: chrome.accent, backgroundColor: selected ? chrome.accent : 'transparent' }]}>
                    <Text style={[styles.proposalCheckText, { color: chrome.accentContrast }]}>{selected ? '✓' : ''}</Text>
                  </View>
                  <View style={styles.proposalCopy}>
                    <View style={styles.proposalMeta}>
                      <Text style={[styles.proposalLabel, { color: chrome.text }]}>{change.label}</Text>
                      <Text style={[
                        styles.proposalSource,
                        {
                          color: change.source === 'observed' ? chrome.accent : chrome.textMuted,
                          borderColor: change.source === 'observed' ? chrome.accent : chrome.inputBorder,
                        },
                      ]}>
                        {change.source === 'observed' ? '图片可见' : '设定推断'}
                      </Text>
                    </View>
                    <Text style={[styles.proposalValue, { color: chrome.text }]}>{change.after}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[styles.proposalFooter, { borderTopColor: chrome.inputBorder }]}>
            <Pressable
              onPress={() => setSelectedPortraitPaths(
                selectedPortraitPaths.length === portraitProposal?.changes.length
                  ? []
                  : portraitProposal?.changes.map((change) => change.path) ?? [],
              )}>
              <Text style={[styles.proposalSelectAll, { color: chrome.textMuted }]}>
                {selectedPortraitPaths.length === portraitProposal?.changes.length ? '全部取消' : '全部选择'}
              </Text>
            </Pressable>
            <Pressable
              disabled={!selectedPortraitPaths.length}
              onPress={applyPortraitProposal}
              style={({ pressed }) => [
                styles.proposalApply,
                { backgroundColor: chrome.accent },
                !selectedPortraitPaths.length && { opacity: 0.4 },
                pressed && styles.confirmPressed,
              ]}>
              <Text style={[styles.proposalApplyText, { color: chrome.accentContrast }]}>应用 {selectedPortraitPaths.length} 项</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>

    </>
  );
}

const styles = StyleSheet.create({
  mobileBackdrop: { flex: 1, paddingTop: Spacing.three },
  mobileHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  mobileHeaderCopy: { flex: 1, gap: 2 },
  mobileHeaderEyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  mobileHeaderTitle: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  mobileClose: { width: 48, height: 48, borderWidth: 1, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  mobileCloseText: { fontSize: 28, lineHeight: 30, fontWeight: '300' },
  mobileTabs: { flexDirection: 'row', gap: Spacing.one, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  mobileTab: { minHeight: 48, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mobileTabText: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  mobileModelRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth },
  mobileAiToggle: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  mobileAiToggleText: { fontSize: 13, fontWeight: '700' },
  mobileStage: { flex: 1 },
  mobileBody: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.three },
  mobileSaveBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  mobileSaveButton: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mobileSaveText: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(18, 12, 9, 0.45)',
  },
  dismiss: {
    flex: 1,
  },
  sheet: {
    width: '100%',
    maxWidth: 1680,
    maxHeight: '96%',
    alignSelf: 'center',
    borderWidth: 1,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.two,
    gap: 6,
  },
  body: {
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  stage: {
    maxHeight: Math.round(Dimensions.get('window').height * 0.7),
    width: '100%',
  },
  stageShell: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 7,
  },
  stageHalo: {
    position: 'absolute',
    right: -120,
    top: -150,
    width: 390,
    height: 390,
    borderRadius: 195,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.22,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 42,
  },
  stageAxis: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    opacity: 0.12,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  switchCopy: {
    flex: 1,
    gap: 4,
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  aiCard: {
    borderWidth: 1,
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
  aiTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  aiActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  aiGhostButton: {
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiGhostText: {
    fontSize: 12,
    fontWeight: '600',
  },
  aiButton: {
    minHeight: 36,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  aiInput: {
    borderWidth: 1,
    minHeight: 72,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  aiSourceHint: {
    fontSize: 11,
    lineHeight: 16,
  },
  diagnosticPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  diagnosticHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  diagnosticEyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  diagnosticCount: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  diagnosticList: {
    gap: 7,
  },
  diagnosticRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  diagnosticSignal: {
    width: 3,
    minHeight: 18,
    marginTop: 1,
  },
  diagnosticText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  diagnosticFootnote: {
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.3,
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 18,
  },
  confirm: {
    minWidth: 168,
    minHeight: 50,
    borderRadius: 25,
    paddingLeft: Spacing.three,
    paddingRight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  confirmPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },
  confirmCompact: {
    width: '100%',
  },
  confirmText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  confirmGlyph: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmGlyphText: {
    fontSize: 15,
    fontWeight: '900',
  },
  commandShell: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 5,
  },
  commandCore: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 72,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.three,
  },
  commandCoreCompact: {
    minHeight: 58,
    paddingHorizontal: Spacing.two,
  },
  commandIdentity: {
    minWidth: 210,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  commandIdentityCompact: {
    minWidth: 0,
    flexBasis: '100%',
  },
  commandSignal: {
    width: 4,
    height: 34,
  },
  commandIdentityCopy: {
    flex: 1,
    minWidth: 0,
  },
  commandEyebrow: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  commandName: {
    marginTop: 2,
    fontFamily: 'serif',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  commandCounter: {
    fontFamily: 'serif',
    fontSize: 11,
    letterSpacing: 0.8,
  },
  pageRail: {
    flex: 1,
    minWidth: 340,
    maxWidth: 620,
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  pageRailCompact: {
    minWidth: 0,
    flexBasis: '100%',
  },
  commandModel: {
    maxWidth: '100%',
    flexShrink: 1,
  },
  pageRailItem: {
    flex: 1,
    minWidth: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  pageRailIndex: {
    fontFamily: 'serif',
    fontSize: 16,
    fontWeight: '600',
  },
  pageRailLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  pageRailCaption: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  commandUtilities: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  commandUtilitiesCompact: {
    flexShrink: 0,
  },
  utilityButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 21,
    paddingHorizontal: 12,
  },
  utilityGlyph: {
    fontSize: 13,
    fontWeight: '700',
  },
  utilityLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  closeIsland: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeIslandText: {
    fontFamily: 'serif',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '400',
  },
  commandPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.975 }],
  },
  saveDockShell: {
    minHeight: 66,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
    paddingLeft: Spacing.three,
    paddingRight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  saveDockShellCompact: {
    paddingLeft: 7,
  },
  saveDockMeta: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  saveDockPulse: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  saveDockEyebrow: {
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  saveDockStatus: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 14,
  },
  proposalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(18, 12, 9, 0.66)',
  },
  proposalSheet: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '86%',
    borderWidth: 1,
    padding: Spacing.three,
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.26,
    shadowRadius: 40,
    elevation: 18,
  },
  proposalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  proposalHeaderCopy: { flex: 1, minWidth: 0, gap: 5 },
  proposalEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.5 },
  proposalTitle: { fontFamily: 'serif', fontSize: 27, lineHeight: 34, fontWeight: '600' },
  proposalIntro: { maxWidth: 560, fontSize: 11, lineHeight: 17 },
  proposalClose: { fontFamily: 'serif', fontSize: 28, lineHeight: 30 },
  proposalList: { flexGrow: 0 },
  proposalListContent: { gap: Spacing.one },
  proposalRow: { minHeight: 76, borderWidth: 1, padding: Spacing.two, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  proposalCheck: { width: 22, height: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  proposalCheckText: { fontSize: 12, fontWeight: '900' },
  proposalCopy: { flex: 1, minWidth: 0, gap: 7 },
  proposalMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  proposalLabel: { fontSize: 12, fontWeight: '800' },
  proposalSource: { borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  proposalValue: { fontSize: 13, lineHeight: 20 },
  proposalFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  proposalSelectAll: { fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },
  proposalApply: { minWidth: 150, minHeight: 46, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  proposalApplyText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },
});
