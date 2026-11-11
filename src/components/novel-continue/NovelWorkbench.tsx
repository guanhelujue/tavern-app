import { TaskModelSelector } from '@/components/TaskModelSelector';
import { MobileAction, MobileEmptyState, MobileSectionTitle, mobileStyles } from '@/components/mobile/MobileUI';
import { NovelMobileNavigation } from '@/components/novel-continue/NovelMobileNavigation';
import { router, useNavigation } from 'expo-router';
import type { NavigationProp } from 'expo-router/react-navigation';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { NovelChapterEditorModal } from '@/components/novel-continue/NovelChapterEditorModal';
import { NovelAvailabilityState } from '@/components/novel-continue/NovelAvailabilityState';
import { NovelSceneInspirationModal } from '@/components/NovelSceneInspirationModal';
import { KnowledgePanel } from '@/components/novel-continue/KnowledgePanel';
import { ConsistencyPanel } from '@/components/novel-continue/ConsistencyPanel';
import { NovelContextPanel } from '@/components/novel-continue/NovelContextPanel';
import { WorkbenchPanel } from '@/components/novel-continue/WorkbenchPanel';
import { AnalysisStep } from '@/components/novel-rewrite/AnalysisStep';
import { ForecastStep } from '@/components/novel-rewrite/ForecastStep';
import {
  EMPTY_GUIDE,
  GuideStep,
  type UserGuide,
} from '@/components/novel-rewrite/NovelRewriteScreen';
import { ThemedText } from '@/components/themed-text';
import { DraftTextInput } from '@/components/ui/DraftTextInput';
import { Spacing } from '@/constants/theme';
import { NOVEL_TARGET_WORDS_RANGE } from '@/constants/novel-continuation';
import { useTheme } from '@/hooks/use-theme';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { getFinalChapters } from '@/services/novel-continuation-pipeline';
import { getNovelAuditSourceFingerprint, isNovelRewriteAuditCurrent } from '@/services/novel-audit-freshness';
import { useTavernStore } from '@/store/tavern-store';
import type { Message, Novel, NovelChapter, NovelContinuationSettings } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { exportAssistantTranscript, exportChatSessionBundle } from '@/utils/chat-session-io';
import {
  calculateNovelOutlineTotalWords,
  clampNovelOutlineChapterCount,
} from '@/utils/novel-outline-options';

export type WorkbenchTab = 'chapters' | 'tools' | 'analysis' | 'forecast' | 'outline' | 'knowledge' | 'consistency' | 'settings' | 'context';

const TABS: { key: WorkbenchTab; label: string }[] = [
  { key: 'chapters', label: '章节' },
  { key: 'analysis', label: '分析' },
  { key: 'forecast', label: '路线' },
  { key: 'outline', label: '大纲' },
  { key: 'knowledge', label: '剧情资料' },
  { key: 'consistency', label: '一致性' },
  { key: 'settings', label: '设置' },
];

export function NovelWorkbench({
  novelId,
  initialTab = 'chapters',
  autoAnalyze = false,
}: {
  novelId: string;
  initialTab?: WorkbenchTab;
  autoAnalyze?: boolean;
}) {
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp<{ workbench: { focus?: WorkbenchTab } }>>();
  const desktop = useDesktopLayout();
  const { width } = useWindowDimensions();
  const splitPanels = desktop && width >= 1280;
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  // The route is shared by the mobile tabs and the desktop project navigation.
  const tab = initialTab;
  const tabTitle = tab === 'tools' ? '任务与导出' : tab === 'context' ? '上下文管理' : tab === 'analysis' ? '正文分析' : tab === 'chapters' ? '章节创作' : tab === 'forecast' ? '路线推演' : tab === 'consistency' ? '一致性检查' : tab === 'settings' ? '写作参数' : TABS.find((item) => item.key === tab)?.label;
  function setTab(next: WorkbenchTab) {
    navigation.setParams({ focus: next });
  }
  const [guide, setGuide] = useState<UserGuide>(EMPTY_GUIDE);
  const [showGuide, setShowGuide] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [showInstructionInput, setShowInstructionInput] = useState(false);
  const [showSceneInspiration, setShowSceneInspiration] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [fileAction, setFileAction] = useState<'export' | 'backup' | null>(null);

  // 长任务运行状态以 store 中的任务记录为准：切页 / 切出本小说后组件重挂载也能恢复真实状态。
  const jobs = novel?.novelGenerationJobs ?? [];
  const isGenerating = jobs.some((job) => job.kind === 'write' && job.status === 'running');
  const isOutlineGenerating = jobs.some((job) => job.kind === 'outline' && job.status === 'running');

  const chapters = useMemo(
    () =>
      (novel?.chapters ?? []).slice().sort((a, b) => a.index - b.index),
    [novel?.chapters],
  );
  const finalCount = novel ? getFinalChapters(novel).length : 0;
  const draftChapters = chapters.filter((item) => item.status === 'draft');
  const editingChapter = chapters.find((item) => item.id === editingChapterId) ?? null;
  const totalChars = chapters.reduce((sum, item) => sum + item.content.replace(/\s/g, '').length, 0);
  const completedWriteJobs = jobs.filter((job) => job.kind === 'write' && job.status === 'completed');
  const totalGenerationTokens = completedWriteJobs.reduce(
    (sum, job) => sum + (job.promptTokens ?? 0) + (job.completionTokens ?? 0), 0,
  );
  const averageGenerationTokens = completedWriteJobs.length
    ? Math.round(totalGenerationTokens / completedWriteJobs.length)
    : 0;
  const averageGenerationMs = completedWriteJobs.length
    ? Math.round(completedWriteJobs.reduce((sum, job) => sum + (job.durationMs ?? 0), 0) / completedWriteJobs.length)
    : 0;

  const rewriteNovelNextChapter = useTavernStore((state) => state.rewriteNovelNextChapter);
  const generateNovelOutline = useTavernStore((state) => state.generateNovelOutline);
  const deleteNovelChapter = useTavernStore((state) => state.deleteNovelChapter);
  const hydrateNovelChapterContent = useTavernStore((state) => state.hydrateNovelChapterContent);
  const resumeNovelGenerationJob = useTavernStore((state) => state.resumeNovelGenerationJob);
  const abandonNovelGenerationJob = useTavernStore((state) => state.abandonNovelGenerationJob);
  const retryNovelGenerationJob = useTavernStore((state) => state.retryNovelGenerationJob);
  const recoverableWriteJob = jobs.find((job) => job.kind === 'write' && job.status === 'paused');

  // 空草稿 = 生成失败 / 中断残留（无正文），可安全清理。
  const emptyDraftCount = useMemo(
    () =>
      (novel?.chapters ?? []).filter(
        (item) => item.status === 'draft' && item.contentStatus !== 'unloaded' && !item.content.trim(),
      ).length,
    [novel?.chapters],
  );

  async function handleCleanEmptyDrafts() {
    if (emptyDraftCount === 0) {
      return;
    }
    const confirmed = await confirmAppAction(
      '清理空草稿',
      `将删除 ${emptyDraftCount} 个无正文内容的草稿章节（生成失败 / 中断残留）。确定吗？`,
      { confirmLabel: '清理' },
    );
    if (!confirmed) {
      return;
    }
    const emptyDrafts = (
      useTavernStore
        .getState()
        .novels.find((item) => item.id === novelId)?.chapters ?? []
    ).filter((item) => item.status === 'draft' && item.contentStatus !== 'unloaded' && !item.content.trim());
    for (const draft of emptyDrafts) {
      deleteNovelChapter(novelId, draft.id);
    }
    showAppAlert('清理完成', `已删除 ${emptyDrafts.length} 个空草稿。`);
  }

  if (!novel) {
    return <NovelAvailabilityState />;
  }

  async function handleGenerate(userInstruction?: string) {
    if (isGenerating) {
      return;
    }
    setShowInstructionInput(false);
    const existingDraft = chapters.find((chapter) => chapter.status === 'draft' && chapter.content.trim());
    if (existingDraft) {
      setEditingChapterId(existingDraft.id);
      void hydrateNovelChapterContent(existingDraft.id).catch((error) => {
        showAppAlert('正文加载失败', error instanceof Error ? error.message : '请稍后重试。');
      });
      return;
    }
    try {
      // 智能续写：复用状态分析 + 已选路线的上下文（未选路线则直接用分析结果）。
      const activePlan = (novel?.novelContinuationPlans ?? []).find(
        (item) => item.status === 'active',
      );
      const chapterId = await rewriteNovelNextChapter(novelId, {
        planId: activePlan?.planId,
        userInstruction: userInstruction?.trim() || undefined,
      });
      if (chapterId) {
        setEditingChapterId(chapterId);
        setTab('chapters');
      }
    } catch (error) {
      showAppAlert('写作失败', error instanceof Error ? error.message : '生成失败，请稍后重试。');
    }
  }

  async function recoverWritingJob(jobId: string, retry = false) {
    try {
      const id = await (retry ? retryNovelGenerationJob : resumeNovelGenerationJob)(novelId, jobId);
      if (id) setEditingChapterId(id);
    } catch (error) {
      showAppAlert('恢复任务失败', error instanceof Error ? error.message : '草稿已保留，请稍后重试。');
    }
  }
  async function handleGenerateOutline() {
    if (isOutlineGenerating) {
      return;
    }
    try {
      await generateNovelOutline(novelId);
      setTab('outline');
      showAppAlert('大纲已生成', '可在「大纲」面板查看与编辑。');
    } catch (error) {
      showAppAlert('大纲生成失败', error instanceof Error ? error.message : '生成失败。');
    }
  }

  async function handleExportBook() {
    if (!novel) return;
    try {
      const finalChapterIds = chapters
        .filter((item) => item.status === 'final')
        .map((item) => item.id);
      await Promise.all(finalChapterIds.map((chapterId) => hydrateNovelChapterContent(chapterId)));
      const latestNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
      const finalChapters = (latestNovel?.chapters ?? chapters)
        .filter((item) => item.status === 'final')
        .sort((a, b) => a.index - b.index);

      if (finalChapters.length === 0) {
        showAppAlert('没有可导出的内容', '请先定稿至少一章，再导出全书正文。');
        return;
      }

      const exportSettings = useTavernStore.getState().exportSettings;
      const messages: Message[] = finalChapters.map((item, index) => ({
        id: `export-${novelId}-${index}`,
        characterId: novelId,
        role: 'assistant',
        content: `第${item.index}章 ${item.title}\n\n${item.content}`,
        status: 'complete',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
      const result = await exportAssistantTranscript({
        title: novel.name,
        messages,
        directoryUri: exportSettings.directoryUri,
        format: exportSettings.format,
        includeTimestamp: false,
      });
      showAppAlert('导出成功', `已导出 ${finalChapters.length} 章为 ${result.fileName}。`);
    } catch (error) {
      showAppAlert('导出失败', error instanceof Error ? error.message : '导出失败。');
    }
  }

  async function handleFileAction(action: 'export' | 'backup') {
    if (fileAction) return;
    setFileAction(action);
    try {
      if (action === 'export') {
        await handleExportBook();
      } else {
        const state = useTavernStore.getState();
        const bundle = await state.buildNovelBackup(novelId);
        const result = await exportChatSessionBundle(bundle, state.exportSettings.directoryUri);
        showAppAlert('备份已导出', `已保存为 ${result.fileName}，可从作品库恢复。`);
      }
    } catch (error) {
      showAppAlert('备份失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setFileAction(null);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {desktop ? <View style={[styles.header, desktop && styles.desktopHeader, { borderBottomColor: theme.border }]}>
        <View style={styles.headerText}>
          <ThemedText type={desktop ? 'subtitle' : 'smallBold'} numberOfLines={1}>
            {desktop ? tabTitle : novel.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            定稿 {finalCount} / 共 {chapters.length} 章 · {totalChars} 字
          </ThemedText>
        </View>
      </View> : <NovelMobileNavigation novelId={novelId} title={tabTitle} />}

      <ScrollView
        style={styles.body}
        key={tab}
        contentContainerStyle={[styles.bodyContent, desktop ? styles.desktopBodyContent : mobileStyles.content]}
        keyboardShouldPersistTaps="handled">
        {!desktop && tab === 'tools' ? <View style={{ gap: 28 }}>
          <View style={{ gap: 16 }}>
            <MobileSectionTitle title="创作任务" />
            {jobs.length === 0 ? <MobileEmptyState title="暂时没有任务" description="开始写作或正文分析后，可以在这里查看进度。" /> : [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20).map(job => <View key={job.jobId} style={{ paddingVertical: 16, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.outlineVariant }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <ThemedText type="smallBold" style={{ flex: 1 }}>{({ write: '章节写作', analyze: '正文分析', forecast: '路线推演', outline: '大纲生成', extract: '知识提取', 'extract-style': '文风提取', enrich: '资料完善', batch: '历史批量任务' })[job.kind]}{job.chapterIndex ? ` · 第 ${job.chapterIndex} 章` : ''}</ThemedText>
                <ThemedText type="small" themeColor={job.status === 'failed' ? 'error' : 'primary'}>{({ queued: '等待中', running: '进行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消' })[job.status]}</ThemedText>
              </View>
              {job.currentStep ? <ThemedText type="small" themeColor="textSecondary">{job.currentStep}</ThemedText> : null}
              {job.status === 'running' ? <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(job.progress * 100) }} style={{ height: 4, borderRadius: 2, backgroundColor: theme.surfaceVariant }}><View style={{ height: 4, borderRadius: 2, width: `${Math.max(0, Math.min(1, job.progress)) * 100}%`, backgroundColor: theme.primary }} /></View> : null}
              {job.lastError ? <ThemedText type="small" themeColor="error">{job.lastError}</ThemedText> : null}
              <ThemedText type="small" themeColor="textMuted">{new Date(job.updatedAt).toLocaleString('zh-CN')}</ThemedText>
              {job.kind === 'write' && (job.status === 'paused' || job.status === 'failed') ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <MobileAction label={job.status === 'paused' ? '继续任务' : '重试任务'} disabled={isGenerating} onPress={() => void recoverWritingJob(job.jobId, job.status === 'failed')} />
                <MobileAction label="放弃任务" variant="text" onPress={() => abandonNovelGenerationJob(novelId, job.jobId)} />
              </View> : null}
            </View>)}
          </View>
          <View style={{ gap: 12 }}>
            <MobileSectionTitle title="导出与备份" />
            <ThemedText type="small" themeColor="textSecondary">正文导出包含 {finalCount} 章定稿；作品档案同时保留设定、草稿与知识资料。</ThemedText>
            <MobileAction label="导出全书正文" busy={fileAction === 'export'} disabled={!!fileAction || !finalCount} onPress={() => void handleFileAction('export')} />
            <MobileAction label="备份作品档案" variant="secondary" busy={fileAction === 'backup'} disabled={!!fileAction} onPress={() => void handleFileAction('backup')} />
          </View>
          <View style={{ gap: 8 }}>
            <MobileSectionTitle title="写作工具" />
            <MobileAction label="路线推演 →" variant="secondary" onPress={() => setTab('forecast')} />
            <MobileAction label="全书一致性检查 →" variant="secondary" onPress={() => setTab('consistency')} />
            <MobileAction label="写作参数 →" variant="secondary" onPress={() => setTab('settings')} />
          </View>
        </View> : null}
        {tab === 'chapters' || (desktop && tab === 'tools') ? (
          <View style={[styles.stack, splitPanels && styles.desktopPanels]}>
            <View style={[styles.stack, splitPanels && styles.desktopSupport]}>
            {recoverableWriteJob ? (
              <WorkbenchPanel
                title="章节生成待恢复"
                subtitle={recoverableWriteJob.lastError || `第 ${recoverableWriteJob.chapterIndex ?? '?'} 章 · 已生成的正文保留在草稿中`}>
                <View style={[styles.headerActions, { flexWrap: 'wrap' }]}>
                  <Pressable
                    onPress={() => void recoverWritingJob(recoverableWriteJob.jobId)}
                    style={[styles.primaryButton, { backgroundColor: theme.primary }]}>
                    <ThemedText type="small" style={{ color: theme.onPrimary }}>继续任务</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => abandonNovelGenerationJob(novelId, recoverableWriteJob.jobId)}
                    style={[styles.ghostButton, { borderColor: theme.border }]}>
                    <ThemedText type="small">放弃任务</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => void recoverWritingJob(recoverableWriteJob.jobId, true)}
                    style={[styles.ghostButton, { borderColor: theme.border }]}>
                    <ThemedText type="small">重试空白章节</ThemedText>
                  </Pressable>
                </View>
              </WorkbenchPanel>
            ) : null}
            <WorkbenchPanel
              title="生成成本与质量指标"
              subtitle={`累计 ${totalGenerationTokens} tokens · 章节平均 ${averageGenerationTokens} tokens · 平均耗时 ${(averageGenerationMs / 1000).toFixed(1)} 秒 · 已记录 ${completedWriteJobs.length} 章`}>
              <ThemedText type="small" themeColor="textMuted">
                每次任务同时记录 Context Pack 占用、重试次数、模型、耗时和分段 checkpoint。
              </ThemedText>
            </WorkbenchPanel>
            {!desktop && (novel.novelStoryAnalysis ? (
              <WorkbenchPanel
                title="章节创作"
                subtitle={`已分析 ${novel.novelStoryAnalysis.lastAnalyzedChapter} 章，写作将结合角色状态、正史和伏笔；已选路线则按路线推进。`}>
                <ThemedText type="small" themeColor="textMuted">
                  草稿生成后先进入章节弹窗，可「8 维审查」「AI 修订」，满意后再「采纳定稿」。
                </ThemedText>
              </WorkbenchPanel>
            ) : (
              <WorkbenchPanel
                title="章节创作"
                subtitle="可直接写第一章；已有正文时，可以分析角色状态、正史和伏笔，辅助后续写作。">
                <Pressable
                  onPress={() => setTab('analysis')}
                  style={[styles.ghostButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}>
                  <ThemedText type="small" themeColor="textMuted">
                    → 去状态分析
                  </ThemedText>
                </Pressable>
              </WorkbenchPanel>
            ))}
            {desktop && <WorkbenchPanel title="正文分析" subtitle="提取已有正文中的人物状态、正史和伏笔，并同步知识库。">
              <Pressable accessibilityRole="button" onPress={() => setTab('analysis')} style={[styles.ghostButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}>
                <ThemedText type="small">分析已有正文</ThemedText>
              </Pressable>
            </WorkbenchPanel>}
            {!desktop && <WorkbenchPanel
              title="灵感对话"
              subtitle="自动带入世界观与当前章节上下文，连续对话结果可直接并入本章写作引导。">
              <Pressable
                onPress={() => setShowSceneInspiration(true)}
                disabled={isGenerating}
                style={[
                  styles.ghostButton,
                  { borderColor: theme.accent, alignSelf: 'flex-start' },
                  isGenerating && { opacity: 0.5 },
                ]}>
                <ThemedText type="smallBold" themeColor="accent">
                  ✨ 打开灵感对话
                </ThemedText>
              </Pressable>
            </WorkbenchPanel>}
            </View>
            <View style={[styles.stack, splitPanels && styles.desktopChapters]}>
            <ChaptersPanel
              chapters={chapters}
              finalCount={finalCount}
              isGenerating={isGenerating}
              draftCount={draftChapters.length}
              emptyDraftCount={emptyDraftCount}
              onCleanEmptyDrafts={() => void handleCleanEmptyDrafts()}
              onOpenChapter={(chapterId) => {
                setEditingChapterId(chapterId);
                void hydrateNovelChapterContent(chapterId).catch((error) => {
                  showAppAlert('正文加载失败', error instanceof Error ? error.message : '请稍后重试。');
                });
              }}
              onGenerate={() => {
                setInstruction('');
                setShowInstructionInput(true);
              }}
              onGenerateWithInstruction={(text) => void handleGenerate(text)}
              novel={novel}
              onExport={() => void handleExportBook()}
            />
            </View>
          </View>
        ) : null}
        {tab === 'analysis' ? (
          <WorkbenchPanel
            title="状态分析"
            subtitle="增量分析全书：世界规则 / 人物 / 伏笔 / 时间线 / 文风，支持中断后继续。结果会自动同步到知识库。">
            <AnalysisStep novelId={novelId} onDone={() => {}} autoStart={autoAnalyze} nextLabel={null} />
          </WorkbenchPanel>
        ) : null}
        {tab === 'forecast' ? (
          <View style={styles.stack}>
            <WorkbenchPanel
              title="路线推演"
              subtitle="可选：先填写写作引导（剧情走向 / 篇幅 / 必须保留 / 禁止发生），AI 会据此推演 3 条互相独立的候选路线；不填则基于正史自动推演。">
              <Pressable
                onPress={() => setShowGuide((current) => !current)}
                style={[styles.ghostButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}>
                <ThemedText type="small" themeColor="textMuted">
                  {showGuide ? '收起写作引导 ▲' : '🖊️ 可选：写作引导 ▼'}
                </ThemedText>
              </Pressable>
              {showGuide ? (
                <GuideStep
                  guide={guide}
                  onChange={setGuide}
                  onNext={() => {}}
                  showNextButton={false}
                />
              ) : null}
              <ForecastStep
                novelId={novelId}
                divergenceChapter={Math.max(1, finalCount)}
                guide={guide}
                onForecastCreated={() => {
                  // 推演完成：留在本 tab 查看路线卡片，选择后再去「章节」页续写或生成大纲。
                }}
                onOutlineGenerated={(ready) => {
                  if (ready) {
                    router.push(`/novel/world-outline/${novelId}`);
                    showAppAlert('大纲已生成', '已依据所选路线追加为大纲新卷，可在「大纲」面板查看。');
                  }
                }}
              />
            </WorkbenchPanel>
          </View>
        ) : null}
        {tab === 'outline' ? (
          <OutlinePanel
            novelId={novelId}
            onGenerate={() => void handleGenerateOutline()}
            isGenerating={isOutlineGenerating}
          />
        ) : null}
        {tab === 'knowledge' ? <KnowledgePanel novelId={novelId} /> : null}
        {tab === 'context' ? <NovelContextPanel key={novelId} novelId={novelId} /> : null}
        {tab === 'consistency' ? <ConsistencyPanel novelId={novelId} /> : null}
        {tab === 'settings' ? (
          <SettingsPanel
            novelId={novelId}
            settings={novel.continuationSettings}
          />
        ) : null}
      </ScrollView>

      <NovelChapterEditorModal
        visible={Boolean(editingChapter)}
        novelId={novelId}
        chapter={editingChapter}
        onClose={() => setEditingChapterId(null)}
      />

      {showSceneInspiration ? (
        <NovelSceneInspirationModal
          visible={showSceneInspiration}
          novel={novel}
          onClose={() => setShowSceneInspiration(false)}
          onUse={(nextInstruction) => {
            setInstruction(nextInstruction);
            setShowSceneInspiration(false);
            requestAnimationFrame(() => setShowInstructionInput(true));
          }}
        />
      ) : null}

      <InstructionModal
        visible={showInstructionInput}
        value={instruction}
        onChange={setInstruction}
        onCancel={() => setShowInstructionInput(false)}
        onConfirm={(text) => handleGenerate(text)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapters panel
// ─────────────────────────────────────────────────────────────────────────────

function ChaptersPanel({
  novel,
  chapters,
  finalCount,
  isGenerating,
  draftCount,
  emptyDraftCount,
  onOpenChapter,
  onGenerate,
  onGenerateWithInstruction,
  onExport,
  onCleanEmptyDrafts,
}: {
  novel: Novel;
  chapters: NovelChapter[];
  finalCount: number;
  isGenerating: boolean;
  draftCount: number;
  emptyDraftCount: number;
  onOpenChapter: (chapterId: string) => void;
  onGenerate: () => void;
  onGenerateWithInstruction: (text: string) => void;
  onExport: () => void;
  onCleanEmptyDrafts: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      <WorkbenchPanel
        title="章节列表"
        subtitle={chapters.length === 0 ? '在工作台写第一章，或导入已有正文。' : `${finalCount} 定稿 · ${draftCount} 草稿`}
        action={
          <View style={styles.headerActions}>
            {emptyDraftCount > 0 ? (
              <Pressable
                onPress={onCleanEmptyDrafts}
                disabled={isGenerating}
                style={[styles.ghostButton, { borderColor: theme.border }, isGenerating && { opacity: 0.5 }]}>
                <ThemedText type="small" themeColor="textMuted">
                  清理空草稿（{emptyDraftCount}）
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable onPress={onGenerate} disabled={isGenerating} style={[styles.primaryButton, { backgroundColor: theme.accent }, isGenerating && { opacity: 0.5 }]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                {isGenerating ? '生成中…' : '写下一章'}
              </ThemedText>
            </Pressable>
          </View>
        }>
        <TaskModelSelector task="writing" disabled={isGenerating} />
        {chapters.length === 0 ? <View style={styles.emptyCard}>
          <ThemedText type="small" themeColor="textMuted">每次生成的正文先保存为草稿，审查通过后再定稿。</ThemedText>
          <Pressable onPress={onGenerateWithInstruction.bind(null, '')} disabled={isGenerating} style={[styles.primaryButton, { backgroundColor: theme.accent }, isGenerating && { opacity: 0.5 }]}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{isGenerating ? '生成中…' : '写第 1 章'}</ThemedText>
          </Pressable>
          <Pressable onPress={onGenerate} disabled={isGenerating} style={[styles.ghostButton, { borderColor: theme.border }]}><ThemedText type="small" themeColor="textMuted">填写写作要求</ThemedText></Pressable>
        </View> : <View style={styles.chapterList}>
          {chapters.map((chapter) => <ChapterRow key={chapter.id} novel={novel} chapter={chapter} onPress={() => onOpenChapter(chapter.id)} />)}
        </View>}
      </WorkbenchPanel>

      <WorkbenchPanel title="导出" subtitle="将已定稿的章节导出为正文文件。">
        <Pressable onPress={onExport} disabled={isGenerating} style={[styles.ghostButton, { borderColor: theme.border }, isGenerating && { opacity: 0.5 }]}>
          <ThemedText type="small" themeColor="textMuted">📤 导出定稿正文</ThemedText>
        </Pressable>
      </WorkbenchPanel>
    </>
  );
}

function ChapterRow({ novel, chapter, onPress }: { novel: Novel; chapter: NovelChapter; onPress: () => void }) {
  const theme = useTheme();
  const auditSummary = (novel.novelRewriteAudits ?? [])
    .filter((item) => item.chapterId === chapter.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const auditCurrent = auditSummary
    ? isNovelRewriteAuditCurrent(auditSummary, chapter.id, getNovelAuditSourceFingerprint(novel, chapter))
    : false;
  const chars = chapter.content.replace(/\s/g, '').length;
  const isDraft = chapter.status === 'draft';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chapterRow,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: isDraft ? theme.accentMuted : theme.border,
        },
        pressed && { opacity: 0.7 },
      ]}>
      <View style={styles.chapterRowHeader}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.chapterTitle}>
          第{chapter.index}章 {chapter.title}
        </ThemedText>
        <View style={[styles.statusBadge, { backgroundColor: isDraft ? theme.accentMuted : theme.backgroundSelected }]}>
          <ThemedText type="small" themeColor={isDraft ? 'accent' : 'textMuted'}>
            {isDraft ? '草稿' : '定稿'}
          </ThemedText>
        </View>
      </View>
      <ThemedText type="small" themeColor="textMuted">
        {chars} 字{chapter.goal ? ` · 目标：${chapter.goal.slice(0, 30)}` : ''}
      </ThemedText>
      {auditSummary && !auditCurrent ? <ThemedText type="small" themeColor="textMuted">需重新审查</ThemedText> : null}
      {auditSummary && auditCurrent ? <ThemedText type="small" themeColor={auditSummary.passed ? undefined : 'textMuted'}>
        {auditSummary.passed ? '✅ 审查通过' : `⚠️ 待处理 ${auditSummary.issues.length} 项`}
      </ThemedText> : null}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Outline panel
// ─────────────────────────────────────────────────────────────────────────────

function OutlinePanel({
  novelId,
  onGenerate,
  isGenerating,
}: {
  novelId: string;
  onGenerate: () => void;
  isGenerating: boolean;
}) {
  const theme = useTheme();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const updateNovelContinuationSettings = useTavernStore(
    (state) => state.updateNovelContinuationSettings,
  );
  const outline = novel?.outline;
  const plannedChapters = novel?.projectBrief?.plannedChapters ?? 20;
  const wordsPerChapter = novel?.continuationSettings?.targetWords ?? 1_800;
  const totalWords = calculateNovelOutlineTotalWords(plannedChapters, wordsPerChapter);

  const updatePlannedChapters = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;
    const brief = novel?.projectBrief ?? {
      premise: '', theme: '', protagonistArc: '', ending: '', firstChapterGoal: '', plannedChapters: 20,
    };
    updateNovel(novelId, { projectBrief: { ...brief, plannedChapters: clampNovelOutlineChapterCount(parsed) } });
  };

  return (
    <WorkbenchPanel
      title="卷 / 章大纲"
      subtitle="AI 基于现有正文生成后续规划；续写会按「本章目标」驱动。"
      action={
        <Pressable
          onPress={onGenerate}
          disabled={isGenerating}
          style={[styles.ghostButton, { borderColor: theme.border }, isGenerating && { opacity: 0.5 }]}>
          <ThemedText type="small" themeColor="textMuted">
            {isGenerating ? '生成中…' : outline ? '重新生成' : '生成大纲'}
          </ThemedText>
        </Pressable>
      }>
      <TaskModelSelector task="outline" disabled={isGenerating} />
      <View style={styles.section}>
        <ThemedText type="smallBold">预计章节</ThemedText>
        <DraftTextInput
          value={String(plannedChapters)}
          onChangeText={updatePlannedChapters}
          keyboardType="number-pad"
          style={[styles.settingInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
        />
      </View>
      <View style={styles.section}>
        <ThemedText type="smallBold">每章字数</ThemedText>
        <DraftTextInput
          value={String(wordsPerChapter)}
          onChangeText={(value) => {
            const num = Number.parseInt(value, 10);
            if (Number.isFinite(num)) {
              updateNovelContinuationSettings(novelId, {
                targetWords: Math.min(NOVEL_TARGET_WORDS_RANGE[1], Math.max(NOVEL_TARGET_WORDS_RANGE[0], num)),
              });
            }
          }}
          keyboardType="number-pad"
          style={[styles.settingInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
        />
      </View>
      <View style={styles.section}>
        <ThemedText type="smallBold">总字数</ThemedText>
        <ThemedText type="small" themeColor="textMuted">{totalWords.toLocaleString()} 字（自动计算）</ThemedText>
      </View>
      {outline ? (
        <View style={styles.outlineBody}>
          <ThemedText type="small">{outline.summary || '（无全书摘要）'}</ThemedText>
          {outline.volumes.map((volume) => (
            <View key={volume.id} style={[styles.volumeCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText type="smallBold">📖 {volume.title}</ThemedText>
              {volume.summary ? (
                <ThemedText type="small" themeColor="textMuted">
                  {volume.summary}
                </ThemedText>
              ) : null}
              {volume.chapters.map((plan) => (
                <View key={`${volume.id}-${plan.index}`} style={styles.goalRow}>
                  <ThemedText type="small">
                    第{plan.index}章 {plan.title}
                  </ThemedText>
                  {plan.goal ? (
                    <ThemedText type="small" themeColor="textMuted">
                      {plan.goal}
                    </ThemedText>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textMuted">
          还没有大纲。点击「生成大纲」让 AI 根据现有正文规划后续卷章；生成后可在任意章节详情里看到对应「本章目标」。
        </ThemedText>
      )}
    </WorkbenchPanel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────────────────────────────────────────

function SettingsPanel({
  novelId,
  settings,
}: {
  novelId: string;
  settings: NovelContinuationSettings | undefined;
}) {
  const theme = useTheme();
  const updateNovelContinuationSettings = useTavernStore(
    (state) => state.updateNovelContinuationSettings,
  );
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const stats = novel?.continuationStats ?? {};

  const taskLabels: Record<string, string> = {
    'story-import': '故事资料识别',
    'rewrite-write': '智能续写',
    'rewrite-audit': '8 维审查',
    'rewrite-revise': 'AI 修订',
    outline: '大纲',
    // 新建侧任务（与 novel-create-ai 的 NOVEL_CREATE_USAGE_TASKS 对齐）。
    'create-framework': '框架生成',
    'create-cast': '角色生成',
    'create-lore': '设定生成',
    'create-supporting': '配角提取',
    // 兼容旧版本产生的记录。
    'chapter-write': '续写（旧）',
    'fact-check': '审查（旧）',
    'extract-context': '上下文提取（旧）',
    'style-extract': '文风提取（旧）',
  };
  const totalTokens = Object.values(stats).reduce((sum, usage) => sum + usage.tokens, 0);

  return (
    <>
      <WorkbenchPanel title="token / 成本统计" subtitle="按任务汇总，实时反映各模型的消耗。">
        <View style={styles.section}>
          {Object.keys(stats).length === 0 ? (
            <ThemedText type="small" themeColor="textMuted">
              尚无记录，完成一次续写 / 审查 / 大纲生成后即可看到统计。
            </ThemedText>
          ) : (
            <>
              <View style={styles.statRow}>
                <ThemedText type="smallBold">累计</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {Math.round(totalTokens / 1000)}k
                </ThemedText>
              </View>
              {Object.entries(stats).map(([task, usage]) => (
                <View key={task} style={styles.statRow}>
                  <ThemedText type="small">{taskLabels[task] ?? task}</ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    {usage.calls} 次 · {(usage.tokens / 1000).toFixed(1)}k
                  </ThemedText>
                </View>
              ))}
            </>
          )}
        </View>
      </WorkbenchPanel>

      <WorkbenchPanel title="写作要求" subtitle="从资料中识别的写作要求保存在这里，也可直接修改；修改后自动保存。">
        <DraftTextInput
          accessibilityLabel="本作品的写作要求"
          value={novel?.writingStyle ?? ''}
          onChangeText={(writingStyle) => useTavernStore.getState().updateNovel(novelId, { writingStyle })}
          multiline textAlignVertical="top"
          placeholder="叙事视角、语言风格、人物认知边界、章节输出要求……"
          placeholderTextColor={theme.textMuted}
          style={[styles.settingInput, { minHeight: 220, backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
        />
      </WorkbenchPanel>

      <WorkbenchPanel title="写作设置" subtitle="上下文回溯与篇幅。">
        <View style={styles.section}>
          <ThemedText type="smallBold">回溯章节数（0 = 全部前文）</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            续写时注入最近 N 章正文作为上下文。章节越多越一致，但成本越高。
          </ThemedText>
          <DraftTextInput
            value={String(settings?.lookbackChapters ?? 3)}
            onChangeText={(value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isFinite(num)) {
                updateNovelContinuationSettings(novelId, { lookbackChapters: Math.min(20, Math.max(0, num)) });
              }
            }}
            keyboardType="number-pad"
            style={[styles.settingInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
          />
        </View>

        <View style={styles.section}>
          <ThemedText type="smallBold">目标字数（每章）</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            超过 2500 字会自动拆分为多段顺序续写（每段衔接已写内容），完成后合并为一章草稿；最多 {NOVEL_TARGET_WORDS_RANGE[1]} 字。
          </ThemedText>
          <DraftTextInput
            value={String(settings?.targetWords ?? 1800)}
            onChangeText={(value) => {
              const num = Number.parseInt(value, 10);
              if (Number.isFinite(num)) {
                updateNovelContinuationSettings(novelId, {
                  targetWords: Math.min(NOVEL_TARGET_WORDS_RANGE[1], Math.max(NOVEL_TARGET_WORDS_RANGE[0], num)),
                });
              }
            }}
            keyboardType="number-pad"
            style={[styles.settingInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
          />
        </View>
      </WorkbenchPanel>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction modal
// ─────────────────────────────────────────────────────────────────────────────

function InstructionModal({
  visible,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}) {
  const theme = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent>
      <View style={[styles.modalOverlay, { backgroundColor: theme.scrim }]}>
        <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="smallBold">本章写作要求（可选）</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            描述你希望下一章推进什么（例如「让主角发现玉佩的来历」）。
          </ThemedText>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="留空则按大纲与上下文自由续写"
            placeholderTextColor={theme.textMuted}
            multiline
            style={[
              styles.instructionInput,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
            ]}
          />
          <View style={styles.modalActions}>
            <Pressable onPress={onCancel} style={[styles.ghostButton, { borderColor: theme.border, flex: 1 }]}>
              <ThemedText type="small" themeColor="textMuted">
                取消
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(value)}
              style={[styles.primaryButton, { backgroundColor: theme.accent, flex: 1 }]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                开始写作
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  desktopHeader: { paddingHorizontal: 32, paddingVertical: 24 },
  desktopBodyContent: { padding: 32, width: '100%', maxWidth: 1440, alignSelf: 'center' },
  desktopPanels: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  desktopSupport: { width: 272, flexShrink: 0 },
  desktopChapters: { flex: 1, minWidth: 0 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    padding: 8,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  tabBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBarContent: {
    paddingHorizontal: Spacing.two,
  },
  tabItem: {
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  stack: {
    gap: Spacing.three,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: Spacing.three,
    gap: Spacing.three,
    paddingBottom: 48,
  },
  primaryButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  ghostButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    gap: Spacing.two,
  },
  chapterList: {
    gap: Spacing.two,
  },
  chapterRow: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
  chapterRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chapterTitle: {
    flex: 1,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  outlineBody: {
    gap: Spacing.two,
  },
  volumeCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
  goalRow: {
    gap: 2,
    paddingLeft: Spacing.two,
  },
  section: {
    gap: Spacing.two,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  instructionInput: {
    minHeight: 96,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
