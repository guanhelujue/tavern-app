import { router, useNavigation } from 'expo-router';
import { usePreventRemove, type NavigationProp } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { NovelChapterEditorModal } from '@/components/novel-continue/NovelChapterEditorModal';
import { NovelTextImportModal } from '@/components/novel-continue/NovelTextImportModal';
import { NovelMobileChapterHome } from '@/components/novel-continue/NovelMobileChapterHome';
import { ChapterBookSlips } from '@/components/desktop/ChapterBookSlips';
import { ThemedText } from '@/components/themed-text';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { getActiveNovelRequestId, isNovelMutationActive } from '@/services/novel-request-lifecycle';
import type { NovelChapter } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { exportChatSessionBundle } from '@/utils/chat-session-io';
import { generateId } from '@/utils/helpers';
import { buildLegacyNovelChapters } from '@/utils/novel-legacy-chapters';
import { CHAPTER_PLANNING_FIELDS, hasChapterPlanning, normalizeChapterPlanning } from '@/utils/novel-chapter-planning';
import { isChapterContinuationIntent } from '@/features/scene-inspiration/generator';
import { checkChapterLength, countChapterWords, resolveChapterTargetWords } from '@/utils/novel-chapter-length';

const EMPTY_MESSAGES: never[] = [];
type Draft = Pick<NovelChapter, 'title' | 'goal' | 'content' | 'summary' | 'planning' | 'targetWords'>;

function Action({ children, onPress, primary = false, disabled = false }: {
  children: ReactNode; onPress: () => void; primary?: boolean; disabled?: boolean;
}) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: primary ? theme.primary : theme.surface, borderColor: primary ? theme.primary : theme.outlineVariant }, (pressed || disabled) && styles.disabled]}>
    <ThemedText type="smallBold" style={{ color: primary ? theme.onPrimary : theme.text }}>{children}</ThemedText>
  </Pressable>;
}

export function DesktopChapterWorkspace({ novelId, inspirationId, chapterId, outlineIndex }: { novelId: string; inspirationId?: string; chapterId?: string; outlineIndex?: number }) {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const navigation = useNavigation<NavigationProp<{ chapters: { chapterId?: string; inspirationId?: string } }>>();
  const mounted = useRef(true);
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const messages = useTavernStore((state) => state.novelConversations[novelId] ?? EMPTY_MESSAGES);
  const inspiration = useTavernStore((state) => state.novelInspirationChats[novelId]?.find((item) => item.id === inspirationId));
  const hydrateChapter = useTavernStore((state) => state.hydrateNovelChapterContent);
  const chapters = useMemo(() => [...(novel?.chapters ?? [])].sort((a, b) => a.index - b.index), [novel?.chapters]);
  const [selectedId, setSelectedId] = useState<string | null>(chapterId && chapterId !== 'new' ? chapterId : novel?.chapters?.find((item) => item.index === outlineIndex)?.id ?? null);
  const editorOpen = Boolean(chapterId || inspirationId);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState(false);
  const [stream, setStream] = useState('');
  const [advancedId, setAdvancedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const selected = chapters.find((chapter) => chapter.id === selectedId);
  const continuationIntent = Boolean(inspiration && isChapterContinuationIntent(inspiration.content));
  const legacy = useMemo(() => buildLegacyNovelChapters(novelId, messages, chapters), [novelId, messages, chapters]);
  const finalChapters = chapters.filter((chapter) => chapter.status === 'final');
  const nextIndex = (finalChapters.at(-1)?.index ?? 0) + 1;
  const requestedPlan = novel?.outline?.volumes.flatMap((volume) => volume.chapters).find((item) => item.index === outlineIndex);
  const manualIndex = requestedPlan?.index ?? (chapters.at(-1)?.index ?? 0) + 1;
  const outlineChapters = novel?.outline?.volumes.flatMap((volume) => volume.chapters) ?? [];
  const plannedCount = Math.max(novel?.projectBrief?.plannedChapters ?? 0, ...outlineChapters.map((chapter) => chapter.index), 0);
  const nextOutline = outlineChapters.find((chapter) => chapter.index === manualIndex);
  const activeJob = novel?.novelGenerationJobs?.find((job) => job.kind === 'write' && job.status === 'running');
  const pausedJob = novel?.novelGenerationJobs?.find((job) => job.kind === 'write' && (job.status === 'paused' || job.status === 'failed'));
  const busy = operation || Boolean(activeJob);
  const locked = busy || Boolean(pausedJob);
  const unloaded = Boolean(selected && selected.contentStatus && selected.contentStatus !== 'loaded');

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (selectedId) void hydrateChapter(selectedId).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '正文加载失败。'));
  }, [selectedId, hydrateChapter]);

  usePreventRemove(dirty || isSaving, ({ data }) => {
    if (savingRef.current) return;
    void confirmAppAction('离开章节', '当前章节有未保存的修改，确定放弃修改并离开？').then((confirmed) => {
      if (confirmed) navigation.dispatch(data.action);
    });
  });
  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && !isSaving)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, isSaving]);

  function openChapter(id: string) {
    router.push(`/novel/chapters/${novelId}?chapterId=${encodeURIComponent(id)}`);
  }

  function showSavedChapter(id: string) {
    if (!mounted.current) return;
    setDirty(false); setSelectedId(id); setStream('');
    navigation.setParams({ chapterId: id, inspirationId: undefined });
  }

  async function save(draft: Draft) {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setOperation(true);
    const state = useTavernStore.getState();
    const now = new Date().toISOString();
    const chapter = selected
      ? { ...selected, ...draft, title: draft.title.trim() || `第${selected.index}章` }
      : { ...draft, id: generateId('chapter'), index: manualIndex, title: draft.title.trim() || `第${manualIndex}章`, status: 'draft' as const, contentStatus: 'loaded' as const, aiGenerated: false, createdAt: now, updatedAt: now };
    try {
      await state.saveNovelChapter(novelId, chapter);
      if (!mounted.current) return;
      showSavedChapter(chapter.id);
      setDirty(false); setError('');
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '章节保存失败，请重试。');
    } finally {
      savingRef.current = false;
      if (mounted.current) { setOperation(false); setIsSaving(false); }
    }
  }

  async function generate(draft: Draft) {
    if (locked) return;
    if (requestedPlan && requestedPlan.index !== nextIndex) {
      setError(`当前选择第 ${requestedPlan.index} 章。AI 连续写作需要先完成第 ${nextIndex} 章；本章可以先手写并保存草稿。`);
      return;
    }
    // The pipeline replaces drafts at the next canonical index. Never silently discard one.
    if (chapters.some((chapter) => chapter.status === 'draft' && chapter.index === nextIndex)) {
      setError(`第 ${nextIndex} 章已有草稿，请先打开该章，在「审查与定稿」中确认后再生成下一章。`);
      return;
    }
    if (draft.content.trim()) {
      setError('当前已有手写正文，请先保存草稿；生成正文需要一个空白的新章节。');
      return;
    }
    const previousJobs = new Set(novel?.novelGenerationJobs?.map((job) => job.jobId));
    setOperation(true); setStream(''); setError('');
    try {
      const state = useTavernStore.getState();
      const id = await state.rewriteNovelNextChapter(novelId, {
        planId: novel?.novelContinuationPlans?.find((plan) => plan.status === 'active')?.planId,
        userInstruction: draft.goal.trim() || undefined,
        planning: draft.planning,
        targetWords: draft.targetWords,
        onDelta: (delta) => { if (mounted.current) setStream((current) => current + delta); },
      });
      if (id) {
        if (draft.title.trim() || draft.summary.trim()) {
          const generated = useTavernStore.getState().novels.find((item) => item.id === novelId)?.chapters?.find((item) => item.id === id);
          if (generated) await state.saveNovelChapter(novelId, {
            ...generated,
            ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
            summary: draft.summary,
          });
        }
        showSavedChapter(id);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '章节生成失败，请检查模型设置后重试。'); }
    finally {
      // A failed request still checkpoints a real chapter. Display that saved draft.
      const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
      const job = latest?.novelGenerationJobs?.find((item) => item.kind === 'write' && !previousJobs.has(item.jobId));
      if (mounted.current) {
        if (job?.chapterId && latest?.chapters?.some((chapter) => chapter.id === job.chapterId)) showSavedChapter(job.chapterId);
        setStream(''); setOperation(false);
      }
    }
  }

  async function importLegacy() {
    if (busy || savingRef.current || !legacy.length) return;
    if (dirty && !await confirmAppAction('整理旧正文', '当前章节有未保存的修改，继续将放弃这些修改。')) return;
    if (!await confirmAppAction('将旧正文整理为章节', `将 ${legacy.length} 条完整的正文回复各整理为一章，上一条输入作为本章提示词。章节先保存为草稿；原对话记录保留。可在整理后调整标题与分章。`)) return;
    const state = useTavernStore.getState();
    const current = state.novels.find((item) => item.id === novelId);
    const pending = buildLegacyNovelChapters(novelId, state.novelConversations[novelId] ?? [], current?.chapters ?? []);
    savingRef.current = true;
    setIsSaving(true);
    setOperation(true);
    try {
      await state.appendNovelChapters(novelId, pending);
      if (mounted.current) { setDirty(false); setError(''); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '整理旧正文失败，请重试。');
    } finally {
      savingRef.current = false;
      if (mounted.current) { setOperation(false); setIsSaving(false); }
    }
  }

  async function exportBackup() {
    try {
      const state = useTavernStore.getState();
      const bundle = await state.buildNovelBackup(novelId);
      const result = await exportChatSessionBundle(bundle, state.exportSettings.directoryUri);
      showAppAlert('备份已导出', `已保存 ${result.fileName}，可在另一浏览器的作品库导入。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '备份导出失败。'); }
  }

  async function deleteChapter() {
    if (!selected || locked) return;
    if (!await confirmAppAction('删除章节', `确定删除第 ${selected.index} 章「${selected.title}」吗？${dirty ? '未保存的修改也会丢失。' : ''}大纲会保留，相关摘要与审查需要重新生成。`, { confirmLabel: '删除章节' })) return;
    try {
      const state = useTavernStore.getState();
      const latest = state.novels.find((item) => item.id === novelId);
      if (isNovelMutationActive(novelId) || getActiveNovelRequestId(novelId) || latest?.novelGenerationJobs?.some((job) => job.status === 'running')) throw new Error('正在生成或保存，请完成后再删除章节。');
      state.deleteNovelChapter(novelId, selected.id);
      setDirty(false); setSelectedId(null); setAdvancedId(null); setError('');
      navigation.setParams({ chapterId: undefined, inspirationId: undefined });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除章节失败。'); }
  }

  async function recover(retry: boolean) {
    if (!pausedJob || busy) return;
    if (dirty && !await confirmAppAction('恢复生成', '当前编辑尚未保存，继续将放弃这些修改。')) return;
    if (retry && !await confirmAppAction('重新生成', '重新尝试生成空白章节；已有正文会保留，需要先处理草稿。')) return;
    setOperation(true); setError(''); setStream('');
    try {
      const state = useTavernStore.getState();
      const id = await (retry ? state.retryNovelGenerationJob : state.resumeNovelGenerationJob)(novelId, pausedJob.jobId);
      if (id) showSavedChapter(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败。'); }
    finally { if (mounted.current) { setOperation(false); setStream(''); } }
  }

  if (!novel) return <View style={styles.empty}><ThemedText>小说不存在。</ThemedText></View>;
  const notices = <>
        {!editorOpen && legacy.length > 0 && <View style={[styles.notice, { backgroundColor: theme.primaryContainer }]}><View style={styles.noticeText}><ThemedText type="smallBold">有 {legacy.length} 段旧正文可以整理</ThemedText><ThemedText type="small" themeColor="textSecondary">按完整回复分章，并保留原记录。</ThemedText></View><Action disabled={busy} onPress={() => void importLegacy()}>整理为章节</Action></View>}
        {activeJob && <View style={[styles.notice, { backgroundColor: theme.surface }]}><ThemedText type="small">{activeJob.currentStep || '正在生成章节'} · {Math.round(activeJob.progress * 100)}%</ThemedText></View>}
        {pausedJob && !busy && <View style={[styles.notice, { backgroundColor: theme.surface }]}><View style={styles.noticeText}><ThemedText type="smallBold">第 {pausedJob.chapterIndex ?? '?'} 章生成待恢复</ThemedText><ThemedText type="small" themeColor="textSecondary">{pausedJob.lastError || '已有内容已保存在草稿中。'} 继续任务或放弃任务后可编辑。</ThemedText></View><Action onPress={() => void recover(false)}>继续生成</Action><Action onPress={() => void recover(true)}>重新生成</Action><Action onPress={() => { void confirmAppAction('放弃生成任务', '停止恢复该任务，已生成的草稿会保留。').then((confirmed) => { if (confirmed) useTavernStore.getState().abandonNovelGenerationJob(novelId, pausedJob.jobId); }); }}>放弃任务</Action></View>}
        {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText> : null}
  </>;
  return <View style={[styles.root, { backgroundColor: theme.background }]}>
    {(desktop || editorOpen) && <View style={[styles.header, { borderBottomColor: theme.outlineVariant }, !desktop && styles.compactHeader]}>
      {editorOpen && <Action onPress={() => router.replace(`/novel/chapters/${novelId}`)}>{desktop ? '← 返回书简' : '返回目录'}</Action>}
      <View style={styles.heading}><ThemedText type="subtitle">{editorOpen ? '章节写作' : '章节创作'}</ThemedText><ThemedText type="small" themeColor="textSecondary">{novel.name} · 共 {chapters.length} 章</ThemedText></View>
      {desktop && editorOpen && selected && <Action disabled={locked} onPress={() => void deleteChapter()}>删除章节</Action>}
      {!editorOpen && <View style={styles.actions}><Action disabled={locked} onPress={() => setImportOpen(true)}>导入正文</Action><Action onPress={() => router.push(`/novel/workbench/${novelId}?focus=tools`)}>任务与导出</Action></View>}
    </View>}
    {editorOpen ? <ScrollView style={styles.editorScroll} contentContainerStyle={[styles.editorContent, !desktop && styles.compactEditorContent]} keyboardShouldPersistTaps="handled">
      {notices}
      {continuationIntent && selected && <ThemedText type="small" themeColor="textSecondary">第 {selected.index} 章已有草稿，已为你打开；先定稿，再继续下一章。</ThemedText>}
      {selectedId && !selected ? <View style={styles.empty}><ThemedText>该章节已不存在，请返回目录选择其他章节。</ThemedText></View> : unloaded ? <View style={styles.empty}><ThemedText>{selected?.contentStatus === 'error' ? '正文加载失败' : '正在加载正文…'}</ThemedText><Action onPress={() => { if (selectedId) void hydrateChapter(selectedId).catch(() => setError('正文加载失败，请重试。')); }}>重新加载</Action></View> : <ChapterForm
        key={selected ? `${selected.id}:${selected.updatedAt}` : `new:${inspirationId ?? ''}`}
        chapter={selected} nextIndex={manualIndex} initialPrompt={!continuationIntent && inspiration ? inspiration.content : !selected ? [nextOutline?.goal, nextOutline?.characterChange && `人物变化：${nextOutline.characterChange}`, nextOutline?.foreshadowing && `伏笔与线索：${nextOutline.foreshadowing}`, nextOutline?.endingHook && `章末衔接：${nextOutline.endingHook}`].filter(Boolean).join('\n\n') : ''}
        initialTitle={nextOutline?.title ?? ''}
        defaultTargetWords={novel.continuationSettings?.targetWords ?? 1800}
        busy={locked} generating={busy} stream={stream} onDirty={setDirty} onSave={save} onGenerate={(draft) => void generate(draft)}
        onAdvanced={() => setAdvancedId(selected?.id ?? null)} />}
    </ScrollView> : desktop ? <ScrollView style={styles.overview} contentContainerStyle={styles.overviewContent} keyboardShouldPersistTaps="handled">
      {Boolean(legacy.length > 0 || activeJob || pausedJob || error) && <View style={styles.overviewNotices}>{notices}</View>}
      <ChapterBookSlips chapters={chapters} locked={busy} onCreate={() => openChapter('new')} onOpen={openChapter} />
    </ScrollView> : <NovelMobileChapterHome name={novel.name} worldName={novel.worldName} coverUri={novel.coverImageUri} chapters={chapters} plannedCount={plannedCount}
      nextIndex={manualIndex} nextTitle={nextOutline?.title} busy={busy} locked={locked}
      notices={legacy.length > 0 || activeJob || pausedJob || error ? notices : undefined}
      onOpen={openChapter} onCreate={() => openChapter('new')} onImport={() => setImportOpen(true)}
      onTools={() => router.push(`/novel/workbench/${novelId}?focus=tools`)} onExport={() => void exportBackup()} />}
    <NovelChapterEditorModal visible={Boolean(advancedId)} novelId={novelId} chapter={chapters.find((chapter) => chapter.id === advancedId) ?? null} onClose={() => setAdvancedId(null)} />
    {importOpen && <NovelTextImportModal novelId={novelId} visible onClose={() => setImportOpen(false)} />}
  </View>;
}

function ChapterForm({ chapter, nextIndex, initialPrompt, initialTitle, defaultTargetWords, busy, generating, stream, onDirty, onSave, onGenerate, onAdvanced }: {
  chapter?: NovelChapter; nextIndex: number; initialPrompt: string; initialTitle: string; busy: boolean; generating: boolean; stream: string;
  defaultTargetWords: number;
  onDirty: (dirty: boolean) => void; onSave: (draft: Draft) => void; onGenerate: (draft: Draft) => void; onAdvanced: () => void;
}) {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const [draft, setDraft] = useState<Draft>(() => ({ title: chapter?.title ?? initialTitle, goal: chapter?.goal ?? initialPrompt, summary: chapter?.summary ?? '', content: chapter?.content ?? '', planning: normalizeChapterPlanning(chapter?.planning), targetWords: chapter?.targetWords }));
  const [planningOpen, setPlanningOpen] = useState(hasChapterPlanning(chapter?.planning));
  const [promptOpen, setPromptOpen] = useState(!chapter);
  const isDirty = (value: Draft) => value.title !== (chapter?.title ?? initialTitle) || value.goal !== (chapter?.goal ?? initialPrompt) || value.summary !== (chapter?.summary ?? '') || value.content !== (chapter?.content ?? '') || value.targetWords !== chapter?.targetWords || JSON.stringify(normalizeChapterPlanning(value.planning)) !== JSON.stringify(normalizeChapterPlanning(chapter?.planning));
  const dirty = isDirty(draft);
  const updateDraft = (next: Draft) => {
    setDraft(next);
    onDirty(isDirty(next));
  };
  const update = (field: Exclude<keyof Draft, 'planning' | 'targetWords'>, value: string) => updateDraft({ ...draft, [field]: value });
  const targetWords = resolveChapterTargetWords(draft.targetWords, draft.goal, defaultTargetWords);
  const length = checkChapterLength(stream || draft.content, targetWords);
  const inputTheme = { color: theme.text, borderColor: theme.outlineVariant, backgroundColor: theme.background };
  return <View style={[styles.paper, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }, !desktop && { paddingHorizontal: 0, paddingTop: 0, borderWidth: 0, borderRadius: 0, backgroundColor: 'transparent', shadowOpacity: 0, elevation: 0 }]}>
    <View style={styles.paperHeader}><ThemedText type="code" themeColor="primary">{chapter ? `第 ${chapter.index} 章 · ${chapter.status === 'final' ? '已定稿' : '草稿'}` : `新章节 · 第 ${nextIndex} 章`}</ThemedText><ThemedText type="small" themeColor="textMuted">{dirty ? '尚未保存' : chapter ? '已保存' : '开始写作'}</ThemedText></View>
    {Boolean(chapter && initialPrompt && initialPrompt !== chapter.goal) && <View style={[styles.notice, { backgroundColor: theme.primaryContainer }]}><ThemedText type="small" style={styles.noticeText}>带入的写作要求：{initialPrompt}</ThemedText><Action disabled={busy} onPress={() => update('goal', [draft.goal, initialPrompt].filter(Boolean).join('\n\n'))}>加入本章提示词</Action></View>}
    <TextInput accessibilityLabel="章节标题" value={draft.title} onChangeText={(value) => update('title', value)} editable={!busy} placeholder={`第${chapter?.index ?? nextIndex}章 · 输入章节标题`} placeholderTextColor={theme.textMuted} style={[styles.titleInput, { color: theme.text }]} />
    {!desktop ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: promptOpen }} onPress={() => setPromptOpen(!promptOpen)} style={[styles.planningToggle, { minHeight: 48, marginBottom: 12 }]}><ThemedText type="smallBold" themeColor="primary">本章提示词与规划</ThemedText><ThemedText themeColor="primary">{promptOpen ? '收起 −' : '展开 ＋'}</ThemedText></Pressable> : null}
    {desktop || promptOpen ? <View style={[styles.promptSection, { borderColor: theme.outlineVariant }]}>
      <View style={styles.promptToolbar}>
        <View style={styles.promptToolbarCopy}>
          <ThemedText type="smallBold">本章提示词</ThemedText>
          <ThemedText type="small" themeColor="textMuted">先定方向，再开始写正文</ThemedText>
        </View>
        <TaskModelSelector task="writing" disabled={busy} />
      </View>
      <TextInput accessibilityLabel="本章提示词" value={draft.goal} onChangeText={(value) => update('goal', value)} editable={!busy} multiline textAlignVertical="top" placeholder="这一章发生什么？写清场景、冲突、人物动机，以及希望保留或避免的内容。" placeholderTextColor={theme.textMuted} style={[styles.promptInput, inputTheme]} />
      <View style={styles.targetRow}>
        <View style={styles.targetCopy}>
          <ThemedText type="smallBold">本章目标字数</ThemedText>
          <ThemedText type="small" themeColor="textMuted">用于生成与定稿检查</ThemedText>
        </View>
        <TextInput accessibilityLabel="本章目标字数" value={draft.targetWords?.toString() ?? ''} keyboardType="number-pad" editable={!busy}
          onChangeText={(value) => { const digits = value.replace(/\D/g, ''); updateDraft({ ...draft, targetWords: digits ? Number(digits) : undefined }); }}
          onBlur={() => { if (draft.targetWords !== undefined) updateDraft({ ...draft, targetWords }); }}
          placeholder={String(targetWords)} placeholderTextColor={theme.textMuted} style={[styles.summaryInput, inputTheme, { minHeight: 44, width: 120 }]} />
        <ThemedText type="small" themeColor="textSecondary">至少 {length.minimumWords} 字</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: planningOpen }} onPress={() => setPlanningOpen(!planningOpen)} style={styles.planningToggle}>
        <ThemedText type="smallBold">{planningOpen ? '−' : '+'} 本章规划</ThemedText><ThemedText type="small" themeColor="textSecondary">选填 · 冲突、事件、人物与场景</ThemedText>
      </Pressable>
      {planningOpen && <View style={styles.planningGrid}>{CHAPTER_PLANNING_FIELDS.map(({ key, label, placeholder }) => <View key={key} style={styles.planningField}>
        <ThemedText type="smallBold">{label}</ThemedText><TextInput accessibilityLabel={label} value={draft.planning?.[key] ?? ''} onChangeText={(value) => updateDraft({ ...draft, planning: { ...normalizeChapterPlanning(draft.planning), [key]: value } })} editable={!busy} multiline textAlignVertical="top" placeholder={placeholder} placeholderTextColor={theme.textMuted} style={[styles.summaryInput, inputTheme]} />
      </View>)}</View>}
      <View style={styles.promptActions}><ThemedText type="small" themeColor="textSecondary">{chapter ? '提示词与正文按章节一同保存。' : '生成时会结合已定稿章节、人物和大纲。'}</ThemedText>{!chapter && <Action primary disabled={busy} onPress={() => onGenerate(draft)}>{generating ? '正在生成…' : '生成本章正文'}</Action>}</View>
    </View> : null}
    <View style={styles.sectionHeading}><ThemedText type="smallBold">章节正文</ThemedText><ThemedText type="code" themeColor="textMuted">{countChapterWords(stream || draft.content).toLocaleString()} / {targetWords} 字</ThemedText></View>
    {chapter?.targetWords && draft.content && !length.passed ? <ThemedText type="small" style={{ color: theme.error }}>字数不足：还需至少 {length.minimumWords - length.actualWords} 字，补足后才能定稿。</ThemedText> : null}
    <TextInput accessibilityLabel="章节正文" value={stream || draft.content} onChangeText={(value) => update('content', value)} editable={!busy} multiline textAlignVertical="top" placeholder="正文从这里开始。你可以直接写作，也可以先填写上方提示词，再生成本章内容。" placeholderTextColor={theme.textMuted} style={[styles.proseInput, { color: theme.text }]} />
    <View style={[styles.summarySection, { borderTopColor: theme.outlineVariant }]}><ThemedText type="smallBold">章节摘要</ThemedText><TextInput accessibilityLabel="章节摘要" value={draft.summary} onChangeText={(value) => update('summary', value)} editable={!busy} multiline placeholder="简要记录本章的情节与变化（选填）" placeholderTextColor={theme.textMuted} style={[styles.summaryInput, inputTheme]} /></View>
    <View style={[styles.footer, { borderTopColor: theme.outlineVariant }]}><ThemedText type="small" themeColor="textSecondary" style={styles.noticeText}>{chapter?.status === 'final' ? '修改后保存将回到草稿，需重新审查定稿。' : '保存后可审查、修订、管理版本并定稿。'}</ThemedText><View style={styles.actions}>{chapter && <Action disabled={busy || dirty} onPress={onAdvanced}>{desktop ? '一致性检查 / 定稿' : '审查与定稿'}</Action>}<Action primary disabled={busy || (!dirty && Boolean(chapter)) || (!chapter && !draft.content.trim() && !draft.goal.trim() && !draft.title.trim() && !hasChapterPlanning(draft.planning))} onPress={() => onSave(draft)}>保存草稿</Action></View></View>
  </View>;
}

const styles = StyleSheet.create({
  planningToggle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, minHeight: 44 }, planningGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, planningField: { flexGrow: 1, flexBasis: 280, minWidth: 0, gap: 8 },
  root: { flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }, header: { paddingHorizontal: 36, paddingVertical: 28, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, borderBottomWidth: StyleSheet.hairlineWidth }, heading: { flex: 1, minWidth: 200, gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, button: { minHeight: Platform.OS === 'web' ? 40 : 48, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, borderRadius: 7, justifyContent: 'center', alignItems: 'center' }, disabled: { opacity: 0.45 },
  compactHeader: { paddingHorizontal: 20, paddingVertical: 20 },
  overview: { flex: 1, minWidth: 0, width: '100%' }, overviewContent: { paddingBottom: 20, minWidth: 0 }, overviewNotices: { paddingHorizontal: 36, paddingBottom: 16, gap: 12 },
  editorScroll: { flex: 1, minWidth: 0, width: '100%' }, editorContent: { padding: 36, gap: 18, maxWidth: 1160, width: '100%', alignSelf: 'center', paddingBottom: 72 }, compactEditorContent: { padding: 20, paddingBottom: 40 },
  notice: { padding: 16, borderRadius: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }, noticeText: { flex: 1, minWidth: 180, gap: 5 }, empty: { flex: 1, padding: 32, alignItems: 'center', justifyContent: 'center', gap: 16 },
  paper: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, shadowColor: '#4B3323', shadowOpacity: 0.06, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 1 }, paperHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  titleInput: { minWidth: 0, width: '100%', fontSize: 26, lineHeight: 36, fontWeight: '600', paddingVertical: 20, paddingHorizontal: 0, letterSpacing: -0.3 }, promptSection: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 18, marginBottom: 24, gap: 16 }, promptToolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }, promptToolbarCopy: { flex: 1, minWidth: 180, gap: 4 },
  targetRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 }, targetCopy: { minWidth: 150, gap: 3 },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' },
  promptInput: { minWidth: 0, width: '100%', borderWidth: 1, borderRadius: 12, minHeight: 120, padding: 14, fontSize: 16, lineHeight: 26 }, promptActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' },
  proseInput: { minWidth: 0, width: '100%', minHeight: 460, fontSize: 18, lineHeight: 32, paddingVertical: 22, paddingHorizontal: 0 }, summarySection: { paddingVertical: 20, borderTopWidth: 1, gap: 10 }, summaryInput: { minWidth: 0, width: '100%', minHeight: 70, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 16, lineHeight: 24 }, footer: { paddingVertical: 20, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
});
