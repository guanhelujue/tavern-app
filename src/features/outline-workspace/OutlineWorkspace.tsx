import { router, useNavigation, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import type { NovelOutline, NovelOutlineProposal, NovelVolumeChapter, NovelVolumePlan } from '@/types/tavern';
import { confirmAppAction } from '@/utils/app-alert';
import { generateId } from '@/utils/helpers';
import { applyNovelOutlinePatch, cloneNovelOutline, hashNovelOutline } from '@/utils/novel-outline-proposals';
import { readNovelBlueprint } from '@/features/novel-creation/legacy-novel-adapter';
import { buildLegacyVolumeSeeds, mergeLegacyStoryIntoSummary } from '@/utils/novel-outline-seeds';
import { buildQuickTravelContext } from '@/utils/quick-travel';
import { generateOutlineInVolumes, generateNovelOutlineVolume, generateNovelOutlineChapterRevision } from '@/services/novel-continuation-pipeline';
import { requestOutlineTextRevision } from '@/services/novel-outline-assistant';
import { applyVolumeRouteToOutline, proposeNovelVolumeRoutes, type NovelVolumeRoute } from '@/services/novel-volume-routes';
import { StoryImportModal } from '@/features/story-import/StoryImportModal';
import { addChapterPlan, emptyOutline, outlineDifferences, positiveInteger, reorderChapterPlans, scopedOutline, updateChapterPlan, updateVolumePlan, volumeRanges } from './model';

type Selection = { kind: 'book' } | { kind: 'volume'; volumeId: string } | { kind: 'chapter'; volumeId: string; index: number };
type Edit = { base: NovelOutline; draft: NovelOutline; kind: 'book' | 'volume' | 'chapter' | 'reorder'; isNew?: boolean; parentVolumeId?: string };
type AiMode = 'text' | 'plan' | 'append';

function Action({ children, onPress, primary, disabled, label, quiet }: { children: ReactNode; onPress: () => void; primary?: boolean; disabled?: boolean; label?: string; quiet?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed, hovered }) => [styles.button, { borderColor: quiet ? 'transparent' : primary ? theme.primary : theme.outlineVariant, backgroundColor: primary ? theme.primary : hovered ? theme.surfaceVariant : 'transparent' }, (pressed || disabled) && styles.dim]}>
    <ThemedText type="smallBold" style={{ color: primary ? theme.onPrimary : theme.textSecondary }}>{children}</ThemedText>
  </Pressable>;
}

function Field({ label, value, onChange, multiline, optional, narrow, disabled, placeholder }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; optional?: boolean; narrow?: boolean; disabled?: boolean; placeholder?: string }) {
  const theme = useTheme();
  return <View style={[styles.field, narrow && styles.narrowField]}>
    <ThemedText type="smallBold">{label}{optional && <ThemedText type="small" themeColor="textMuted">（选填）</ThemedText>}</ThemedText>
    <TextInput accessibilityLabel={label} value={value} editable={!disabled} onChangeText={onChange} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} placeholder={placeholder ?? (optional ? '选填' : '')} placeholderTextColor={theme.textMuted}
      style={[styles.input, multiline && styles.textarea, { color: theme.text, borderColor: theme.outlineVariant, backgroundColor: theme.surface }]} />
  </View>;
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.section, { borderTopColor: theme.outlineVariant }]}><View style={styles.sectionHeading}><ThemedText type="subtitle" style={styles.sectionTitle}>{title}</ThemedText>{action}</View>{children}</View>;
}

export function OutlineWorkspace({ novelId, worldId }: { novelId: string; worldId?: string }) {
  const theme = useTheme();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const compact = width < 1100;
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const [selection, setSelection] = useState<Selection>({ kind: 'book' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [panel, setPanel] = useState<'content' | 'ai' | 'review' | 'history'>('content');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiMode, setAiMode] = useState<AiMode>('text');
  const [instruction, setInstruction] = useState('');
  const [chapterCount, setChapterCount] = useState('15');
  const [wordCount, setWordCount] = useState('2500');
  const [advanced, setAdvanced] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [numberDraft, setNumberDraft] = useState({ chapters: '', words: '' });
  const [volumeRoutes, setVolumeRoutes] = useState<{ volumeId: string; baseHash: string; routes: NovelVolumeRoute[]; tokens?: number; modelId: string } | null>(null);
  const [routesBusy, setRoutesBusy] = useState(false);
  const mounted = useRef(true);
  const scroll = useRef<ScrollView>(null);
  const scopeId = worldId ?? 'novel';
  const current = scopedOutline(novel, worldId) ?? emptyOutline();
  const outline = edit?.draft ?? current;
  const volumeId = selection.kind === 'book' ? undefined : selection.volumeId;
  const volume = outline.volumes.find((item) => item.id === volumeId);
  const chapter = selection.kind === 'chapter' ? volume?.chapters.find((item) => item.index === selection.index) : undefined;
  const dirty = Boolean(edit && (hashNovelOutline(edit.base) !== hashNovelOutline(edit.draft) || (edit.kind === 'volume' && volume && (numberDraft.chapters !== String(volume.plannedChapterCount ?? (volume.chapters.length || '')) || numberDraft.words !== String(volume.wordsPerChapter ?? novel?.continuationSettings?.targetWords ?? 2500)))));
  const ranges = volumeRanges(outline);
  const hasUnplannedVolumes = outline.volumes.some((item) => item.plannedChapterCount == null && !item.chapters.length);
  const hasChapterPlan = (item: NovelVolumePlan | undefined) => Boolean(item && (item.plannedChapterCount != null || item.chapters.length));
  const range = ranges.find((item) => item.id === volumeId);
  const world = novel?.quickTravel?.worlds.find((item) => item.id === worldId);
  const pending = novel?.outlineProposals?.find((item) => item.scopeId === scopeId && item.status === 'pending');
  const conflicted = novel?.outlineProposals?.find((item) => item.scopeId === scopeId && item.status === 'conflicted');
  const review = pending ?? conflicted;
  const candidate = review ? applyNovelOutlinePatch(current, review.patch) : undefined;
  const differences = candidate ? outlineDifferences(current, candidate) : [];
  const stale = Boolean(review && (review.status !== 'pending' || hashNovelOutline(current) !== review.baseHash));
  const versions = [...(novel?.outlineVersions ?? [])].filter((item) => item.scopeId === scopeId).reverse();
  const history = [...(novel?.outlineProposals ?? [])].filter((item) => item.scopeId === scopeId && item.status !== 'pending').reverse();

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  usePreventRemove(dirty || busy || routesBusy, ({ data }) => {
    void confirmAppAction('离开大纲', routesBusy ? '路线正在推演，离开后本次候选不会保留。确定离开？' : busy ? 'AI 正在生成。离开后结果将保留为提案，可稍后审阅。确定离开？' : '当前有未保存的修改，确定放弃修改并离开？').then((confirmed) => { if (confirmed) navigation.dispatch(data.action); });
  });
  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && !routesBusy)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    // Sidebar Links push a route rather than removing this screen, so guard them too.
    const followLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const href = anchor?.getAttribute('href');
      if (!href || !href.startsWith('/') || href === window.location.pathname + window.location.search) return;
      event.preventDefault(); event.stopPropagation();
      void confirmAppAction('离开大纲', routesBusy ? '路线正在推演，离开后本次候选不会保留。确定离开？' : '当前修改尚未保存。放弃修改并离开？', { confirmLabel: '放弃并离开' }).then((confirmed) => {
        if (confirmed) { setEdit(null); router.push(href as Href); }
      });
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', followLink, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', followLink, true); };
  }, [dirty, routesBusy]);

  if (!novel) return <ThemedText>正在读取作品…</ThemedText>;

  function liveOutline() { return scopedOutline(useTavernStore.getState().novels.find((item) => item.id === novelId), worldId) ?? emptyOutline(); }
  function resetScroll() { scroll.current?.scrollTo({ y: 0, animated: false }); }
  function beginEditing(kind: Edit['kind'], target = current, isNew = false) {
    if (busy || routesBusy) return;
    setVolumeRoutes(null);
    setEdit({ base: cloneNovelOutline(current), draft: cloneNovelOutline(target), kind, isNew });
    const targetVolume = target.volumes.find((item) => item.id === volumeId);
    if (targetVolume) setNumberDraft({ chapters: String(targetVolume.plannedChapterCount ?? (targetVolume.chapters.length || '')), words: String(targetVolume.wordsPerChapter ?? novel?.continuationSettings?.targetWords ?? 2500) });
    setError(''); setNotice(''); setAdvanced(false);
  }
  async function mayLeave() {
    if (busy || routesBusy) return false;
    return !dirty || await confirmAppAction('切换大纲内容', '当前修改尚未保存。放弃修改并切换？', { confirmLabel: '放弃并切换' });
  }
  async function choose(next: Selection) {
    if (!await mayLeave()) return;
    setSelection(next); setPanel('content'); setError(''); setNotice(''); setInstruction(''); setAdvanced(false); setVolumeRoutes(null);
    if (next.kind !== 'book') setExpanded((old) => new Set([...old, next.volumeId]));
    setEdit(next.kind === 'chapter' ? { base: cloneNovelOutline(liveOutline()), draft: cloneNovelOutline(liveOutline()), kind: 'chapter' } : null);
    resetScroll();
  }
  async function showPanel(next: typeof panel) {
    if (!await mayLeave()) return;
    setEdit(null); setPanel(next); setError(''); setNotice(''); resetScroll();
  }
  function persist(next: NovelOutline, base: NovelOutline, reason: string) {
    if (hashNovelOutline(liveOutline()) !== hashNovelOutline(base)) throw new Error('大纲已在其他操作中更新。请先取消编辑，重新载入最新内容。');
    const updated = { ...next, updatedAt: new Date().toISOString() };
    useTavernStore.getState().saveNovelOutlineAtScope(novelId, scopeId, updated, reason);
    if (hashNovelOutline(liveOutline()) !== hashNovelOutline(updated)) throw new Error('保存未成功，请重试。');
    setVolumeRoutes(null);
    return updated;
  }
  function save(): boolean {
    if (!edit || busy || routesBusy) return false;
    try {
      let next = edit.draft;
      if (edit.kind === 'volume' && volume) {
        const count = numberDraft.chapters.trim() ? positiveInteger(numberDraft.chapters, '计划章数') : undefined;
        const words = positiveInteger(numberDraft.words, '每章字数', 20000);
        if (volume.chapters.length && (!count || count < volume.chapters.length)) throw new Error('计划章数不能少于已有章纲数量，请先整理本卷章节。');
        const start = volumeRanges(next).find((item) => item.id === volume.id)!.start;
        if (count && next.volumes.some((item) => item.id !== volume.id && item.chapters.some((entry) => entry.index >= start && entry.index < start + count))) throw new Error('计划范围与其他卷已有章号重叠，请先从全书总纲调整分卷安排。');
        next = updateVolumePlan(next, volume.id, { title: volume.title.trim() || '未命名卷', plannedChapterCount: count, wordsPerChapter: words });
      }
      persist(next, edit.base, edit.kind === 'volume' ? '保存卷纲' : edit.kind === 'chapter' ? '保存章纲' : edit.kind === 'reorder' ? '调整章节顺序' : '保存全书总纲');
      setEdit(null);
      setError(''); setNotice('已保存');
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。'); return false; }
  }
  async function cancel() {
    if (!await mayLeave()) return;
    if (edit?.isNew) {
      setSelection(edit.kind === 'chapter' && edit.parentVolumeId ? { kind: 'volume', volumeId: edit.parentVolumeId } : { kind: 'book' });
      setEdit(null); setError(''); setNotice(''); return;
    }
    setEdit(null); setError(''); setNotice('');
  }
  function patchVolume(patch: Partial<NovelVolumePlan>) {
    if (!volumeId) return;
    setEdit((old) => old ? { ...old, draft: updateVolumePlan(old.draft, volumeId, patch) } : old);
  }
  function patchChapter(patch: Partial<NovelVolumeChapter>) {
    if (!chapter || !volumeId) return;
    setEdit((old) => old ? { ...old, draft: updateChapterPlan(old.draft, volumeId, { ...chapter, ...patch }) } : old);
  }
  async function newVolume() {
    if (!await mayLeave()) return;
    const id = generateId('volume');
    const next = cloneNovelOutline(current);
    next.volumes.push({ id, title: `第${next.volumes.length + 1}卷`, summary: '', chapters: [], plannedChapterCount: 15, wordsPerChapter: novel?.continuationSettings?.targetWords ?? 2500 });
    setSelection({ kind: 'volume', volumeId: id }); setPanel('content');
    setEdit({ kind: 'volume', base: cloneNovelOutline(current), draft: next, isNew: true });
    setNumberDraft({ chapters: '15', words: String(novel?.continuationSettings?.targetWords ?? 2500) });
    setExpanded((old) => new Set([...old, id])); setError(''); setNotice(''); resetScroll();
  }
  async function newChapter() {
    if (!volumeId || !await mayLeave()) return;
    try {
      const next = addChapterPlan(current, volumeId);
      setSelection({ kind: 'chapter', volumeId, index: next.chapter.index });
      setEdit({ kind: 'chapter', base: cloneNovelOutline(current), draft: next.outline, isNew: true, parentVolumeId: volumeId });
      setError(''); setNotice(''); resetScroll();
    } catch (cause) { setError(String(cause)); }
  }
  async function removeVolume() {
    if (!volumeId || busy || routesBusy) return;
    if (!await confirmAppAction('删除本卷章纲', '将移除本卷及其章节计划，正文保留。可通过历史版本恢复。', { confirmLabel: '删除卷纲' })) return;
    try { persist({ ...current, volumes: current.volumes.filter((item) => item.id !== volumeId) }, current, '删除卷纲'); setSelection({ kind: 'book' }); setEdit(null); setNotice('卷纲已删除，历史版本可恢复'); }
    catch (cause) { setError(String(cause)); }
  }
  async function removeChapter() {
    if (!chapter || !volumeId || busy || routesBusy) return;
    if (!await confirmAppAction('删除章纲', `删除第${chapter.index}章的计划，正文和其他章号保留。可通过历史版本恢复。`, { confirmLabel: '删除章纲' })) return;
    try {
      const next = cloneNovelOutline(current);
      const target = next.volumes.find((item) => item.id === volumeId)!;
      target.chapters = target.chapters.filter((item) => item.index !== chapter.index);
      persist(next, current, '删除章纲'); setEdit(null); setSelection({ kind: 'volume', volumeId }); setNotice('章纲已删除');
    } catch (cause) { setError(String(cause)); }
  }
  async function goToProse(saved = false) {
    if (!chapter || (!saved && !await mayLeave())) return;
    if (worldId) {
      try {
        if (!await useTavernStore.getState().switchQuickTravelWorld(novelId, worldId)) { setError('当前无法切换世界，请等待正在进行的写作任务完成。'); return; }
        router.push(`/novel/${novelId}` as Href);
      } catch (cause) { setError(cause instanceof Error ? cause.message : '切换世界失败，请重试。'); }
      return;
    }
    const existing = novel?.chapters?.find((item) => item.index === chapter.index);
    router.push(`/novel/chapters/${novelId}?${existing ? `chapterId=${encodeURIComponent(existing.id)}` : `chapterId=new&outlineIndex=${chapter.index}`}` as Href);
  }
  async function openAi(mode: AiMode) {
    if (busy || routesBusy) return;
    if (dirty) {
      if (!await confirmAppAction('保存后使用 AI', 'AI 将基于保存后的设定生成候选。先保存当前修改？', { confirmLabel: '保存并继续' })) return;
      if (!save()) return;
    }
    setEdit(null); setAiMode(mode); setPanel('ai'); setError(''); setNotice('');
    setChapterCount(String(mode === 'append' ? 3 : volume ? volume.plannedChapterCount ?? (volume.chapters.length || 15) : !hasUnplannedVolumes && current.volumes.length ? ranges.reduce((sum, item) => sum + item.count, 0) : novel?.projectBrief?.plannedChapters ?? 40));
    setWordCount(String(volume?.wordsPerChapter ?? novel?.continuationSettings?.targetWords ?? 2500));
    resetScroll();
  }

  async function forecastVolumeRoutes() {
    if (Platform.OS !== 'web' || busy || routesBusy || selection.kind !== 'volume' || !volume || !novel) return;
    if (dirty || edit?.isNew) {
      if (!await confirmAppAction('保存后推演路线', '先保存当前卷设定，再基于它推演候选路线？', { confirmLabel: '保存并推演' })) return;
      if (!save()) return;
    }
    setEdit(null);
    const state = useTavernStore.getState();
    setRoutesBusy(true); setError(''); setVolumeRoutes(null);
    try {
      const settings = resolveApiSettings(state.providers, state.generationSettings, { task: 'outline', purpose: 'utility' });
      const base = cloneNovelOutline(liveOutline());
      const scopedNovel = worldId && novel.quickTravel ? { ...novel, outline: base, quickTravel: { ...novel.quickTravel, activeWorldId: worldId } } : { ...novel, outline: base };
      const target = base.volumes.find((item) => item.id === volume.id);
      if (!target) throw new Error('当前卷已不在作品大纲中。');
      const result = await proposeNovelVolumeRoutes({ novel: scopedNovel, volume: target, apiSettings: settings });
      if (mounted.current) setVolumeRoutes({ volumeId: target.id, baseHash: hashNovelOutline(base), routes: result.routes, tokens: result.tokens, modelId: settings.model });
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '路线推演失败。'); }
    finally { if (mounted.current) setRoutesBusy(false); }
  }

  async function chooseVolumeRoute(route: NovelVolumeRoute) {
    if (Platform.OS !== 'web' || busy || routesBusy || selection.kind !== 'volume' || !volume || !novel || !volumeRoutes || volumeRoutes.volumeId !== volume.id) return;
    setRoutesBusy(true);
    try {
      if (pending && !await confirmAppAction('替换待审阅提案', '已有一份待审阅提案。新路线提案会替代它，旧提案保留在历史记录中。', { confirmLabel: '生成新提案' })) return;
      const base = cloneNovelOutline(liveOutline());
      if (volumeRoutes.baseHash !== hashNovelOutline(base)) throw new Error('路线推演期间大纲发生变化，请重新推演。');
      const candidateOutline = applyVolumeRouteToOutline(base, volumeRoutes.volumeId, route);
      const id = useTavernStore.getState().saveNovelOutlineProposal(novelId, { scopeId, operation: 'revise', prompt: `路线推演 · ${route.title}：${route.summary}`, candidateOutline, targetVolumeId: volumeRoutes.volumeId, tokens: volumeRoutes.tokens, modelId: volumeRoutes.modelId });
      if (!id) throw new Error('路线提案保存失败，请重试。');
      setVolumeRoutes(null); setPanel('review'); setNotice(`已生成「${route.title}」路线提案，采纳前不会改动正史。`); resetScroll();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '路线提案保存失败。'); }
    finally { setRoutesBusy(false); }
  }
  async function generate() {
    if (busy || routesBusy || !novel) return;
    if (!instruction.trim() && aiMode === 'text') { setError('请先写下希望修改的内容。'); return; }
    if (pending && !await confirmAppAction('替换待审阅提案', '已有一份待审阅提案。新提案生成成功后会替代它，旧提案保留在历史记录中。', { confirmLabel: '生成新提案' })) return;
    const base = cloneNovelOutline(liveOutline());
    const targetVolume = base.volumes.find((item) => item.id === volumeId);
    const selected = selection;
    const state = useTavernStore.getState();
    const scopedNovel = worldId && novel.quickTravel ? { ...novel, quickTravel: { ...novel.quickTravel, activeWorldId: worldId } } : novel;
    setBusy(true); setError('');
    try {
      const settings = resolveApiSettings(state.providers, state.generationSettings, { task: 'outline', purpose: 'utility' });
      let next: NovelOutline;
      let tokens = 0;
      if (aiMode === 'text' && selected.kind === 'chapter' && targetVolume) {
        const result = await generateNovelOutlineChapterRevision({ novel: scopedNovel, apiSettings: settings, volume: targetVolume, chapterIndex: selected.index, instruction, worldContext: worldId ? buildQuickTravelContext(scopedNovel) : undefined });
        next = updateChapterPlan(base, targetVolume.id, result.chapter); tokens = result.tokens;
      } else if (aiMode === 'text') {
        const result = await requestOutlineTextRevision({ novel: scopedNovel, outline: base, volume: targetVolume, instruction, apiSettings: settings });
        next = result.outline; tokens = result.tokens ?? 0;
      } else {
        const count = positiveInteger(chapterCount, '规划章数');
        const words = positiveInteger(wordCount, '每章字数', 20000);
        if (targetVolume) {
          const targetRange = volumeRanges(base).find((item) => item.id === targetVolume.id)!;
          const start = aiMode === 'append' ? Math.max(targetRange.start - 1, ...targetVolume.chapters.map((item) => item.index)) + 1 : targetRange.start;
          const otherRanges = volumeRanges(base).filter((item) => item.id !== targetVolume.id);
          if (otherRanges.some((item) => start <= item.end && start + count - 1 >= item.start)) throw new Error('规划范围与其他卷的章号重叠。请调整规划章数，或从全书总纲重新规划分卷。');
          const result = await generateNovelOutlineVolume({ novel: scopedNovel, apiSettings: settings, nextChapterIndex: start, analysis: novel.novelStoryAnalysis ?? null, volumeId: targetVolume.id, volumeNumber: base.volumes.findIndex((item) => item.id === targetVolume.id) + 1, chapterCount: count, wordsPerChapter: words, existingVolume: targetVolume, operation: aiMode === 'append' ? 'append' : 'create', incomingHandoff: targetVolume.handoff?.incoming, userBrief: [base.summary, targetVolume.summary, targetVolume.tone, targetVolume.foreshadowing, instruction].filter(Boolean).join('\n'), worldContext: worldId ? buildQuickTravelContext(scopedNovel) : undefined });
          const chapters = result.volume.chapters.map((item, index) => ({ ...item, index: start + index }));
          next = { ...base, volumes: base.volumes.map((item) => item.id === targetVolume.id ? { ...targetVolume, chapters: aiMode === 'append' ? [...targetVolume.chapters, ...chapters] : chapters, plannedChapterCount: Math.max(targetVolume.plannedChapterCount ?? 0, aiMode === 'append' ? targetVolume.chapters.length + chapters.length : chapters.length), status: 'ready' } : item) };
          tokens = result.tokens;
        } else {
          const existingDirection = base.volumes.map((item) => `${item.title}（${hasChapterPlan(item) ? `计划${item.plannedChapterCount ?? item.chapters.length}章` : '待分章'}）：${[item.summary, item.tone, item.foreshadowing, item.handoff?.outgoing].filter(Boolean).join('；')}`).join('\n');
          const result = await generateOutlineInVolumes({ novel: scopedNovel, apiSettings: settings, nextChapterIndex: base.baseChapterIndex ?? ranges[0]?.start ?? 1, analysis: novel.novelStoryAnalysis ?? null, targetChapterCount: count, targetWords: count * words, userBrief: [base.summary, existingDirection && `【已有分卷方向，除非作者要求调整，否则保持各阶段节奏】\n${existingDirection}`, instruction].filter(Boolean).join('\n'), worldContext: worldId ? buildQuickTravelContext(scopedNovel) : undefined });
          next = { ...result.outline, summary: base.summary.trim() ? base.summary : result.outline.summary }; tokens = result.tokens;
        }
      }
      if (hashNovelOutline(liveOutline()) !== hashNovelOutline(base)) throw new Error('生成期间大纲发生变化，本次结果未覆盖当前内容，请基于最新版本重试。');
      const proposalId = useTavernStore.getState().saveNovelOutlineProposal(novelId, { scopeId, operation: aiMode === 'append' ? 'append' : aiMode === 'text' ? 'revise' : 'create', prompt: `${selected.kind === 'book' ? '全书' : selected.kind === 'volume' ? targetVolume?.title : `第${selected.index}章`} · ${aiMode === 'text' ? '文字修改' : aiMode === 'append' ? '追加章节' : '规划章节'}：${instruction}`, candidateOutline: next, targetVolumeId: volumeId, targetChapterIndexes: selected.kind === 'chapter' ? [selected.index] : undefined, tokens, modelId: settings.model });
      if (!proposalId) throw new Error('提案保存失败，请重试。');
      if (mounted.current) { setPanel('review'); setInstruction(''); resetScroll(); }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '生成失败，当前大纲已保留。'); }
    finally { if (mounted.current) setBusy(false); }
  }
  function accept() {
    if (!pending || stale) return;
    const result = useTavernStore.getState().acceptNovelOutlineProposal(novelId, pending.id);
    if (!result.ok) { setError('提案已过期或失效，请基于当前大纲重新生成。'); return; }
    setPanel('content'); setEdit(null); setNotice('提案已采纳，正文未被改写');
    if (selection.kind !== 'book') {
      const selectedVolume = liveOutline().volumes.find((item) => item.id === selection.volumeId);
      if (!selectedVolume) setSelection({ kind: 'book' });
      else if (selection.kind === 'chapter' && !selectedVolume.chapters.some((item) => item.index === selection.index)) setSelection({ kind: 'volume', volumeId: selectedVolume.id });
    }
    resetScroll();
  }
  async function restore(versionId: string) {
    const version = versions.find((item) => item.id === versionId);
    if (!version) return;
    if (pending && !await confirmAppAction('替换待审阅提案', '恢复预览会替代当前待审阅提案，旧提案保留在历史记录中。', { confirmLabel: '预览恢复' })) return;
    const id = useTavernStore.getState().saveNovelOutlineProposal(novelId, { scopeId, operation: 'create', prompt: `恢复历史版本：${new Date(version.createdAt).toLocaleString()}`, candidateOutline: version.outline });
    if (id) { setPanel('review'); resetScroll(); } else setError('无法创建恢复提案。');
  }
  function importIdeas(asVolumes: boolean) {
    if (!novel) return;
    try {
      const blueprint = readNovelBlueprint(novel);
      const next = asVolumes ? { ...current, volumes: [...current.volumes, ...buildLegacyVolumeSeeds(current, blueprint, scopeId)] } : { ...current, summary: mergeLegacyStoryIntoSummary(current.summary, blueprint) };
      persist(next, current, '整理已有故事构思'); setNotice('已有构思已并入大纲');
    } catch (cause) { setError(String(cause)); }
  }

  async function openStoryImport() {
    if (!await mayLeave()) return;
    setEdit(null); setImportOpen(true);
  }

  const editing = edit?.kind === 'book' || edit?.kind === 'volume';
  const title = panel === 'review' ? '审阅修改提案' : panel === 'history' ? '历史版本' : panel === 'ai' ? (selection.kind === 'book' ? 'AI 协助规划全书' : selection.kind === 'volume' ? `AI 协助${aiMode === 'text' ? '修改卷纲' : '规划本卷章节'}` : `AI 协助修改第${chapter?.index ?? ''}章`) : selection.kind === 'book' ? (editing ? '编辑全书总纲' : '全书总纲') : selection.kind === 'volume' ? (editing ? '编辑卷纲' : volume?.title ?? '该卷已不存在') : chapter?.title || '章节细纲';
  const worldHref = worldId ? `/novel/world/${novelId}?worldId=${worldId}` : `/novel/knowledge/lore/${novelId}`;

  return <View style={[styles.root, { backgroundColor: theme.background }]}>
    <View style={[styles.directory, { width: compact ? 230 : 270, borderRightColor: theme.outlineVariant, backgroundColor: theme.surface }]}>
      <View style={styles.directoryHeader}><Action quiet onPress={() => void mayLeave().then((ok) => { if (ok) router.push('/novels'); })}>‹ 返回作品</Action><ThemedText type="subtitle" style={styles.projectTitle} numberOfLines={2}>{world?.name ?? novel.name}</ThemedText><ThemedText type="small" themeColor="textMuted">故事大纲</ThemedText><TextInput accessibilityLabel="搜索大纲目录" placeholder="搜索目录…" value={search} onChangeText={setSearch} placeholderTextColor={theme.textMuted} style={[styles.search, { color: theme.text, borderColor: theme.outlineVariant }]} /></View>
      <ScrollView style={styles.tree} contentContainerStyle={styles.treeContent} keyboardShouldPersistTaps="handled">
        <TreeRow label="全书总纲" active={selection.kind === 'book'} onPress={() => void choose({ kind: 'book' })} disabled={busy} />
        {outline.volumes.filter((item) => !search || [item.title, ...item.chapters.map((entry) => entry.title)].some((text) => text.toLowerCase().includes(search.toLowerCase()))).map((item) => {
          const itemRange = ranges.find((entry) => entry.id === item.id);
          const open = expanded.has(item.id) || Boolean(search);
          return <View key={item.id}>
            <View style={styles.treeVolume}><Pressable accessibilityRole="button" accessibilityLabel={`${open ? '收起' : '展开'}${item.title}`} accessibilityState={{ expanded: open }} onPress={() => setExpanded((old) => { const next = new Set(old); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} style={styles.chevron}><ThemedText themeColor="textSecondary">{open ? '⌄' : '›'}</ThemedText></Pressable><View style={styles.flex}><TreeRow label={item.title || '未命名卷'} detail={!hasChapterPlan(item) ? '待分章' : itemRange ? `${itemRange.start}–${itemRange.end}章` : ''} active={selection.kind === 'volume' && selection.volumeId === item.id} onPress={() => void choose({ kind: 'volume', volumeId: item.id })} disabled={busy} /></View></View>
            {open && <View style={[styles.chapterTree, { borderLeftColor: theme.outlineVariant }]}>{item.chapters.filter((entry) => !search || item.title.includes(search) || entry.title.includes(search)).map((entry) => <TreeRow key={entry.index} label={`${entry.index}  ${entry.title || '未命名章'}`} active={selection.kind === 'chapter' && selection.volumeId === item.id && selection.index === entry.index} onPress={() => void choose({ kind: 'chapter', volumeId: item.id, index: entry.index })} disabled={busy} />)}{item.chapters.length === 0 && <ThemedText type="small" themeColor="textMuted" style={styles.emptyTree}>暂无章节计划</ThemedText>}</View>}
          </View>;
        })}
      </ScrollView>
      <View style={[styles.directoryFooter, { borderTopColor: theme.outlineVariant }]}><Action onPress={() => void newVolume()} disabled={busy}>＋ 新建卷</Action><ThemedText type="small" themeColor="textMuted">{busy ? '正在生成提案…' : dirty ? '有未保存的修改' : '修改已保存'}</ThemedText></View>
    </View>
    <View style={styles.main}>
      <View style={[styles.topbar, { borderBottomColor: theme.outlineVariant }]}>
        <View style={styles.breadcrumb}>
          <Action quiet onPress={() => void choose({ kind: 'book' })}>全书总纲</Action>
          {volume && <><ThemedText themeColor="textMuted">/</ThemedText><Action quiet onPress={() => void choose({ kind: 'volume', volumeId: volume.id })}>{volume.title}</Action></>}
          {chapter && <ThemedText type="small" themeColor="textSecondary">/ 第{chapter.index}章</ThemedText>}
        </View>
        <View style={styles.actions}>
          <TaskModelSelector task="outline" disabled={busy || routesBusy} />
          {!worldId && !novel.quickTravel?.config.enabled && <Action onPress={() => void openStoryImport()} disabled={busy}>粘贴识别</Action>}
          {review && panel !== 'review' && <Action onPress={() => void showPanel('review')}>待审阅提案</Action>}
          <Action quiet onPress={() => void showPanel('history')}>历史版本</Action>
        </View>
      </View>
      <ScrollView ref={scroll} style={styles.contentScroll} contentContainerStyle={[styles.content, compact && styles.contentCompact]} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}><View style={styles.headingText}>{chapter && panel === 'content' && <ThemedText type="small" themeColor="textMuted">第{chapter.index}章 · 章节细纲</ThemedText>}<ThemedText type="title" style={styles.title}>{title}</ThemedText>{panel === 'content' && <ThemedText type="small" themeColor="textSecondary">{selection.kind === 'book' ? `${hasUnplannedVolumes ? '章数待规划' : `${ranges.reduce((sum, item) => sum + item.count, 0)}章`} · ${outline.volumes.length}卷` : selection.kind === 'volume' ? `${!hasChapterPlan(volume) ? '待分章' : range ? `第${range.start}–${range.end}章` : ''}${volume?.tone ? ` · ${volume.tone}` : ''}` : ''}</ThemedText>}</View>
          <View style={styles.actions}>{panel === 'content' ? Boolean(edit) ? <><Action onPress={() => void cancel()} disabled={busy}>取消</Action><Action primary onPress={save} disabled={busy || !dirty}>{selection.kind === 'book' ? '保存总纲' : selection.kind === 'chapter' ? '保存章纲' : edit?.kind === 'reorder' ? '保存顺序' : '保存卷纲'}</Action></> : <><Action onPress={() => beginEditing(selection.kind === 'book' ? 'book' : selection.kind === 'chapter' ? 'chapter' : 'volume')} disabled={busy || (selection.kind !== 'book' && !volume)}>{selection.kind === 'book' ? '编辑总纲' : selection.kind === 'chapter' ? '编辑章纲' : '编辑卷纲'}</Action><Action primary onPress={() => void openAi('text')} disabled={busy || (selection.kind !== 'book' && !volume)}>{selection.kind === 'book' ? 'AI 协助修改总纲' : selection.kind === 'chapter' ? 'AI 协助修改本章' : 'AI 协助修改卷纲'}</Action></> : <Action onPress={() => { if (!busy) { setPanel('content'); setError(''); } }} disabled={busy}>返回{selection.kind === 'book' ? '总纲' : selection.kind === 'volume' ? '本卷' : '章纲'}</Action>}</View>
        </View>
        {Boolean(error) && <View accessibilityRole="alert" style={[styles.feedback, { backgroundColor: theme.surfaceVariant }]}><ThemedText themeColor="error">{error}</ThemedText></View>}
        {Boolean(notice) && <ThemedText accessibilityLiveRegion="polite" type="small" themeColor="primary">{notice}</ThemedText>}
        {panel === 'content' && selection.kind !== 'book' && <View style={[styles.context, { backgroundColor: theme.surfaceVariant }]}><ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{selection.kind === 'chapter' ? `${volume?.title ?? ''} · ${volume?.tone || '本卷方向'}：${volume?.foreshadowing || volume?.summary || '尚未填写'}` : `全书方向：${current.summary || novel.projectBrief?.premise || '尚未填写'}`}</ThemedText></View>}

        {panel === 'content' && selection.kind === 'book' && <>
          {edit?.kind === 'book' ? <Field label="故事主线与结局方向" value={outline.summary} onChange={(value) => setEdit((old) => old ? { ...old, draft: { ...old.draft, summary: value } } : old)} multiline disabled={busy} placeholder="写下故事从哪里开始、主要冲突与结局方向。" /> : <Section title="故事主线"><ThemedText style={styles.prose}>{outline.summary || '先写下故事的主线与结局，再逐步细化各卷。'}</ThemedText></Section>}
          {!edit && <Section title="篇幅与节奏" action={<Action quiet onPress={() => void openAi('plan')}>AI 规划分卷与章节</Action>}>
            {outline.volumes.map((item, index) => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`查看卷纲 ${item.title}`} onPress={() => void choose({ kind: 'volume', volumeId: item.id })} style={({ hovered }) => [styles.volumeRow, { borderBottomColor: theme.outlineVariant, backgroundColor: hovered ? theme.surfaceVariant : 'transparent' }]}><ThemedText type="code" themeColor="primary" style={styles.range}>{hasChapterPlan(item) ? `${ranges[index].start}–${ranges[index].end}` : '待分章'}</ThemedText><View style={styles.flex}><ThemedText type="smallBold">{item.title}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{item.tone ? `${item.tone} · ` : ''}{item.summary || '点击补充本卷目标'}</ThemedText></View><ThemedText themeColor="textMuted">›</ThemedText></Pressable>)}
            {outline.volumes.length === 0 && <View style={styles.empty}><ThemedText themeColor="textSecondary">还没有分卷。可以先建一卷，或让 AI 根据总纲规划。</ThemedText><Action onPress={() => void newVolume()}>新建第一卷</Action></View>}
          </Section>}
          {!edit && <View style={styles.footerLinks}><Action quiet onPress={() => router.push(worldHref as Href)}>世界设定 ↗</Action><Action quiet onPress={() => importIdeas(false)}>从已有构思补充主线</Action>{readNovelBlueprint(novel).longForm.arcs.length > 0 && <Action quiet onPress={() => importIdeas(true)}>将已有阶段整理为卷</Action>}</View>}
        </>}

        {panel === 'content' && selection.kind === 'volume' && volume && <>
          {edit?.kind === 'volume' ? <>
            <View style={styles.formRow}><Field label="卷名" value={volume.title} onChange={(title) => patchVolume({ title })} disabled={busy} /><Field label="计划章数" value={numberDraft.chapters} onChange={(chapters) => setNumberDraft((old) => ({ ...old, chapters }))} placeholder="待分章" optional narrow disabled={busy} /><Field label="节奏基调" value={volume.tone ?? ''} onChange={(tone) => patchVolume({ tone })} optional disabled={busy} /></View>
            <View style={styles.synopsisHeading}><ThemedText type="smallBold">本卷梗概</ThemedText><View style={styles.actions}><Action onPress={() => void openAi('text')} disabled={busy}>AI 协助修改卷纲</Action>{Platform.OS === 'web' && <Action onPress={() => void forecastVolumeRoutes()} disabled={busy || routesBusy}>{routesBusy ? '推演中…' : '推演本卷路线'}</Action>}</View></View>
            <TextInput accessibilityLabel="本卷梗概" multiline textAlignVertical="top" value={volume.summary} onChangeText={(summary) => patchVolume({ summary })} style={[styles.input, styles.synopsis, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.outlineVariant }]} placeholder="自由写下本卷目标、关键转折与人物关系。" placeholderTextColor={theme.textMuted} />
            <ThemedText type="small" themeColor="textMuted">自由写下本卷目标、关键转折与人物关系，不必逐项填表。</ThemedText>
            <View style={styles.formRow}><Field label="伏笔边界" value={volume.foreshadowing ?? ''} onChange={(foreshadowing) => patchVolume({ foreshadowing })} optional multiline /><Field label="卷末状态" value={volume.handoff?.outgoing ?? ''} onChange={(outgoing) => patchVolume({ handoff: { ...volume.handoff, outgoing } })} optional multiline /></View>
            <Action quiet onPress={() => setAdvanced(!advanced)}>{advanced ? '收起' : '展开'}篇幅与前卷衔接</Action>
            {advanced && <View style={styles.formRow}><Field label="每章字数" value={numberDraft.words} onChange={(words) => setNumberDraft((old) => ({ ...old, words }))} narrow /><Field label="前卷衔接" value={volume.handoff?.incoming ?? ''} onChange={(incoming) => patchVolume({ handoff: { ...volume.handoff, incoming } })} optional multiline /></View>}
            <ThemedText type="small" themeColor="textSecondary">已关联{volume.chapters.length}章 · 保存卷纲后可另行调整章纲，已有正文保持不变。</ThemedText>
          </> : <>
            <Section title="本卷要完成什么"><ThemedText style={styles.prose}>{volume.summary || '还没有填写本卷梗概。点击“编辑卷纲”完善。'}</ThemedText>{Boolean(volume.foreshadowing) && <><ThemedText type="smallBold">伏笔边界</ThemedText><ThemedText themeColor="textSecondary">{volume.foreshadowing}</ThemedText></>}{Boolean(volume.handoff?.outgoing) && <><ThemedText type="smallBold">卷末状态</ThemedText><ThemedText themeColor="textSecondary">{volume.handoff?.outgoing}</ThemedText></>}<View style={styles.actions}>{Platform.OS === 'web' && <Action onPress={() => void forecastVolumeRoutes()} disabled={busy || routesBusy}>{routesBusy ? '推演中…' : '推演本卷路线'}</Action>}</View>{(volumeRoutes?.volumeId === volume.id ? volumeRoutes.routes : []).map((route) => <View key={route.title} style={[styles.context, { backgroundColor: theme.surfaceVariant }]}><ThemedText type="smallBold">{route.title}</ThemedText><ThemedText type="small">{route.summary}</ThemedText><ThemedText type="small" themeColor="textSecondary">转折：{route.turningPoint} · 风险：{route.risk} · 卷末：{route.endingState}</ThemedText><Action primary onPress={() => void chooseVolumeRoute(route)} disabled={busy || routesBusy}>选择这条路线</Action></View>)}</Section>
            <Section title="章节安排" action={<View style={styles.actions}><Action quiet onPress={() => void newChapter()} disabled={Boolean(edit)}>＋ 添加章节</Action><Action quiet onPress={() => beginEditing('reorder')} disabled={Boolean(edit) || volume.chapters.length < 2}>排序</Action></View>}>
              {edit?.kind === 'reorder' && <ThemedText type="small" themeColor="textSecondary">调整章纲在本卷中的顺序。已有正文不会随之移动，请核对正文与章纲的对应关系。</ThemedText>}
              {volume.chapters.map((item, index) => <View key={item.index} style={[styles.chapterRow, { borderBottomColor: theme.outlineVariant }]}><Pressable accessibilityRole="button" accessibilityLabel={`编辑章纲 第${item.index}章 ${item.title}`} onPress={() => void choose({ kind: 'chapter', volumeId: volume.id, index: item.index })} style={styles.chapterLink}><ThemedText type="code" themeColor="primary" style={styles.chapterIndex}>{String(item.index).padStart(2, '0')}</ThemedText><View style={styles.flex}><ThemedText type="smallBold">{item.title}</ThemedText><ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{item.goal || '待完善本章情节'}</ThemedText></View><ThemedText type="small" themeColor="textMuted">{item.goal.trim() ? '已规划' : '待完善'} ›</ThemedText></Pressable>{edit?.kind === 'reorder' && <View style={styles.actions}><Action label={`上移第${item.index}章`} disabled={index === 0} onPress={() => setEdit((old) => old ? { ...old, draft: reorderChapterPlans(old.draft, volume.id, index, -1) } : old)}>↑</Action><Action label={`下移第${item.index}章`} disabled={index === volume.chapters.length - 1} onPress={() => setEdit((old) => old ? { ...old, draft: reorderChapterPlans(old.draft, volume.id, index, 1) } : old)}>↓</Action></View>}</View>)}
              {!volume.chapters.length && <ThemedText themeColor="textSecondary">本卷还没有章纲，可以手动添加，或按卷纲生成章节提案。</ThemedText>}
              {!edit && <View style={styles.actions}><Action onPress={() => void openAi('plan')}>AI 规划本卷章节</Action>{volume.chapters.length > 0 && <Action onPress={() => void openAi('append')}>追加章节</Action>}</View>}
            </Section>
            {!edit && <View style={styles.footerLinks}><Action quiet onPress={() => void removeVolume()}>删除本卷章纲</Action></View>}
          </>}
        </>}

        {panel === 'content' && selection.kind === 'chapter' && chapter && <>
          <Field label="章节标题" value={chapter.title} onChange={(title) => patchChapter({ title })} disabled={!edit || busy} />
          <View style={styles.synopsisHeading}><ThemedText type="smallBold">本章发生什么</ThemedText>{edit && <Action onPress={() => void openAi('text')} disabled={busy}>AI 协助修改本章</Action>}</View>
          <TextInput accessibilityLabel="本章发生什么" editable={Boolean(edit) && !busy} multiline textAlignVertical="top" value={chapter.goal} onChangeText={(goal) => patchChapter({ goal })} style={[styles.input, styles.synopsis, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.outlineVariant }]} placeholder="这一章发生什么，带来什么变化？" placeholderTextColor={theme.textMuted} />
          <View style={styles.formRow}><Field label="人物变化" value={chapter.characterChange ?? ''} onChange={(characterChange) => patchChapter({ characterChange })} optional multiline disabled={!edit || busy} /><Field label="伏笔与线索" value={chapter.foreshadowing ?? ''} onChange={(foreshadowing) => patchChapter({ foreshadowing })} optional multiline disabled={!edit || busy} /></View>
          <Field label="章末衔接" value={chapter.endingHook ?? ''} onChange={(endingHook) => patchChapter({ endingHook })} optional disabled={!edit || busy} />
          <Pressable accessibilityRole="checkbox" accessibilityLabel="在本章收束当前场景" accessibilityState={{ checked: Boolean(chapter.sceneEnd), disabled: !edit }} disabled={!edit} onPress={() => patchChapter({ sceneEnd: !chapter.sceneEnd })} style={styles.check}><ThemedText themeColor="textSecondary">{chapter.sceneEnd ? '☑' : '□'} 在本章收束当前场景（选填）</ThemedText></Pressable>
          <View style={[styles.chapterNavigation, { borderTopColor: theme.outlineVariant }]}>{[-1, 1].map((direction) => { const sibling = volume?.chapters[(volume.chapters.findIndex((item) => item.index === chapter.index) ?? 0) + direction]; return sibling ? <Action key={direction} quiet onPress={() => void choose({ kind: 'chapter', volumeId: volume!.id, index: sibling.index })}>{direction < 0 ? '← 上一章：' : '下一章：'}{sibling.title}{direction > 0 ? ' →' : ''}</Action> : <View key={direction} />; })}</View>
          {worldId && <ThemedText type="small" themeColor="textSecondary">本世界通过连续对话续写，进入后将切换到对应世界并使用它的大纲。</ThemedText>}
          <View style={styles.chapterNavigation}><Action quiet onPress={() => void removeChapter()} disabled={busy}>删除章纲</Action><Action onPress={() => { if (dirty && !save()) return; void goToProse(true); }} disabled={busy}>{worldId ? '进入本世界续写 →' : '去写本章正文 →'}</Action></View>
        </>}

        {panel === 'ai' && <>
          <ThemedText themeColor="textSecondary">{aiMode === 'text' ? `只修改${selection.kind === 'book' ? '总纲文字' : selection.kind === 'volume' ? '本卷梗概与约束' : '当前章纲'}，章节结构保持不变。` : '先生成章节规划提案，审阅采纳后生效。已有正文保持不变。'}</ThemedText>
          <Field label="希望如何调整" value={instruction} onChange={setInstruction} multiline disabled={busy} placeholder="例如：前15章保持轻松搞笑，主角仍在高中，不提前揭示残魂身份。" />
          {aiMode !== 'text' && <View style={styles.formRow}><Field label={aiMode === 'append' ? '追加章数' : '规划章数'} value={chapterCount} onChange={setChapterCount} narrow disabled={busy} /><Field label="每章字数" value={wordCount} onChange={setWordCount} narrow disabled={busy} /></View>}
          <View style={styles.actions}><Action primary onPress={() => void generate()} disabled={busy}>{busy ? '正在生成，请稍候…' : '生成修改提案'}</Action></View>
        </>}

        {panel === 'review' && <>
          {review ? <><ThemedText style={styles.prose}>{review.prompt || '大纲修改提案'}</ThemedText>{stale && <ThemedText accessibilityRole="alert" themeColor="error">当前大纲已变化，这份提案不能采纳。请保留当前内容并重新生成。</ThemedText>}
            <View style={styles.actions}><Action primary onPress={accept} disabled={stale || !pending}>采纳提案</Action><Action onPress={() => { useTavernStore.getState().rejectNovelOutlineProposal(novelId, review.id); setPanel('content'); setNotice('提案已丢弃，原大纲保留'); }}>丢弃提案</Action></View>
            <ThemedText type="small" themeColor="textSecondary">共{differences.length}项变化 · 采纳前请核对下面的原文与候选内容。</ThemedText>
            {differences.map((item) => <Section key={item.key} title={item.label}><View style={styles.diffRow}><View style={[styles.diffCell, { backgroundColor: theme.surfaceVariant }]}><ThemedText type="smallBold" themeColor="textMuted">当前内容</ThemedText><ThemedText style={styles.prose}>{item.before || '（空）'}</ThemedText></View><View style={[styles.diffCell, { backgroundColor: theme.primaryContainer }]}><ThemedText type="smallBold" themeColor="primary">候选内容</ThemedText><ThemedText style={styles.prose}>{item.after || '（删除）'}</ThemedText></View></View></Section>)}
            {differences.length === 0 && <ThemedText themeColor="textSecondary">没有文字变化。可丢弃提案返回。</ThemedText>}
          </> : <ThemedText themeColor="textSecondary">暂无待审阅提案。</ThemedText>}
        </>}
        {panel === 'history' && <>
          <ThemedText themeColor="textSecondary">恢复操作先创建提案，核对差异后再采纳。</ThemedText>
          {versions.map((version) => <View key={version.id} style={[styles.historyRow, { borderBottomColor: theme.outlineVariant }]}><View style={styles.flex}><ThemedText type="smallBold">{new Date(version.createdAt).toLocaleString()}</ThemedText><ThemedText type="small" themeColor="textSecondary">{version.reason || '大纲快照'} · {version.outline.volumes.length}卷</ThemedText></View><Action onPress={() => void restore(version.id)}>预览恢复</Action></View>)}
          {!versions.length && <ThemedText themeColor="textSecondary">尚无历史版本。保存大纲后会自动保留记录。</ThemedText>}
          {history.length > 0 && <Section title="提案记录">{history.map((item: NovelOutlineProposal) => <View key={item.id} style={[styles.historyRow, { borderBottomColor: theme.outlineVariant }]}><View style={styles.flex}><ThemedText type="small" numberOfLines={2}>{item.prompt}</ThemedText><ThemedText type="small" themeColor="textMuted">{new Date(item.createdAt).toLocaleString()}</ThemedText></View><ThemedText type="small" themeColor="textSecondary">{{ pending: '待审阅', accepted: '已采纳', rejected: '已丢弃', conflicted: '已过期', failed: '失败' }[item.status]}</ThemedText></View>)}</Section>}
        </>}
      </ScrollView>
    </View>
    <StoryImportModal key={novelId} novelId={novelId} visible={importOpen} onClose={() => setImportOpen(false)} onApplied={() => { setSelection({ kind: 'book' }); setEdit(null); setPanel('content'); setNotice('识别资料已写入；未分章的卷可继续规划章节。'); }} />
  </View>;
}

function TreeRow({ label, detail, active, onPress, disabled }: { label: string; detail?: string; active?: boolean; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={({ hovered, pressed }) => [styles.treeRow, { backgroundColor: active ? theme.primaryContainer : hovered ? theme.surfaceVariant : 'transparent', borderLeftColor: active ? theme.primary : 'transparent' }, (disabled || pressed) && styles.dim]}><ThemedText type={active ? 'smallBold' : 'small'} numberOfLines={2} style={styles.flex}>{label}</ThemedText>{Boolean(detail) && <ThemedText type="code" themeColor="textMuted">{detail}</ThemedText>}</Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', minHeight: 0 }, directory: { borderRightWidth: 1, flexShrink: 0, minHeight: 0 }, directoryHeader: { padding: 20, gap: 8 }, projectTitle: { fontSize: 23, lineHeight: 32 }, search: { borderWidth: 1, borderRadius: 5, padding: 12, marginTop: 10, fontFamily: Fonts.sans, fontSize: 14 }, tree: { flex: 1 }, treeContent: { paddingHorizontal: 10, paddingBottom: 24, gap: 8 }, treeVolume: { flexDirection: 'row', alignItems: 'center' }, chevron: { width: 28, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, treeRow: { minHeight: 44, padding: 10, gap: 5, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3, borderRadius: 4 }, chapterTree: { marginLeft: 27, paddingLeft: 8, borderLeftWidth: 1 }, emptyTree: { padding: 10 }, directoryFooter: { padding: 20, gap: 12, borderTopWidth: 1 }, main: { flex: 1, minWidth: 0, minHeight: 0 }, topbar: { minHeight: 64, borderBottomWidth: 1, paddingHorizontal: 24, paddingVertical: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, breadcrumb: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flexGrow: 1, flexBasis: 240, minWidth: 0 }, contentScroll: { flex: 1 }, content: { padding: 40, paddingBottom: 80, gap: 24, maxWidth: 1300, width: '100%', alignSelf: 'center' }, contentCompact: { padding: 24 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }, headingText: { flexGrow: 1, flexBasis: 280, gap: 8 }, title: { fontSize: 34, lineHeight: 45 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }, button: { minHeight: 42, borderWidth: 1, borderRadius: 5, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' }, dim: { opacity: 0.5 }, flex: { flex: 1, minWidth: 0, gap: 5 }, section: { borderTopWidth: 1, paddingTop: 24, gap: 18 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }, sectionTitle: { fontSize: 23, lineHeight: 32 }, prose: { fontSize: 16, lineHeight: 29 }, volumeRow: { minHeight: 90, flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 22, borderBottomWidth: 1 }, range: { width: 64 }, empty: { gap: 16, paddingVertical: 24, alignItems: 'flex-start' }, footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }, context: { padding: 16, borderRadius: 5 }, formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 }, field: { flexGrow: 1, flexBasis: 240, gap: 10 }, narrowField: { flexGrow: 0, flexBasis: 140 }, input: { borderWidth: 1, borderRadius: 5, padding: 14, minHeight: 48, fontSize: 16, lineHeight: 26, fontFamily: Fonts.sans }, textarea: { minHeight: 120 }, synopsis: { minHeight: 220 }, synopsisHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: -12 }, feedback: { padding: 14, borderRadius: 5 }, chapterRow: { borderBottomWidth: 1, gap: 10, paddingVertical: 12 }, chapterLink: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 18 }, chapterIndex: { width: 30 }, check: { minHeight: 44, justifyContent: 'center' }, chapterNavigation: { paddingTop: 20, borderTopWidth: 0, flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }, diffRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }, diffCell: { flex: 1, flexBasis: 260, padding: 20, gap: 12, borderRadius: 5 }, historyRow: { minHeight: 84, paddingVertical: 18, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
});
