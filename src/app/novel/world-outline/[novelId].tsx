import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { NOVEL_TARGET_WORDS_RANGE } from '@/constants/novel-continuation';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  generateNovelOutlineChapterRevision,
  generateNovelOutlineVolume,
  getNextChapterIndex,
} from '@/services/novel-continuation-pipeline';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import type { Novel, NovelOutline, NovelOutlineProposal, NovelVolumePlan } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import {
  calculateNovelOutlineTotalWords,
  clampNovelOutlineChapterCount,
} from '@/utils/novel-outline-options';
import { countOutlineChanges } from '@/utils/novel-outline-proposals';
import { buildQuickTravelContext, ensureQuickTravelArchive } from '@/utils/quick-travel';

type VolumeDraft = {
  id: string;
  title: string;
  summary: string;
  plannedChapterCount: string;
  wordsPerChapter: string;
  incomingHandoff: string;
};

type OutlineOperation = 'create' | 'append' | 'revise' | 'reorder';
type OutlineWorkspaceStep = 'book' | 'volume' | 'review';

const OUTLINE_OPERATION_OPTIONS: { value: OutlineOperation; label: string; description: string }[] = [
  { value: 'create', label: '创建新大纲', description: '生成当前卷的一份完整候选；不会替换正式大纲。' },
  { value: 'append', label: '追加章节', description: '只允许新增章节，已有章节不会被修改、删除或重排。' },
  { value: 'revise', label: '修改本卷结构', description: '整卷统一修改入口：AI 可按剧情需要新增、合并、删除或改写章节，章数由内容决定。' },
  { value: 'reorder', label: '调整顺序', description: '进入手动排序；只改变章节排列，不改写章节内容。' },
];

function outlineOperationLabel(operation: OutlineOperation | 'reshape'): string {
  if (operation === 'reshape') return '修改本卷结构';
  return OUTLINE_OPERATION_OPTIONS.find((item) => item.value === operation)?.label ?? '生成提案';
}

type OutlineDiffItem = {
  kind: '新增' | '修改' | '删除';
  index: number;
  before?: { title: string; goal: string };
  after?: { title: string; goal: string };
};

function buildVolumeDiff(
  before: NovelVolumePlan | undefined,
  after: NovelVolumePlan | undefined,
): OutlineDiffItem[] {
  if (!after) return [];
  const beforeByIndex = new Map((before?.chapters ?? []).map((chapter) => [chapter.index, chapter]));
  const afterByIndex = new Map(after.chapters.map((chapter) => [chapter.index, chapter]));
  const result: OutlineDiffItem[] = [];
  for (const chapter of after.chapters) {
    const previous = beforeByIndex.get(chapter.index);
    if (!previous) {
      result.push({ kind: '新增', index: chapter.index, after: { title: chapter.title, goal: chapter.goal } });
    } else if (previous.title !== chapter.title || previous.goal !== chapter.goal || previous.sceneEnd !== chapter.sceneEnd) {
      result.push({
        kind: '修改',
        index: chapter.index,
        before: { title: previous.title, goal: previous.goal },
        after: { title: chapter.title, goal: chapter.goal },
      });
    }
  }
  for (const chapter of before?.chapters ?? []) {
    if (!afterByIndex.has(chapter.index)) {
      result.push({ kind: '删除', index: chapter.index, before: { title: chapter.title, goal: chapter.goal } });
    }
  }
  return result;
}

function cloneOutline(outline: NovelOutline): NovelOutline {
  return {
    ...outline,
    volumes: outline.volumes.map((volume) => ({
      ...volume,
      chapters: volume.chapters.map((chapter) => ({ ...chapter })),
      handoff: volume.handoff
        ? { ...volume.handoff, unresolvedThreads: volume.handoff.unresolvedThreads?.slice() }
        : undefined,
    })),
  };
}

function proposalCandidateOutline(
  proposal: NovelOutlineProposal | undefined,
  current: NovelOutline | undefined,
): NovelOutline | undefined {
  if (!proposal) return undefined;
  const patch = proposal.patch;
  if (patch.op === 'replace_outline') return patch.outline;
  if (!current) return undefined;
  if (patch.op === 'update_volume') {
    return {
      ...current,
      volumes: current.volumes.map((volume) =>
        volume.id === patch.volumeId ? patch.volume : volume,
      ),
    };
  }
  if (patch.op === 'append_chapters') {
    return {
      ...current,
      volumes: current.volumes.map((volume) => volume.id === patch.volumeId
        ? {
            ...volume,
            chapters: [...volume.chapters, ...patch.chapters],
            plannedChapterCount: Math.max(volume.plannedChapterCount ?? 0, volume.chapters.length + patch.chapters.length),
          }
        : volume),
    };
  }
  if (patch.op === 'update_selected_chapters') {
    const replacements = new Map(patch.chapters.map((chapter) => [chapter.index, chapter]));
    return {
      ...current,
      volumes: current.volumes.map((volume) => volume.id === patch.volumeId
        ? { ...volume, chapters: volume.chapters.map((chapter) => replacements.get(chapter.index) ?? chapter) }
        : volume),
    };
  }
  if (patch.op === 'reorder_chapters') {
    const byIndex = new Map((current.volumes.find((volume) => volume.id === patch.volumeId)?.chapters ?? []).map((chapter) => [chapter.index, chapter]));
    return {
      ...current,
      volumes: current.volumes.map((volume) => volume.id === patch.volumeId
        ? { ...volume, chapters: patch.chapterIndexes.map((index) => byIndex.get(index)).filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter)) }
        : volume),
    };
  }
  return {
    ...current,
    volumes: [...current.volumes, ...patch.volumes],
  };
}

function volumeChapterCount(volume: NovelVolumePlan, fallback: number): number {
  return Math.max(1, volume.plannedChapterCount ?? (volume.chapters.length || fallback));
}

function createVolumeId(scopeId: string): string {
  return `${scopeId}-volume-${Date.now()}`;
}

function formatOutlineVersionDate(createdAt: string): string {
  return new Date(createdAt).toLocaleString();
}

function volumeWordsPerChapter(volume: NovelVolumePlan, fallback: number): number {
  return Math.min(
    NOVEL_TARGET_WORDS_RANGE[1],
    Math.max(NOVEL_TARGET_WORDS_RANGE[0], volume.wordsPerChapter ?? fallback),
  );
}

function volumeStatus(volume: NovelVolumePlan): NonNullable<NovelVolumePlan['status']> {
  return volume.status ?? (volume.chapters.length > 0 ? 'ready' : 'draft');
}

function statusLabel(status: NonNullable<NovelVolumePlan['status']>): string {
  return { draft: '待生成', generating: '生成中', ready: '已完成', failed: '生成失败' }[status];
}

function proposalStatusLabel(status: NovelOutlineProposal['status']): string {
  return {
    pending: '待审阅',
    accepted: '已采纳',
    rejected: '已丢弃',
    conflicted: '已冲突',
    failed: '生成失败',
  }[status];
}

function toVolumeDraft(volume: NovelVolumePlan, fallbackWords: number, incomingFallback = ''): VolumeDraft {
  return {
    id: volume.id,
    title: volume.title,
    summary: volume.summary,
    plannedChapterCount: String(volumeChapterCount(volume, 20)),
    wordsPerChapter: String(volumeWordsPerChapter(volume, fallbackWords)),
    incomingHandoff: volume.handoff?.incoming ?? incomingFallback,
  };
}

function getOutlineBaseChapterIndex(outline: NovelOutline | undefined, novel: Novel): number {
  const firstPlannedChapter = outline?.volumes
    .flatMap((volume) => volume.chapters)
    .sort((a, b) => a.index - b.index)[0];
  const persistedBase = outline?.baseChapterIndex ?? firstPlannedChapter?.index;
  return Math.max(persistedBase ?? 1, getNextChapterIndex(novel));
}

function reindexOutline(outline: NovelOutline, baseChapterIndex: number): NovelOutline {
  let cursor = baseChapterIndex;
  return {
    ...outline,
    baseChapterIndex,
    volumes: outline.volumes.map((volume) => {
      const planned = volumeChapterCount(volume, volume.chapters.length || 20);
      const reserved = Math.max(planned, volume.chapters.length);
      const next = {
        ...volume,
        plannedChapterCount: planned,
        chapters: volume.chapters.map((chapter, chapterIndex) => ({ ...chapter, index: cursor + chapterIndex })),
      };
      cursor += reserved;
      return next;
    }),
    updatedAt: new Date().toISOString(),
  };
}

function applyVolumeDraft(
  volume: NovelVolumePlan,
  draft: VolumeDraft,
  volumeIndex: number,
  fallbackWords: number,
): NovelVolumePlan {
  const plannedChapterCount = clampNovelOutlineChapterCount(draft.plannedChapterCount, 20);
  const wordsPerChapter = Math.min(
    NOVEL_TARGET_WORDS_RANGE[1],
    Math.max(
      NOVEL_TARGET_WORDS_RANGE[0],
      Number.parseInt(draft.wordsPerChapter, 10) || fallbackWords,
    ),
  );
  const countChanged = volume.plannedChapterCount !== undefined
    ? volume.plannedChapterCount !== plannedChapterCount
    : volume.chapters.length > 0 && volume.chapters.length !== plannedChapterCount;
  return {
    ...volume,
    title: draft.title.trim() || `第 ${volumeIndex + 1} 卷`,
    summary: draft.summary.trim(),
    plannedChapterCount,
    wordsPerChapter,
    status: countChanged && volume.chapters.length > 0 ? 'draft' : volumeStatus(volume),
    generationError: countChanged ? undefined : volume.generationError,
    handoff: {
      ...(volume.handoff ?? {}),
      ...(draft.incomingHandoff.trim()
        ? { incoming: draft.incomingHandoff.trim() }
        : { incoming: undefined }),
    },
  };
}

export default function WorldOutlineScreen() {
  const { novelId: rawNovelId, worldId: rawWorldId } = useLocalSearchParams<{
    novelId?: string;
    worldId?: string;
  }>();
  const novelId = Array.isArray(rawNovelId) ? rawNovelId[0] : rawNovelId;
  const worldId = Array.isArray(rawWorldId) ? rawWorldId[0] : rawWorldId;
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isCompact = width < 700;
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const saveNovelOutlineAtScope = useTavernStore((state) => state.saveNovelOutlineAtScope);
  const clearNovelOutlineAtScope = useTavernStore((state) => state.clearNovelOutlineAtScope);
  const saveNovelOutlineProposal = useTavernStore((state) => state.saveNovelOutlineProposal);
  const acceptNovelOutlineProposal = useTavernStore((state) => state.acceptNovelOutlineProposal);
  const rejectNovelOutlineProposal = useTavernStore((state) => state.rejectNovelOutlineProposal);
  const deleteNovelOutlineProposal = useTavernStore((state) => state.deleteNovelOutlineProposal);
  const deleteNovelOutlineVersion = useTavernStore((state) => state.deleteNovelOutlineVersion);
  const generateNovelOutline = useTavernStore((state) => state.generateNovelOutline);

  const [mode, setMode] = useState<'guided' | 'auto'>('guided');
  const [brief, setBrief] = useState('');
  const [workspaceStep, setWorkspaceStep] = useState<OutlineWorkspaceStep>('book');
  const [wholeBookMode, setWholeBookMode] = useState<'guided' | 'auto'>('guided');
  const [wholeBookPrompt, setWholeBookPrompt] = useState('');
  const [wholeBookChapterCount, setWholeBookChapterCount] = useState('12');
  const [wholeBookWordsPerChapter, setWholeBookWordsPerChapter] = useState('1800');
  const [generatingWholeBook, setGeneratingWholeBook] = useState(false);
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<VolumeDraft | null>(null);
  const [bookSummaryDraft, setBookSummaryDraft] = useState<string | null>(null);
  const [chapterDraftOutline, setChapterDraftOutline] = useState<NovelOutline | null>(null);
  const [chapterEditMode, setChapterEditMode] = useState<'content' | 'reorder' | null>(null);
  const [outlineOperation, setOutlineOperation] = useState<OutlineOperation | null>(null);
  const [operationMenuOpen, setOperationMenuOpen] = useState(false);
  const [appendChapterCount, setAppendChapterCount] = useState('3');
  const [showProposalDiff, setShowProposalDiff] = useState(false);
  const [generatingVolumeId, setGeneratingVolumeId] = useState<string | null>(null);
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number | null>(null);
  const [chapterAiPrompt, setChapterAiPrompt] = useState('');
  const [generatingChapterIndex, setGeneratingChapterIndex] = useState<number | null>(null);
  const [showVolumeSettings, setShowVolumeSettings] = useState(false);
  const [showVolumeAi, setShowVolumeAi] = useState(false);
  const [showHandoff, setShowHandoff] = useState(false);
  const [pageReveal] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));

  useEffect(() => {
    pageReveal.stopAnimation();
    if (!motionEnabled) {
      pageReveal.setValue(1);
      return;
    }
    pageReveal.setValue(0);
    Animated.spring(pageReveal, {
      toValue: 1,
      damping: 20,
      stiffness: 180,
      mass: 0.78,
      useNativeDriver: true,
    }).start();
  }, [motionEnabled, pageReveal]);

  const archive = useMemo(() => (novel ? ensureQuickTravelArchive(novel) : null), [novel]);
  const world = archive?.worlds.find((item) => item.id === worldId);
  const isWorldScope = Boolean(worldId && world && !world.isMainWorld);
  const scopeId = isWorldScope && world ? world.id : 'novel';
  const outline = isWorldScope ? world?.outline : novel?.outline;
  const volumes = outline?.volumes ?? [];
  const activeVolumeId = selectedVolumeId && volumes.some((volume) => volume.id === selectedVolumeId)
    ? selectedVolumeId
    : volumes[0]?.id ?? null;
  const activeVolumeIndex = activeVolumeId ? volumes.findIndex((volume) => volume.id === activeVolumeId) : -1;
  const activeVolume = activeVolumeIndex >= 0 ? volumes[activeVolumeIndex] : undefined;
  const activeOperation: OutlineOperation = outlineOperation ?? (activeVolume && volumeStatus(activeVolume) === 'ready' ? 'revise' : 'create');
  const defaultWordsPerChapter = isWorldScope
    ? world?.runtime.novelGenerationTargetWords || 4500
    : novel?.continuationSettings?.targetWords || 1800;
  const activeVolumeDraft = activeVolume
    ? volumeDraft?.id === activeVolume.id
      ? volumeDraft
      : toVolumeDraft(
          activeVolume,
          defaultWordsPerChapter,
          activeVolumeIndex > 0 ? volumes[activeVolumeIndex - 1]?.handoff?.outgoing ?? '' : '',
        )
    : null;
  const displayedOutline = chapterDraftOutline ?? outline;
  const displayedVolume = displayedOutline?.volumes.find((volume) => volume.id === activeVolumeId);
  const selectedChapter = displayedVolume?.chapters.find((chapter) => chapter.index === selectedChapterIndex);
  const pendingProposal = (novel?.outlineProposals ?? []).find(
    (proposal) => proposal.scopeId === scopeId && proposal.status === 'pending',
  );
  const conflictedProposal = (novel?.outlineProposals ?? []).find(
    (proposal) => proposal.scopeId === scopeId && proposal.status === 'conflicted',
  );
  const pendingProposalOutline = proposalCandidateOutline(pendingProposal, outline);
  const pendingProposalVolumeId = pendingProposal && 'volumeId' in pendingProposal.patch
    ? pendingProposal.patch.volumeId
    : activeVolumeId;
  const pendingProposalVolume = pendingProposal?.patch.op === 'update_volume'
    ? pendingProposal.patch.volume
    : pendingProposalOutline?.volumes.find((volume) => volume.id === pendingProposalVolumeId);
  const pendingProposalBeforeVolume = outline?.volumes.find((volume) => volume.id === pendingProposalVolumeId);
  const proposalChanges = pendingProposalOutline
    ? countOutlineChanges(outline, pendingProposalOutline)
    : null;
  const proposalDiff = pendingProposalVolume
    ? buildVolumeDiff(pendingProposalBeforeVolume, pendingProposalVolume)
    : [];
  const outlineVersions = (novel?.outlineVersions ?? [])
    .filter((version) => version.scopeId === scopeId)
    .slice()
    .reverse()
    .slice(0, 6);
  const currentVersion = outlineVersions[0];
  const proposalHistory = (novel?.outlineProposals ?? [])
    .filter((proposal) => proposal.scopeId === scopeId && proposal.status !== 'pending' && proposal.status !== 'conflicted')
    .slice()
    .reverse()
    .slice(0, 12);
  const reviewAvailable = Boolean(pendingProposal || conflictedProposal || proposalHistory.length > 0 || outlineVersions.length > 0);
  const bookChapterCount = volumes.reduce((total, volume) => total + volumeChapterCount(volume, 20), 0);
  const bookWordCount = volumes.reduce(
    (total, volume) => total + calculateNovelOutlineTotalWords(
      volumeChapterCount(volume, 20),
      volumeWordsPerChapter(volume, defaultWordsPerChapter),
    ),
    0,
  );
  const bookSummary = bookSummaryDraft ?? outline?.summary ?? '';
  const stepTabs = ([
    ['book', `1 · ${isWorldScope ? '小世界设定' : '全书设定'}`, '先写方向'],
    ['volume', '2 · 卷与章节', `${volumes.length} 卷`],
    ['review', '3 · 审阅提案', pendingProposal ? '有待处理' : reviewAvailable ? '查看历史' : '尚无提案'],
  ] as const).map(([step, label, detail]) => (
    <Pressable
      key={step}
      onPress={() => setWorkspaceStep(step)}
      style={[styles.stepTab, isCompact && styles.stepTabCompact, { borderColor: workspaceStep === step ? theme.accent : theme.border, backgroundColor: workspaceStep === step ? theme.accentMuted : theme.surface }]}
    >
      <ThemedText type="smallBold" themeColor={workspaceStep === step ? 'accent' : undefined}>{label}</ThemedText>
      <ThemedText type="code" themeColor="textMuted">{detail}</ThemedText>
    </Pressable>
  ));

  if (!novel || (worldId && !world)) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.invalidState}>
          <ThemedText type="subtitle">找不到大纲作用域</ThemedText>
          <ThemedText type="small" themeColor="textMuted">小说或小世界链接已失效，请返回后重新选择。</ThemedText>
          <Pressable onPress={() => router.back()} style={[styles.secondaryButton, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" themeColor="accent">返回</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const currentNovel = novel;
  const currentArchive = archive!;
  const currentWorld = world;

  function selectOutlineOperation(nextOperation: OutlineOperation) {
    setOutlineOperation(nextOperation);
    setOperationMenuOpen(false);
    setShowProposalDiff(false);
    if (nextOperation === 'reorder') {
      if (outline) {
        setChapterDraftOutline(cloneOutline(outline));
        setChapterEditMode('reorder');
      }
    } else if (chapterEditMode === 'reorder') {
      setChapterDraftOutline(null);
      setChapterEditMode(null);
    }
  }

  function moveDraftChapter(chapterIndex: number, direction: -1 | 1) {
    setChapterDraftOutline((current) => {
      if (!current || !activeVolumeId) return current;
      return {
        ...current,
        volumes: current.volumes.map((volume) => {
          if (volume.id !== activeVolumeId) return volume;
          const nextIndex = chapterIndex + direction;
          if (nextIndex < 0 || nextIndex >= volume.chapters.length) return volume;
          const chapters = volume.chapters.slice();
          [chapters[chapterIndex], chapters[nextIndex]] = [chapters[nextIndex], chapters[chapterIndex]];
          return { ...volume, chapters };
        }),
      };
    });
  }

  function persistOutline(nextOutline: NovelOutline) {
    const normalized = reindexOutline(nextOutline, getOutlineBaseChapterIndex(nextOutline, currentNovel));
    saveNovelOutlineAtScope(currentNovel.id, scopeId, normalized, '手动编辑大纲');
  }

  function saveBookSummary() {
    persistOutline(outline
      ? { ...outline, summary: bookSummary.trim() }
      : { summary: bookSummary.trim(), volumes: [], updatedAt: new Date().toISOString() });
    setBookSummaryDraft(null);
    setWorkspaceStep('volume');
  }

  async function requestGenerateWholeBook() {
    if (generatingWholeBook) return;
    if (isWorldScope) {
      showAppAlert('当前是小世界大纲', '全书提案只适用于主小说。请先进入“卷与章节”，为当前小世界创建或修改卷结构。');
      setWorkspaceStep('volume');
      return;
    }
    const chapterCount = clampNovelOutlineChapterCount(wholeBookChapterCount, 12);
    const wordsPerChapter = Math.max(
      NOVEL_TARGET_WORDS_RANGE[0],
      Math.min(NOVEL_TARGET_WORDS_RANGE[1], Number.parseInt(wholeBookWordsPerChapter, 10) || 1800),
    );
    setGeneratingWholeBook(true);
    try {
      await generateNovelOutline(currentNovel.id, {
        targetChapterCount: chapterCount,
        targetWords: chapterCount * wordsPerChapter,
        userBrief: [
          wholeBookMode === 'guided' ? wholeBookPrompt.trim() : '',
          bookSummary.trim() ? `全书设定：${bookSummary.trim()}` : '',
        ].filter(Boolean).join('\n'),
      });
      setWorkspaceStep('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : '全书提案生成失败。';
      showAppAlert('本次提案未生成', `现有大纲和章节未发生任何修改。${message ? `\n\n${message}` : ''}`);
    } finally {
      setGeneratingWholeBook(false);
    }
  }

  function buildVolume() {
    const nextId = createVolumeId(scopeId);
    const previous = volumes[volumes.length - 1];
    const nextVolume: NovelVolumePlan = {
      id: nextId,
      title: `第 ${volumes.length + 1} 卷`,
      summary: '',
      chapters: [],
      plannedChapterCount: 20,
      wordsPerChapter: defaultWordsPerChapter,
      status: 'draft',
      handoff: previous?.handoff?.outgoing || previous?.summary
        ? { incoming: previous.handoff?.outgoing ?? previous.summary }
        : undefined,
    };
    persistOutline({
      summary: outline?.summary ?? bookSummary.trim(),
      volumes: [...volumes, nextVolume],
      updatedAt: new Date().toISOString(),
    });
    setSelectedVolumeId(nextId);
    setVolumeDraft(toVolumeDraft(nextVolume, defaultWordsPerChapter, nextVolume.handoff?.incoming ?? ''));
    setChapterDraftOutline(null);
    setChapterEditMode(null);
    setOutlineOperation('create');
    setWorkspaceStep('volume');
  }

  function saveVolumeSettings() {
    if (!activeVolume || !activeVolumeDraft || !outline) return;
    const nextVolume = applyVolumeDraft(activeVolume, activeVolumeDraft, activeVolumeIndex, defaultWordsPerChapter);
    persistOutline({
      ...outline,
      volumes: volumes.map((volume) => volume.id === activeVolume.id ? nextVolume : volume),
      updatedAt: new Date().toISOString(),
    });
    setVolumeDraft(null);
    setChapterEditMode(null);
  }

  async function generateSelectedVolume() {
    if (!activeVolume || !outline || generatingVolumeId) return;
    const liveVolume = activeVolumeDraft
      ? applyVolumeDraft(activeVolume, activeVolumeDraft, activeVolumeIndex, defaultWordsPerChapter)
      : activeVolume;
    const operation = activeOperation;
    if (operation === 'reorder') {
      if (!chapterDraftOutline) {
        setChapterDraftOutline(cloneOutline(outline));
        setChapterEditMode('reorder');
      }
      return;
    }
    const requestedAppendCount = Math.max(1, Math.min(20, Number.parseInt(appendChapterCount, 10) || 3));
    const count = operation === 'append'
      ? requestedAppendCount
      : operation === 'revise'
        ? Math.max(1, liveVolume.chapters.length || volumeChapterCount(liveVolume, 20))
        : volumeChapterCount(liveVolume, 20);
    const wordsPerChapter = volumeWordsPerChapter(liveVolume, defaultWordsPerChapter);
    const previous = activeVolumeIndex > 0 ? volumes[activeVolumeIndex - 1] : undefined;
    const incomingHandoff = liveVolume.handoff?.incoming ?? previous?.handoff?.outgoing ?? previous?.summary ?? '';
    const outlineStartIndex = getOutlineBaseChapterIndex(outline, currentNovel)
      + volumes.slice(0, activeVolumeIndex).reduce(
        (total, volume) => total + Math.max(volumeChapterCount(volume, 20), volume.chapters.length),
        0,
      );
    const nextChapterIndex = operation === 'append'
      ? Math.max(...liveVolume.chapters.map((chapter) => chapter.index), outlineStartIndex - 1) + 1
      : outlineStartIndex;
    setGeneratingVolumeId(liveVolume.id);
    try {
      const scopedNovel = isWorldScope && currentWorld
        ? { ...currentNovel, quickTravel: { ...currentArchive, activeWorldId: currentWorld.id } }
        : currentNovel;
      const result = await generateNovelOutlineVolume({
        apiSettings: resolveApiSettings(providers, generationSettings, { purpose: 'utility' }),
        novel: scopedNovel,
        nextChapterIndex,
        analysis: null,
        worldContext: isWorldScope ? buildQuickTravelContext(scopedNovel) : undefined,
        userBrief: [
          mode === 'guided' ? brief.trim() : '',
          bookSummary.trim() ? `全书设定：${bookSummary.trim()}` : '',
          liveVolume.summary.trim() ? `本卷设定：${liveVolume.summary.trim()}` : '',
          operation === 'append'
            ? `操作边界：只追加 ${requestedAppendCount} 章，不得修改、删除或重排已有章节。`
            : operation === 'revise'
              ? '操作边界：修改整卷结构；可以根据剧情需要新增、合并、删除或改写章节，最终章数由内容决定，但必须保留未被作者指令否定的核心冲突与人物动机。'
              : '',
        ]
          .filter(Boolean)
          .join('\n'),
        volumeId: liveVolume.id,
        volumeNumber: activeVolumeIndex + 1,
        chapterCount: count,
        wordsPerChapter,
        incomingHandoff,
        existingVolume: operation === 'create' ? undefined : liveVolume,
        operation: operation === 'append' ? 'append' : operation === 'revise' ? 'revise' : 'create',
        allowVariableChapterCount: operation === 'revise',
      });
      const generatedChapters = result.volume.chapters.map((chapter, index) => ({
        ...chapter,
        index: operation === 'append'
            ? nextChapterIndex + index
            : operation === 'revise'
              ? outlineStartIndex + index
              : chapter.index,
      }));
      const completedVolume: NovelVolumePlan = operation === 'append'
        ? {
            ...liveVolume,
            chapters: [...liveVolume.chapters, ...generatedChapters],
            plannedChapterCount: Math.max(liveVolume.plannedChapterCount ?? 0, liveVolume.chapters.length + generatedChapters.length),
            wordsPerChapter,
            status: 'ready',
            handoff: { ...(result.volume.handoff ?? liveVolume.handoff ?? {}), ...(incomingHandoff ? { incoming: incomingHandoff } : {}) },
          }
        : operation === 'revise'
          ? {
              ...result.volume,
              title: liveVolume.title.trim() || result.volume.title,
              summary: liveVolume.summary.trim() || result.volume.summary,
              chapters: generatedChapters,
              plannedChapterCount: generatedChapters.length,
              wordsPerChapter,
              status: 'ready',
              handoff: { ...(result.volume.handoff ?? liveVolume.handoff ?? {}), ...(incomingHandoff ? { incoming: incomingHandoff } : {}) },
            }
          : {
              ...result.volume,
              title: liveVolume.title.trim() || result.volume.title,
              summary: liveVolume.summary.trim() || result.volume.summary,
              plannedChapterCount: count,
              wordsPerChapter,
              status: 'ready',
              handoff: { ...(result.volume.handoff ?? {}), ...(incomingHandoff ? { incoming: incomingHandoff } : {}) },
            };
      const candidateBeforeNormalize: NovelOutline = {
        ...outline,
        volumes: volumes.map((volume, volumeIndex) => {
          if (volume.id === liveVolume.id) return completedVolume;
          if (operation === 'revise' && volumeIndex === activeVolumeIndex + 1) {
            const incoming = completedVolume.handoff?.outgoing ?? completedVolume.summary;
            return incoming
              ? { ...volume, handoff: { ...(volume.handoff ?? {}), incoming } }
              : volume;
          }
          return volume;
        }),
      };
      const candidateOutline = operation === 'revise'
        ? reindexOutline(candidateBeforeNormalize, getOutlineBaseChapterIndex(candidateBeforeNormalize, currentNovel))
        : candidateBeforeNormalize;
      const proposalId = saveNovelOutlineProposal(currentNovel.id, {
        scopeId,
        operation,
        prompt: [
          `${outlineOperationLabel(operation)}：${mode === 'guided' ? brief.trim() : '根据当前卷设定生成章节计划'}`,
          liveVolume.summary.trim() ? `本卷设定：${liveVolume.summary.trim()}` : '',
          operation === 'append'
            ? `只追加 ${requestedAppendCount} 章；不得修改、删除或重排已有章节。`
            : operation === 'revise'
              ? '修改整卷结构；允许新增、合并、删除或改写章节，最终章数按剧情决定。'
              : '',
        ]
          .filter(Boolean)
          .join('\n'),
        candidateOutline,
        targetVolumeId: liveVolume.id,
        tokens: result.tokens,
      });
      if (!proposalId) {
        throw new Error('无法保存大纲提案，请刷新页面后重试。');
      }
      setVolumeDraft(null);
      setChapterDraftOutline(null);
      setChapterEditMode(null);
      setWorkspaceStep('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : '本卷生成失败。';
      showAppAlert(
        '本次提案未生成',
        `当前模型提供方拒绝或未能完成该请求。现有大纲和章节未发生任何修改。${message ? `\n\n${message}` : ''}`,
      );
    } finally {
      setGeneratingVolumeId(null);
    }
  }

  async function requestGenerateSelectedVolume() {
    if (!activeVolume) return;
    if (activeOperation === 'reorder') {
      if (!chapterDraftOutline) {
        setChapterDraftOutline(cloneOutline(outline!));
        setChapterEditMode('reorder');
      }
      return;
    }
    if (volumeStatus(activeVolume) === 'ready') {
      const confirmed = await confirmAppAction(
        `生成${outlineOperationLabel(activeOperation)}提案`,
        `AI 只会生成“${outlineOperationLabel(activeOperation)}”待审阅提案，当前卷原文不会被直接替换。确认继续？`,
        { confirmLabel: '生成提案' },
      );
      if (!confirmed) return;
    }
    await generateSelectedVolume();
  }

  async function removeSelectedVolume() {
    if (!activeVolume || !outline) return;
    const confirmed = await confirmAppAction('删除当前卷', '只会删除当前卷及其章节计划，正文内容不会被删除。确认继续？', { confirmLabel: '删除卷' });
    if (!confirmed) return;
    const nextVolumes = volumes.filter((volume) => volume.id !== activeVolume.id);
    persistOutline({ ...outline, volumes: nextVolumes });
    setSelectedVolumeId(nextVolumes[Math.max(0, activeVolumeIndex - 1)]?.id ?? nextVolumes[0]?.id ?? null);
    setVolumeDraft(null);
    setChapterDraftOutline(null);
    setChapterEditMode(null);
    setSelectedChapterIndex(null);
  }

  function selectVolume(volumeId: string) {
    setSelectedVolumeId(volumeId);
    setVolumeDraft(null);
    setChapterDraftOutline(null);
    setChapterEditMode(null);
    setOutlineOperation(null);
    setSelectedChapterIndex(null);
    setChapterAiPrompt('');
    setShowVolumeSettings(false);
    setShowVolumeAi(false);
    setShowHandoff(false);
  }

  function selectChapter(chapterIndex: number) {
    if (chapterDraftOutline) return;
    setSelectedChapterIndex((current) => current === chapterIndex ? null : chapterIndex);
    setChapterAiPrompt('');
  }

  function startChapterEditing(chapterIndex: number) {
    if (outline) {
      setSelectedChapterIndex(chapterIndex);
      setChapterDraftOutline(cloneOutline(outline));
      setChapterEditMode('content');
    }
  }

  function cancelChapterEditing() {
    setChapterDraftOutline(null);
    setChapterEditMode(null);
  }

  function updateChapter(chapterIndex: number, field: 'title' | 'goal', value: string) {
    setChapterDraftOutline((current) => {
      if (!current || !activeVolumeId) return current;
      return {
        ...current,
        volumes: current.volumes.map((volume) => volume.id !== activeVolumeId
          ? volume
          : { ...volume, chapters: volume.chapters.map((chapter, index) => index === chapterIndex ? { ...chapter, [field]: value } : chapter) }),
      };
    });
  }

  function saveChapterEditing() {
    if (!chapterDraftOutline) return;
    persistOutline(chapterDraftOutline);
    setChapterDraftOutline(null);
    setChapterEditMode(null);
  }

  async function generateChapterRevision(chapterIndex: number) {
    if (!outline || !activeVolume || generatingChapterIndex !== null) return;
    const instruction = chapterAiPrompt.trim();
    if (!instruction) {
      showAppAlert('还缺少修改指令', '请说明这一章要改成什么方向，例如调整冲突、替换出场人物或改变结尾钩子。');
      return;
    }
    const target = activeVolume.chapters.find((chapter) => chapter.index === chapterIndex);
    if (!target) return;

    setGeneratingChapterIndex(chapterIndex);
    try {
      const scopedNovel = isWorldScope && currentWorld
        ? { ...currentNovel, quickTravel: { ...currentArchive, activeWorldId: currentWorld.id } }
        : currentNovel;
      const result = await generateNovelOutlineChapterRevision({
        apiSettings: resolveApiSettings(providers, generationSettings, { purpose: 'utility' }),
        novel: scopedNovel,
        volume: activeVolume,
        chapterIndex,
        instruction,
        analysis: currentNovel.novelStoryAnalysis ?? null,
        worldContext: isWorldScope ? buildQuickTravelContext(scopedNovel) : undefined,
      });
      const revisedVolume: NovelVolumePlan = {
        ...activeVolume,
        chapters: activeVolume.chapters.map((chapter) => chapter.index === chapterIndex ? result.chapter : chapter),
      };
      const candidateOutline: NovelOutline = {
        ...outline,
        volumes: outline.volumes.map((volume) => volume.id === activeVolume.id ? revisedVolume : volume),
        updatedAt: new Date().toISOString(),
      };
      const proposalId = saveNovelOutlineProposal(currentNovel.id, {
        scopeId,
        operation: 'revise',
        prompt: `只修改第 ${chapterIndex} 章：${instruction}`,
        candidateOutline,
        targetVolumeId: activeVolume.id,
        targetChapterIndexes: [chapterIndex],
        tokens: result.tokens,
      });
      if (!proposalId) throw new Error('无法保存单章修改提案，请刷新页面后重试。');
      setChapterAiPrompt('');
      setWorkspaceStep('review');
    } catch (error) {
      showAppAlert('单章修改未生成', error instanceof Error ? error.message : '模型未能完成这次单章修改。');
    } finally {
      setGeneratingChapterIndex(null);
    }
  }

  async function removeChapter(chapterIndex: number) {
    if (!activeVolume || !outline || chapterDraftOutline) return;
    const chapter = activeVolume.chapters.find((item) => item.index === chapterIndex);
    if (!chapter) return;
    const confirmed = await confirmAppAction(
      `删除第 ${chapter.index} 章`,
      `将从“${activeVolume.title || `第 ${activeVolumeIndex + 1} 卷`}”的章节计划中删除《${chapter.title || '未命名章节'}》。正文内容不会被删除，后续大纲章号会自动重排。确认继续？`,
      { confirmLabel: '删除章节' },
    );
    if (!confirmed) return;
    const nextVolume: NovelVolumePlan = {
      ...activeVolume,
      chapters: activeVolume.chapters.filter((item) => item.index !== chapterIndex),
      plannedChapterCount: Math.max(1, (activeVolume.plannedChapterCount ?? activeVolume.chapters.length) - 1),
      status: 'draft',
      generationError: undefined,
    };
    persistOutline({
      ...outline,
      volumes: volumes.map((volume) => volume.id === activeVolume.id ? nextVolume : volume),
      updatedAt: new Date().toISOString(),
    });
    setChapterDraftOutline(null);
    setChapterEditMode(null);
  }

  function clearOutline() {
    if (!outline) return;
    void (async () => {
      const confirmed = await confirmAppAction(
        isWorldScope ? '清空当前世界大纲' : '清空全书大纲',
        '只会移除卷和章节计划，已生成的正文不会被删除。确认继续？',
        { confirmLabel: '清空大纲' },
      );
      if (!confirmed) return;
      clearNovelOutlineAtScope(currentNovel.id, scopeId, '清空大纲前快照');
      setSelectedVolumeId(null);
      setVolumeDraft(null);
      setChapterDraftOutline(null);
      setChapterEditMode(null);
      setOutlineOperation(null);
    })();
  }

  function acceptPendingProposal() {
    if (!pendingProposal) return;
    const result = acceptNovelOutlineProposal(currentNovel.id, pendingProposal.id);
    if (!result.ok) {
      showAppAlert(
        result.reason === 'conflict' ? '提案已过期' : '无法采纳提案',
        result.reason === 'conflict'
          ? '当前大纲在生成提案后发生了变化，请基于最新版本重新生成。'
          : '提案内容已失效，请重新生成。',
      );
      return;
    }
    setChapterDraftOutline(null);
    setChapterEditMode(null);
    setVolumeDraft(null);
    setWorkspaceStep('volume');
  }

  function rejectPendingProposal() {
    if (!pendingProposal) return;
    rejectNovelOutlineProposal(currentNovel.id, pendingProposal.id);
  }

  async function deleteOutlineProposal(proposal: NovelOutlineProposal) {
    const confirmed = await confirmAppAction(
      '删除提案',
      `将永久删除“${outlineOperationLabel(proposal.operation)}”提案记录，不会修改当前大纲。确认继续？`,
      { confirmLabel: '删除提案' },
    );
    if (!confirmed) return;
    deleteNovelOutlineProposal(currentNovel.id, proposal.id);
    if (pendingProposal?.id === proposal.id) {
      setShowProposalDiff(false);
    }
  }

  async function deleteOutlineVersion(versionId: string) {
    const confirmed = await confirmAppAction(
      '删除历史快照',
      '只会删除这条恢复记录，不会修改当前大纲，也不会删除正文。确认继续？',
      { confirmLabel: '删除快照' },
    );
    if (!confirmed) return;
    deleteNovelOutlineVersion(currentNovel.id, versionId);
  }

  async function restoreOutlineVersion(versionId: string) {
    const version = outlineVersions.find((item) => item.id === versionId);
    if (!version) return;
    const confirmed = await confirmAppAction(
      '生成恢复提案',
      '历史快照会先作为待审阅提案出现，当前大纲不会立即被替换。确认继续？',
      { confirmLabel: '生成提案' },
    );
    if (!confirmed) return;
    const proposalId = saveNovelOutlineProposal(currentNovel.id, {
      scopeId,
      operation: 'create',
      prompt: `从历史版本 ${formatOutlineVersionDate(version.createdAt)} 创建恢复提案`,
      candidateOutline: version.outline,
    });
    if (!proposalId) showAppAlert('恢复提案失败', '历史版本已失效，请刷新页面后重试。');
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <Stack.Screen options={{ title: isWorldScope ? `${currentWorld?.name ?? '小世界'}大纲` : '全书大纲', headerShown: true }} />
      <ScrollView contentContainerStyle={[styles.content, isCompact && styles.contentCompact]} keyboardShouldPersistTaps="handled">
        <Animated.View style={[styles.pageStage, {
          opacity: pageReveal,
          transform: [
            { translateY: pageReveal.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
            { scale: pageReveal.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
          ],
        }]}>
        <View style={[styles.heroShell, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <View pointerEvents="none" style={[styles.heroArc, { borderColor: theme.accent }]} />
          <View style={[styles.titleRow, isCompact && styles.titleRowCompact]}>
            <View style={[styles.titleCopy, isCompact && styles.titleCopyCompact]}>
              <ThemedText type="code" themeColor="accent">STORY CARTOGRAPHY / {isWorldScope ? 'LOCAL ARC' : 'MASTER ARC'}</ThemedText>
              <ThemedText type="title">{isWorldScope ? `${currentWorld?.name ?? '小世界'} · 叙事航图` : `${currentNovel.name} · 叙事航图`}</ThemedText>
              <ThemedText type="small" themeColor="textMuted">全书定方向，分卷定阶段，单章定动作。AI 的每次修改都先进入提案，不直接覆盖正式大纲。</ThemedText>
            </View>
            <View style={[styles.heroTelemetry, isCompact && styles.heroTelemetryCompact]}>
              <ThemedText type="code" themeColor="accent">{String(volumes.length).padStart(2, '0')} VOLUMES</ThemedText>
              <ThemedText type="code" themeColor="textMuted">{String(bookChapterCount).padStart(2, '0')} CHAPTERS</ThemedText>
              <ThemedText type="code" themeColor="textMuted">{bookWordCount.toLocaleString()} WORDS</ThemedText>
              {activeVolume ? <Pressable disabled={Boolean(generatingVolumeId || chapterDraftOutline || generatingWholeBook)} onPress={() => { if (volumeDraft) saveVolumeSettings(); router.push({ pathname: '/novel/planning', params: { kind: 'volume', novelId: currentNovel.id, volumeId: activeVolume.id, ...(isWorldScope && currentWorld ? { worldId: currentWorld.id } : {}) } } as Href); }} style={[styles.secondaryButton, { borderColor: theme.accent, opacity: generatingVolumeId || chapterDraftOutline || generatingWholeBook ? 0.45 : 1 }]}><ThemedText type="smallBold" themeColor="accent">AI 规划本卷</ThemedText></Pressable> : null}
            </View>
          </View>
          <Animated.View pointerEvents="none" style={[styles.signalLine, { backgroundColor: theme.accent, transform: [{ scaleX: pageReveal }] }]} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.stepRail, isCompact && styles.stepRailCompact]}>
          {stepTabs}
        </ScrollView>

        {workspaceStep === 'book' ? <>
        <View style={[styles.bookCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <View style={[styles.cardHeader, isCompact && styles.cardHeaderCompact]}>
            <ThemedText type="subtitle">{isWorldScope ? '小世界设定' : '全书设定'}</ThemedText>
            <ThemedText type="small" themeColor="textMuted">{bookChapterCount} 章 · {bookWordCount.toLocaleString()} 字 · {volumes.length} 卷</ThemedText>
          </View>
          <TextInput value={bookSummary} onChangeText={setBookSummaryDraft} multiline placeholder="全书主线、结局方向和必须保留的冲突" placeholderTextColor={theme.textMuted} style={[styles.input, styles.summaryInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} />
          <Pressable onPress={saveBookSummary} style={[styles.secondaryButton, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" themeColor="accent">保存设定并进入卷结构</ThemedText>
          </Pressable>
        </View>

        {!isWorldScope ? <View style={[styles.bookActionCard, { borderColor: theme.accent, backgroundColor: theme.accentMuted }]}>
          <View style={[styles.cardHeader, isCompact && styles.cardHeaderCompact]}>
            <View style={styles.titleCopy}>
              <ThemedText type="subtitle">生成全书提案</ThemedText>
              <ThemedText type="small" themeColor="textMuted">这是整本书级别的操作。适合第一次搭建或明确要重做整体结构时使用。</ThemedText>
            </View>
            <ThemedText type="code" themeColor="accent">只生成候选</ThemedText>
          </View>
          <View style={styles.modeRow}>
            {([
              ['guided', '按我的设定'],
              ['auto', 'AI 自主规划'],
            ] as const).map(([value, label]) => (
              <Pressable key={value} onPress={() => setWholeBookMode(value)} style={[styles.mode, { borderColor: wholeBookMode === value ? theme.accent : theme.border, backgroundColor: wholeBookMode === value ? theme.surface : theme.background }]}>
                <ThemedText type="smallBold" themeColor={wholeBookMode === value ? 'accent' : 'textMuted'}>{label}</ThemedText>
              </Pressable>
            ))}
          </View>
          {wholeBookMode === 'guided' ? <TextInput value={wholeBookPrompt} onChangeText={setWholeBookPrompt} multiline placeholder="写清主线、结局方向、角色关系和不能改动的设定" placeholderTextColor={theme.textMuted} style={[styles.input, styles.brief, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} /> : null}
            <View style={[styles.numberRow, isCompact && styles.numberRowCompact]}>
            <View style={[styles.fieldGroup, isCompact && styles.fieldGroupCompact]}><ThemedText type="small" themeColor="textMuted">规划章节数</ThemedText><TextInput value={wholeBookChapterCount} onChangeText={setWholeBookChapterCount} keyboardType="number-pad" style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} /></View>
            <View style={[styles.fieldGroup, isCompact && styles.fieldGroupCompact]}><ThemedText type="small" themeColor="textMuted">每章字数</ThemedText><TextInput value={wholeBookWordsPerChapter} onChangeText={setWholeBookWordsPerChapter} keyboardType="number-pad" style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} /></View>
          </View>
          <Pressable disabled={generatingWholeBook} onPress={() => void requestGenerateWholeBook()} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: generatingWholeBook ? 0.55 : 1 }, isCompact && styles.fullWidthButton]}>
            {generatingWholeBook ? <ActivityIndicator color={theme.onPrimary} /> : null}
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{generatingWholeBook ? '正在生成全书提案…' : novel.outline ? '生成全书修订提案' : '生成全书提案'}</ThemedText>
          </Pressable>
        </View> : null}
        </> : null}

        {workspaceStep === 'review' && pendingProposal ? (
          <View style={[styles.proposalCard, { borderColor: theme.accent, backgroundColor: theme.accentMuted }]}>
            <View style={[styles.cardHeader, isCompact && styles.cardHeaderCompact]}>
              <View style={styles.titleCopy}>
                <ThemedText type="subtitle">待审阅提案 · #{pendingProposal.id.slice(-6)}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {outlineOperationLabel(pendingProposal.operation)} · 基于当前版本生成。采纳前不会改动正式大纲。
                </ThemedText>
              </View>
              <ThemedText type="code" themeColor="accent">待审阅</ThemedText>
            </View>
            {proposalChanges ? (
              <ThemedText type="small" themeColor="textMuted">
                预计变化：新增 {proposalChanges.addedChapters} 章 · 修改 {proposalChanges.changedChapters} 章 · 删除 {proposalChanges.deletedChapters} 章 · 顺序变化 {proposalChanges.reorderedChapters} 章
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textMuted">
              基准版本：{pendingProposal.baseVersionId ? pendingProposal.baseVersionId.slice(-8) : '初始大纲'} · 当前章节列表仍是正式版本
            </ThemedText>
            {pendingProposalVolume ? (
              <View style={[styles.proposalPreview, { borderColor: theme.border, backgroundColor: theme.background }]}>
                <ThemedText type="smallBold">{pendingProposalVolume.title}</ThemedText>
                {pendingProposalVolume.summary ? <ThemedText type="small" themeColor="textMuted">{pendingProposalVolume.summary}</ThemedText> : null}
                {pendingProposalVolume.chapters.slice(0, 8).map((chapter) => (
                  <ThemedText key={`proposal-${pendingProposal.id}-${chapter.index}`} type="small">
                    第 {chapter.index} 章《{chapter.title}》：{chapter.goal}
                  </ThemedText>
                ))}
                {pendingProposalVolume.chapters.length > 8 ? <ThemedText type="small" themeColor="textMuted">还有 {pendingProposalVolume.chapters.length - 8} 章未展开</ThemedText> : null}
              </View>
            ) : null}
            <Pressable onPress={() => setShowProposalDiff((current) => !current)} style={styles.diffToggle}>
              <ThemedText type="smallBold" themeColor="accent">{showProposalDiff ? '收起差异' : '查看差异'}{proposalDiff.length ? `（${proposalDiff.length} 项）` : ''}</ThemedText>
            </Pressable>
            {showProposalDiff ? (
              <View style={[styles.diffPanel, { borderColor: theme.border, backgroundColor: theme.background }]}>
                {proposalDiff.length === 0 ? <ThemedText type="small" themeColor="textMuted">当前卷没有可展示的章节差异。</ThemedText> : proposalDiff.map((item) => (
                  <View key={`${item.kind}-${item.index}`} style={[styles.diffRow, { borderTopColor: theme.border }]}>
                    <ThemedText type="smallBold" themeColor={item.kind === '删除' ? 'error' : item.kind === '新增' ? 'accent' : undefined}>{item.kind} · 第 {item.index} 章</ThemedText>
                    {item.before ? <ThemedText type="small" themeColor="textMuted">当前：{item.before.title}｜{item.before.goal}</ThemedText> : null}
                    {item.after ? <ThemedText type="small">提案：{item.after.title}｜{item.after.goal}</ThemedText> : null}
                  </View>
                ))}
              </View>
            ) : null}
            <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
              <Pressable onPress={rejectPendingProposal} style={[styles.secondaryButton, { borderColor: theme.border }, isCompact && styles.buttonCompact]}>
                <ThemedText type="smallBold" themeColor="textMuted">丢弃提案</ThemedText>
              </Pressable>
              <Pressable onPress={() => void deleteOutlineProposal(pendingProposal)} style={[styles.secondaryButton, { borderColor: theme.error }, isCompact && styles.buttonCompact]}>
                <ThemedText type="smallBold" themeColor="error">删除提案</ThemedText>
              </Pressable>
              <Pressable onPress={acceptPendingProposal} style={[styles.primaryButton, { backgroundColor: theme.accent }, isCompact && styles.buttonCompact]}>
                <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{pendingProposal.operation === 'create' ? '采纳为当前大纲' : '采纳提案'}</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}

        {workspaceStep === 'review' && !pendingProposal && conflictedProposal ? (
          <View style={[styles.conflictCard, { borderColor: theme.error, backgroundColor: theme.errorContainer }]}>
            <ThemedText type="subtitle" themeColor="error">提案存在冲突</ThemedText>
            <ThemedText type="small" themeColor="error">此提案基于旧版本，当前大纲已经更新；为避免覆盖新内容，采纳已被阻止。{conflictedProposal.error ? `\n${conflictedProposal.error}` : ''}</ThemedText>
            <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
              <Pressable onPress={() => void deleteOutlineProposal(conflictedProposal)} style={[styles.secondaryButton, { borderColor: theme.error }, isCompact && styles.buttonCompact]}>
                <ThemedText type="smallBold" themeColor="error">删除提案</ThemedText>
              </Pressable>
              <Pressable onPress={() => void requestGenerateSelectedVolume()} style={[styles.secondaryButton, { borderColor: theme.error }, isCompact && styles.buttonCompact]}>
                <ThemedText type="smallBold" themeColor="error">基于当前版本重新生成提案</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : null}

        {workspaceStep === 'review' && proposalHistory.length > 0 ? (
          <View style={[styles.historyCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={[styles.cardHeader, isCompact && styles.cardHeaderCompact]}>
              <View>
                <ThemedText type="subtitle">提案记录</ThemedText>
                <ThemedText type="small" themeColor="textMuted">这里保存生成、采纳和丢弃记录；删除只移除记录，不会回滚当前大纲。</ThemedText>
              </View>
            </View>
            {proposalHistory.map((proposal) => (
              <View key={proposal.id} style={[styles.historyRow, { borderTopColor: theme.border }, isCompact && styles.historyRowCompact]}>
                <View style={styles.titleCopy}>
                  <ThemedText type="smallBold">{outlineOperationLabel(proposal.operation)} · {proposalStatusLabel(proposal.status)}</ThemedText>
                  <ThemedText type="small" themeColor="textMuted">{formatOutlineVersionDate(proposal.createdAt)} · {proposal.prompt || '无提示词'}</ThemedText>
                </View>
                <Pressable onPress={() => void deleteOutlineProposal(proposal)} style={[styles.secondaryButton, { borderColor: theme.error }]}>
                  <ThemedText type="smallBold" themeColor="error">删除提案</ThemedText>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {workspaceStep === 'review' && outlineVersions.length > 0 ? (
          <View style={[styles.historyCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={[styles.cardHeader, isCompact && styles.cardHeaderCompact]}>
              <View>
                <ThemedText type="subtitle">大纲历史快照</ThemedText>
                <ThemedText type="small" themeColor="textMuted">手动编辑、采纳提案和恢复操作都会留下可回滚版本。</ThemedText>
              </View>
            </View>
            {outlineVersions.map((version) => (
              <View key={version.id} style={[styles.historyRow, { borderTopColor: theme.border }, isCompact && styles.historyRowCompact]}>
              <View style={styles.titleCopy}>
                <ThemedText type="smallBold">{version.source === 'ai_accept' ? '采纳 AI 提案' : version.source === 'restore' ? '恢复版本' : '手动编辑'}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">{formatOutlineVersionDate(version.createdAt)} · {version.reason ?? '无备注'}</ThemedText>
              </View>
                <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
                  <Pressable onPress={() => void restoreOutlineVersion(version.id)} style={[styles.secondaryButton, { borderColor: theme.border }]}>
                    <ThemedText type="smallBold" themeColor="accent">生成恢复提案</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => void deleteOutlineVersion(version.id)} style={[styles.secondaryButton, { borderColor: theme.error }]}>
                    <ThemedText type="smallBold" themeColor="error">删除快照</ThemedText>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {workspaceStep === 'review' && !pendingProposal && !conflictedProposal && proposalHistory.length === 0 && outlineVersions.length === 0 ? (
          <View style={[styles.emptyCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <ThemedText type="subtitle">还没有待审阅提案</ThemedText>
            <ThemedText type="small" themeColor="textMuted">先在“全书设定”生成全书提案，或在“卷与章节”里选择一个卷生成局部提案。</ThemedText>
            <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
              <Pressable onPress={() => setWorkspaceStep('book')} style={[styles.secondaryButton, { borderColor: theme.border }, isCompact && styles.buttonCompact]}><ThemedText type="smallBold" themeColor="accent">去写全书设定</ThemedText></Pressable>
              <Pressable onPress={() => setWorkspaceStep('volume')} style={[styles.primaryButton, { backgroundColor: theme.accent }, isCompact && styles.buttonCompact]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>去卷与章节</ThemedText></Pressable>
            </View>
          </View>
        ) : null}

        {workspaceStep === 'volume' ? (volumes.length > 0 ? (
          <View style={[styles.volumeNavigator, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={[styles.sectionHeader, isCompact && styles.sectionHeaderCompact]}>
              <View style={styles.titleCopy}>
                <ThemedText type="code" themeColor="accent">VOLUME ROUTE / 分卷航线</ThemedText>
                <ThemedText type="subtitle">选择当前工作卷</ThemedText>
                <ThemedText type="small" themeColor="textMuted">这里只负责定位。卷设置、AI 操作和章节内容在下方按需展开。</ThemedText>
              </View>
              <View style={[styles.navigatorActions, isCompact && styles.actionRowCompact]}>
                <Pressable onPress={buildVolume} style={[styles.primarySmallButton, { backgroundColor: theme.accent }, isCompact && styles.buttonCompact]}>
                  <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>＋ 新建卷</ThemedText>
                </Pressable>
                <Pressable onPress={clearOutline} style={styles.quietAction}><ThemedText type="small" themeColor="textMuted">清空全部</ThemedText></Pressable>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.volumeRail}>
              {volumes.map((volume, index) => {
                const selected = volume.id === activeVolumeId;
                const status = volumeStatus(volume);
                const volumeHasPendingProposal = (novel?.outlineProposals ?? []).some((proposal) => {
                  if (proposal.scopeId !== scopeId || proposal.status !== 'pending') return false;
                  return proposal.patch.op === 'replace_outline'
                    || ('volumeId' in proposal.patch && proposal.patch.volumeId === volume.id);
                });
                return (
                  <Pressable key={volume.id} onPress={() => selectVolume(volume.id)} style={[styles.volumeTab, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accentMuted : theme.background }]}>
                    <View style={styles.volumeTabTopline}>
                      <ThemedText type="code" themeColor={selected ? 'accent' : 'textMuted'}>{String(index + 1).padStart(2, '0')}</ThemedText>
                      <ThemedText type="code" themeColor={volumeHasPendingProposal ? 'accent' : 'textMuted'}>{volumeHasPendingProposal ? '待审阅' : statusLabel(status)}</ThemedText>
                    </View>
                    <ThemedText type="smallBold" numberOfLines={1}>{volume.title || `第 ${index + 1} 卷`}</ThemedText>
                    <ThemedText type="small" themeColor="textMuted">{volume.chapters.length}/{volumeChapterCount(volume, 20)} 章 · {volumeWordsPerChapter(volume, defaultWordsPerChapter).toLocaleString()} 字/章</ThemedText>
                    {selected ? <View style={[styles.activeRouteMark, { backgroundColor: theme.accent }]} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : (
          <View style={[styles.emptyCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <ThemedText type="subtitle">还没有卷</ThemedText>
            <ThemedText type="small" themeColor="textMuted">点击“创建卷”，先定义卷名、章节数量和每章字数，再生成这一卷的章节提案。</ThemedText>
            <Pressable onPress={buildVolume} style={[styles.primaryButton, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>创建第一卷</ThemedText></Pressable>
          </View>
        )) : null}

        {workspaceStep === 'volume' && activeVolume && activeVolumeDraft && displayedVolume ? (
          <View style={[styles.volumeEditor, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={[styles.volumeCommand, isCompact && styles.volumeCommandCompact, { borderBottomColor: theme.border }]}>
              <View style={styles.volumeIdentity}>
                <ThemedText type="code" themeColor="accent">VOLUME {String(activeVolumeIndex + 1).padStart(2, '0')} / {statusLabel(volumeStatus(activeVolume))}</ThemedText>
                <ThemedText type="title">{activeVolumeDraft.title || '未命名卷'}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">{activeVolumeDraft.summary || '尚未填写本卷冲突与收束方向。'}</ThemedText>
              </View>
              <View style={[styles.commandActions, isCompact && styles.commandActionsCompact]}>
                <Pressable onPress={() => { setShowVolumeSettings((current) => !current); setShowVolumeAi(false); }} style={[styles.commandButton, { borderColor: showVolumeSettings ? theme.accent : theme.border, backgroundColor: showVolumeSettings ? theme.accentMuted : theme.background }]}>
                  <ThemedText type="smallBold" themeColor={showVolumeSettings ? 'accent' : undefined}>{showVolumeSettings ? '收起卷设置' : '卷设置'}</ThemedText>
                </Pressable>
                <Pressable onPress={() => { setShowVolumeAi((current) => !current); setShowVolumeSettings(false); }} style={[styles.commandButton, { borderColor: showVolumeAi ? theme.accent : theme.border, backgroundColor: showVolumeAi ? theme.accentMuted : theme.background }]}>
                  <ThemedText type="smallBold" themeColor={showVolumeAi ? 'accent' : undefined}>{showVolumeAi ? '收起卷级 AI' : '卷级 AI'}</ThemedText>
                </Pressable>
                <Pressable onPress={() => void removeSelectedVolume()} style={styles.quietAction}><ThemedText type="small" themeColor="textMuted">删除本卷</ThemedText></Pressable>
              </View>
            </View>

            <View style={styles.metricStrip}>
              <View style={[styles.metricCell, { borderColor: theme.border }]}><ThemedText type="code" themeColor="accent">{displayedVolume.chapters.length}</ThemedText><ThemedText type="small" themeColor="textMuted">已规划章节</ThemedText></View>
              <View style={[styles.metricCell, { borderColor: theme.border }]}><ThemedText type="code" themeColor="accent">{volumeChapterCount(activeVolume, 20)}</ThemedText><ThemedText type="small" themeColor="textMuted">目标章节</ThemedText></View>
              <View style={[styles.metricCell, { borderColor: theme.border }]}><ThemedText type="code" themeColor="accent">{volumeWordsPerChapter(activeVolume, defaultWordsPerChapter).toLocaleString()}</ThemedText><ThemedText type="small" themeColor="textMuted">每章字数</ThemedText></View>
              <View style={[styles.metricCell, { borderColor: theme.border }]}><ThemedText type="code" themeColor="accent">{currentVersion ? currentVersion.id.slice(-6) : '—'}</ThemedText><ThemedText type="small" themeColor="textMuted">当前版本</ThemedText></View>
            </View>

            {showVolumeSettings ? <View style={[styles.foldoutPanel, { borderColor: theme.border, backgroundColor: theme.background }]}>
              <View style={styles.panelLabelRow}><ThemedText type="code" themeColor="accent">01 / VOLUME PARAMETERS</ThemedText><ThemedText type="small" themeColor="textMuted">仅保存结构参数，不调用 AI</ThemedText></View>
              <View style={styles.fieldGroup}><ThemedText type="small" themeColor="textMuted">卷名</ThemedText><TextInput value={activeVolumeDraft.title} onChangeText={(value) => setVolumeDraft({ ...activeVolumeDraft, title: value })} placeholder="例如：灰烬之城" placeholderTextColor={theme.textMuted} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} /></View>
              <View style={styles.fieldGroup}><ThemedText type="small" themeColor="textMuted">卷摘要</ThemedText><TextInput value={activeVolumeDraft.summary} onChangeText={(value) => setVolumeDraft({ ...activeVolumeDraft, summary: value })} multiline placeholder="这一卷解决什么冲突，卷末状态发生什么变化" placeholderTextColor={theme.textMuted} style={[styles.input, styles.volumeSummaryInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} /></View>
              <View style={[styles.numberRow, isCompact && styles.numberRowCompact]}>
                <View style={[styles.fieldGroup, isCompact && styles.fieldGroupCompact]}><ThemedText type="small" themeColor="textMuted">目标章节</ThemedText><TextInput value={activeVolumeDraft.plannedChapterCount} onChangeText={(value) => setVolumeDraft({ ...activeVolumeDraft, plannedChapterCount: value })} keyboardType="number-pad" style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} /></View>
                <View style={[styles.fieldGroup, isCompact && styles.fieldGroupCompact]}><ThemedText type="small" themeColor="textMuted">每章字数</ThemedText><TextInput value={activeVolumeDraft.wordsPerChapter} onChangeText={(value) => setVolumeDraft({ ...activeVolumeDraft, wordsPerChapter: value })} keyboardType="number-pad" style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} /></View>
                <View style={[styles.fieldGroup, isCompact && styles.fieldGroupCompact]}><ThemedText type="small" themeColor="textMuted">预计总字数</ThemedText><View style={[styles.input, styles.derivedInput, { borderColor: theme.border, backgroundColor: theme.surface }]}><ThemedText style={{ color: theme.text }}>{calculateNovelOutlineTotalWords(activeVolumeDraft.plannedChapterCount, activeVolumeDraft.wordsPerChapter).toLocaleString()}</ThemedText></View></View>
              </View>
              <View style={styles.fieldGroup}><ThemedText type="small" themeColor="textMuted">上一卷交接</ThemedText><TextInput value={activeVolumeDraft.incomingHandoff} onChangeText={(value) => setVolumeDraft({ ...activeVolumeDraft, incomingHandoff: value })} multiline placeholder={activeVolumeIndex > 0 ? '上一卷结尾状态与尚未解决的线索' : '第一卷可以留空'} placeholderTextColor={theme.textMuted} style={[styles.input, styles.handoffInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} /></View>
              <Pressable onPress={saveVolumeSettings} style={[styles.primaryButton, { backgroundColor: theme.accent }, isCompact && styles.fullWidthButton]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>保存卷设置</ThemedText></Pressable>
            </View> : null}

            {showVolumeAi ? <View style={[styles.foldoutPanel, { borderColor: theme.accent, backgroundColor: theme.accentMuted }]}>
              <View style={styles.panelLabelRow}><ThemedText type="code" themeColor="accent">02 / VOLUME MACHINE</ThemedText><ThemedText type="small" themeColor="textMuted">只生成当前卷候选</ThemedText></View>
              <View style={styles.modeRow}>
                {([['guided', '按我的梗概'], ['auto', 'AI 自主规划']] as const).map(([value, label]) => <Pressable key={value} onPress={() => setMode(value)} style={[styles.mode, { borderColor: mode === value ? theme.accent : theme.border, backgroundColor: mode === value ? theme.surface : theme.background }]}><ThemedText type="smallBold" themeColor={mode === value ? 'accent' : 'textMuted'}>{label}</ThemedText></Pressable>)}
              </View>
              {mode === 'guided' ? <TextInput value={brief} onChangeText={setBrief} multiline placeholder="写本卷关键转折、必须保留的情节或卷末状态" placeholderTextColor={theme.textMuted} style={[styles.input, styles.brief, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} /> : null}
              <Pressable onPress={() => setOperationMenuOpen((current) => !current)} style={[styles.operationSelect, { borderColor: theme.border, backgroundColor: theme.surface }]}><ThemedText type="smallBold" themeColor="accent">{outlineOperationLabel(activeOperation)} ▾</ThemedText></Pressable>
              {operationMenuOpen ? <View style={[styles.operationMenu, { borderColor: theme.border, backgroundColor: theme.surface }]}>{OUTLINE_OPERATION_OPTIONS.map((option) => <Pressable key={option.value} onPress={() => selectOutlineOperation(option.value)} style={[styles.operationOption, { borderTopColor: theme.border, backgroundColor: activeOperation === option.value ? theme.accentMuted : theme.surface }]}><ThemedText type="smallBold" themeColor={activeOperation === option.value ? 'accent' : undefined}>{option.label}</ThemedText><ThemedText type="small" themeColor="textMuted">{option.description}</ThemedText></Pressable>)}</View> : null}
              {activeOperation === 'append' ? <View style={styles.appendCountRow}><ThemedText type="small" themeColor="textMuted">追加</ThemedText><TextInput value={appendChapterCount} onChangeText={setAppendChapterCount} keyboardType="number-pad" style={[styles.appendCountInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} /><ThemedText type="small" themeColor="textMuted">章</ThemedText></View> : null}
              <ThemedText type="small" themeColor="textMuted">{OUTLINE_OPERATION_OPTIONS.find((option) => option.value === activeOperation)?.description}</ThemedText>
              <Pressable disabled={Boolean(generatingVolumeId)} onPress={() => void requestGenerateSelectedVolume()} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: generatingVolumeId ? 0.55 : 1 }, isCompact && styles.fullWidthButton]}>{generatingVolumeId === activeVolume.id ? <ActivityIndicator color={theme.onPrimary} /> : null}<ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{generatingVolumeId === activeVolume.id ? '正在绘制候选航线…' : activeOperation === 'reorder' ? '进入章节排序' : `生成${outlineOperationLabel(activeOperation)}提案`}</ThemedText></Pressable>
            </View> : null}

            {activeVolume.handoff?.outgoing ? <View style={[styles.handoffCard, { borderColor: theme.border, backgroundColor: theme.background }]}><Pressable onPress={() => setShowHandoff((current) => !current)} style={styles.panelLabelRow}><View style={styles.titleCopy}><ThemedText type="code" themeColor="accent">OUTGOING / 卷末交接</ThemedText><ThemedText type="small" themeColor="textMuted">已建立下一卷所需的连续性摘要</ThemedText></View><ThemedText type="code" themeColor="accent">{showHandoff ? 'COLLAPSE ↑' : 'EXPAND ↓'}</ThemedText></Pressable>{showHandoff ? <ThemedText type="small" themeColor="textMuted">{activeVolume.handoff.outgoing}</ThemedText> : null}</View> : null}

            <View style={[styles.chapterHeader, isCompact && styles.chapterHeaderCompact]}>
              <View style={styles.titleCopy}>
                <ThemedText type="code" themeColor="accent">CHAPTER SEQUENCE / 章节轨道</ThemedText>
                <ThemedText type="subtitle">本卷章节</ThemedText>
                <ThemedText type="small" themeColor="textMuted">点击一章展开独立工作台；手动修改和 AI 修改都只作用于当前章。</ThemedText>
              </View>
              <View style={styles.chapterHeaderActions}>
                {chapterEditMode === 'reorder' ? <><Pressable onPress={cancelChapterEditing} style={styles.quietAction}><ThemedText type="small" themeColor="textMuted">取消排序</ThemedText></Pressable><Pressable onPress={saveChapterEditing} style={[styles.secondaryButton, { borderColor: theme.accent }]}><ThemedText type="smallBold" themeColor="accent">保存顺序</ThemedText></Pressable></> : <Pressable disabled={displayedVolume.chapters.length === 0} onPress={() => selectOutlineOperation('reorder')} style={[styles.secondaryButton, { borderColor: theme.border }]}><ThemedText type="smallBold" themeColor="accent">调整顺序</ThemedText></Pressable>}
              </View>
            </View>

            {displayedVolume.chapters.length === 0 ? <View style={[styles.chapterEmpty, { borderColor: theme.border, backgroundColor: theme.background }]}><ThemedText type="subtitle">章节轨道尚未建立</ThemedText><ThemedText type="small" themeColor="textMuted">打开“卷级 AI”生成本卷提案，或者先在卷设置中调整章节规模。</ThemedText><Pressable onPress={() => setShowVolumeAi(true)} style={[styles.primaryButton, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>打开卷级 AI</ThemedText></Pressable></View> : displayedVolume.chapters.map((chapter, chapterIndex) => {
              const chapterSelected = chapter.index === selectedChapterIndex;
              return (
                <View key={`${activeVolume.id}-${chapter.index}`} style={[styles.chapterNode, { borderColor: chapterSelected ? theme.accent : theme.border, backgroundColor: chapterSelected ? theme.accentMuted : theme.background }]}>
                  <Pressable disabled={chapterEditMode === 'reorder'} onPress={() => selectChapter(chapter.index)} style={styles.chapterNodeSummary}>
                    <View style={[styles.chapterIndex, { borderColor: chapterSelected ? theme.accent : theme.border }]}><ThemedText type="code" themeColor={chapterSelected ? 'accent' : 'textMuted'}>{String(chapter.index).padStart(2, '0')}</ThemedText></View>
                    <View style={styles.chapterCopy}><ThemedText type="smallBold" numberOfLines={1}>{chapter.title || '未命名章节'}</ThemedText><ThemedText type="small" themeColor="textMuted" numberOfLines={chapterSelected ? undefined : 2}>{chapter.goal || '尚未填写章节目标'}</ThemedText></View>
                    <View style={styles.chapterNodeMeta}>{chapter.sceneEnd ? <ThemedText type="code" themeColor="accent">SCENE END</ThemedText> : null}<ThemedText type="code" themeColor="textMuted">{chapterSelected ? 'CLOSE ×' : 'OPEN ↘'}</ThemedText></View>
                  </Pressable>
                  {chapterEditMode === 'reorder' ? <View style={styles.reorderDock}><Pressable onPress={() => moveDraftChapter(chapterIndex, -1)} disabled={chapterIndex === 0} style={[styles.reorderButton, { borderColor: theme.border }]}><ThemedText type="small" themeColor={chapterIndex === 0 ? 'textMuted' : 'accent'}>↑ 前移</ThemedText></Pressable><Pressable onPress={() => moveDraftChapter(chapterIndex, 1)} disabled={chapterIndex === displayedVolume.chapters.length - 1} style={[styles.reorderButton, { borderColor: theme.border }]}><ThemedText type="small" themeColor={chapterIndex === displayedVolume.chapters.length - 1 ? 'textMuted' : 'accent'}>↓ 后移</ThemedText></Pressable></View> : null}
                  {chapterSelected && selectedChapter && chapterEditMode !== 'reorder' ? <View style={[styles.chapterInspector, { borderTopColor: theme.border }]}>
                    {chapterEditMode === 'content' ? <>
                      <View style={styles.panelLabelRow}><ThemedText type="code" themeColor="accent">MANUAL OVERRIDE</ThemedText><ThemedText type="small" themeColor="textMuted">只保存第 {chapter.index} 章</ThemedText></View>
                      <TextInput value={selectedChapter.title} onChangeText={(value) => updateChapter(chapterIndex, 'title', value)} placeholder="章节标题" placeholderTextColor={theme.textMuted} style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} />
                      <TextInput value={selectedChapter.goal} onChangeText={(value) => updateChapter(chapterIndex, 'goal', value)} multiline placeholder="本章要推进什么、制造什么变化、留下什么钩子" placeholderTextColor={theme.textMuted} style={[styles.input, styles.goalInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]} />
                      <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}><Pressable onPress={cancelChapterEditing} style={styles.quietAction}><ThemedText type="small" themeColor="textMuted">取消</ThemedText></Pressable><Pressable onPress={saveChapterEditing} style={[styles.primaryButton, { backgroundColor: theme.accent }, isCompact && styles.buttonCompact]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>保存这一章</ThemedText></Pressable></View>
                    </> : <>
                      <View style={[styles.actionRow, styles.chapterQuickActions, isCompact && styles.actionRowCompact]}><Pressable onPress={() => startChapterEditing(chapter.index)} style={[styles.secondaryButton, { borderColor: theme.border }, isCompact && styles.buttonCompact]}><ThemedText type="smallBold" themeColor="accent">手动修改本章</ThemedText></Pressable><Pressable onPress={() => void removeChapter(chapter.index)} style={styles.quietAction}><ThemedText type="small" themeColor="textMuted">删除本章</ThemedText></Pressable></View>
                      <View style={[styles.chapterAiConsole, { borderColor: theme.accent, backgroundColor: theme.surface }]}>
                        <View style={styles.panelLabelRow}><ThemedText type="code" themeColor="accent">AI CHAPTER SURGERY</ThemedText><ThemedText type="small" themeColor="textMuted">锁定第 {chapter.index} 章</ThemedText></View>
                        <TextInput value={chapterAiPrompt} onChangeText={setChapterAiPrompt} multiline placeholder="例如：保留人物动机，把冲突改成雨夜追逐，并让结尾钩子自然衔接下一章" placeholderTextColor={theme.textMuted} style={[styles.input, styles.chapterAiInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} />
                        <ThemedText type="small" themeColor="textMuted">模型会读取卷目标和相邻章节，但提案只允许替换这一章；其他章节不会进入写入范围。</ThemedText>
                        <Pressable disabled={generatingChapterIndex !== null} onPress={() => void generateChapterRevision(chapter.index)} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: generatingChapterIndex !== null ? 0.55 : 1 }, isCompact && styles.fullWidthButton]}>{generatingChapterIndex === chapter.index ? <ActivityIndicator color={theme.onPrimary} /> : null}<ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{generatingChapterIndex === chapter.index ? '正在重绘本章…' : '生成单章修改提案'}</ThemedText></Pressable>
                      </View>
                    </>}
                  </View> : null}
                </View>
              );
            })}
          </View>
        ) : null}

        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  contentCompact: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  pageStage: { width: '100%', maxWidth: 1240, alignSelf: 'center', gap: Spacing.three },
  invalidState: { flex: 1, padding: Spacing.four, gap: Spacing.two, justifyContent: 'center' },
  heroShell: { position: 'relative', overflow: 'hidden', borderWidth: 1, borderRadius: 6, padding: Spacing.four, paddingBottom: Spacing.five, gap: Spacing.three },
  heroArc: { position: 'absolute', width: 260, height: 260, borderRadius: 130, borderWidth: 1, opacity: 0.18, right: -82, top: -126 },
  heroTelemetry: { minWidth: 156, alignItems: 'flex-end', gap: 4 },
  heroTelemetryCompact: { alignItems: 'flex-start' },
  signalLine: { position: 'absolute', left: Spacing.four, right: Spacing.four, bottom: Spacing.three, height: 2, opacity: 0.72, transformOrigin: 'left center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  titleRowCompact: { flexDirection: 'column', gap: Spacing.two },
  titleCopy: { flex: 1, gap: Spacing.one },
  titleCopyCompact: { width: '100%' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  cardHeaderCompact: { flexDirection: 'column', gap: Spacing.one },
  bookCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  bookActionCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  generationCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  proposalCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  conflictCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  proposalPreview: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  diffToggle: { alignSelf: 'flex-start', paddingVertical: Spacing.one },
  diffPanel: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  diffRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.one, gap: Spacing.one },
  historyCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  historyRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  emptyCard: { borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  volumeNavigator: { borderWidth: 1, borderRadius: 6, padding: Spacing.four, gap: Spacing.three },
  navigatorActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  quietAction: { minHeight: 38, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  volumeEditor: { borderWidth: 1, borderRadius: 6, padding: Spacing.four, gap: Spacing.four, overflow: 'hidden' },
  volumeCommand: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three, paddingBottom: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  volumeCommandCompact: { flexDirection: 'column' },
  volumeIdentity: { flex: 1, maxWidth: 720, gap: Spacing.one },
  commandActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexWrap: 'wrap', justifyContent: 'flex-end' },
  commandActionsCompact: { width: '100%', justifyContent: 'flex-start' },
  commandButton: { minHeight: 40, borderWidth: 1, borderRadius: 4, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  metricStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  metricCell: { minWidth: 132, flexGrow: 1, borderLeftWidth: 2, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, gap: 2 },
  foldoutPanel: { borderWidth: 1, borderRadius: 4, padding: Spacing.four, gap: Spacing.three },
  panelLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, flexWrap: 'wrap' },
  primarySmallButton: { minHeight: 40, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  fullWidthButton: { width: '100%' },
  primaryButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.one },
  secondaryButton: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  buttonCompact: { width: '100%' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, textAlignVertical: 'top' },
  summaryInput: { minHeight: 90 },
  brief: { minHeight: 110 },
  volumeSummaryInput: { minHeight: 80 },
  handoffInput: { minHeight: 82 },
  derivedInput: { justifyContent: 'center' },
  modeRow: { flexDirection: 'row', gap: Spacing.two },
  mode: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  operationPanel: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  operationSelect: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  operationMenu: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  operationOption: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.two, gap: Spacing.one },
  appendCountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  appendCountInput: { minWidth: 64, minHeight: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.two },
  sectionHeaderCompact: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.one },
  stepRail: { gap: Spacing.two, paddingVertical: Spacing.one },
  stepRailCompact: { gap: Spacing.one, paddingRight: Spacing.three },
  stepTab: { minWidth: 164, borderWidth: 1, borderRadius: 4, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.one },
  stepTabCompact: { width: 158, minWidth: 158 },
  volumeRail: { gap: Spacing.two, paddingVertical: Spacing.one },
  volumeTab: { position: 'relative', minWidth: 230, borderWidth: 1, borderRadius: 4, padding: Spacing.three, gap: Spacing.one, overflow: 'hidden' },
  volumeTabTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  activeRouteMark: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  fieldGroup: { flex: 1, gap: Spacing.one },
  fieldGroupCompact: { flexBasis: 'auto', width: '100%' },
  numberRow: { flexDirection: 'row', gap: Spacing.two },
  numberRowCompact: { flexDirection: 'column', gap: Spacing.two },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two, flexWrap: 'wrap' },
  actionRowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.two },
  handoffCard: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  chapterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  chapterHeaderCompact: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.two },
  chapterHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', justifyContent: 'flex-end' },
  chapterEmpty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 4, padding: Spacing.four, gap: Spacing.two, alignItems: 'flex-start' },
  chapterNode: { borderWidth: 1, borderRadius: 4, overflow: 'hidden' },
  chapterNodeSummary: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  chapterIndex: { width: 48, height: 48, borderWidth: 1, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  chapterCopy: { flex: 1, gap: 4 },
  chapterNodeMeta: { alignItems: 'flex-end', gap: 6 },
  chapterInspector: { borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.three },
  chapterQuickActions: { justifyContent: 'flex-start' },
  chapterAiConsole: { borderWidth: 1, borderRadius: 4, padding: Spacing.three, gap: Spacing.two },
  chapterAiInput: { minHeight: 96 },
  reorderDock: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  reorderButton: { minHeight: 38, flex: 1, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  chapterRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.one },
  chapterRowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, justifyContent: 'space-between' },
  chapterRowActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  selectionButton: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  reorderActions: { flexDirection: 'row', gap: Spacing.two },
  inlineInput: { minHeight: 38, paddingVertical: Spacing.one, borderBottomWidth: StyleSheet.hairlineWidth },
  goalInput: { minHeight: 64, textAlignVertical: 'top' },
  historyRowCompact: { flexDirection: 'column', alignItems: 'stretch' },
});
