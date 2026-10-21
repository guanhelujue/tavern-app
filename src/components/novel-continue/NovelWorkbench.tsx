import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { NovelChapterEditorModal } from '@/components/novel-continue/NovelChapterEditorModal';
import { NovelSceneInspirationModal } from '@/components/NovelSceneInspirationModal';
import { KnowledgePanel } from '@/components/novel-continue/KnowledgePanel';
import { ConsistencyPanel } from '@/components/novel-continue/ConsistencyPanel';
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
import { getFinalChapters } from '@/services/novel-continuation-pipeline';
import { useTavernStore } from '@/store/tavern-store';
import type { Message, NovelChapter, NovelContinuationSettings } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { exportAssistantTranscript } from '@/utils/chat-session-io';
import {
  calculateNovelOutlineTotalWords,
  clampNovelOutlineChapterCount,
} from '@/utils/novel-outline-options';

export type WorkbenchTab = 'chapters' | 'analysis' | 'forecast' | 'outline' | 'knowledge' | 'consistency' | 'settings';

const TABS: { key: WorkbenchTab; label: string }[] = [
  { key: 'chapters', label: '章节' },
  { key: 'analysis', label: '分析' },
  { key: 'forecast', label: '路线' },
  { key: 'outline', label: '大纲' },
  { key: 'knowledge', label: '知识库' },
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
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const [tab, setTab] = useState<WorkbenchTab>(initialTab);
  const [guide, setGuide] = useState<UserGuide>(EMPTY_GUIDE);
  const [showGuide, setShowGuide] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [showInstructionInput, setShowInstructionInput] = useState(false);
  const [showSceneInspiration, setShowSceneInspiration] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [batchCount, setBatchCount] = useState('1');
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  // 长任务运行状态以 store 中的任务记录为准：切页 / 切出本小说后组件重挂载也能恢复真实状态。
  const jobs = novel?.novelGenerationJobs ?? [];
  const isGenerating = jobs.some((job) => job.kind === 'write' && job.status === 'running');
  const batchJob = jobs.find((job) => job.kind === 'batch' && (job.status === 'running' || job.status === 'paused'));
  const isBatchGenerating = batchJob?.status === 'running';
  const isBatchPaused = batchJob?.status === 'paused';
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
  const batchGenerateNovelChapters = useTavernStore((state) => state.batchGenerateNovelChapters);
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
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ThemedText themeColor="textMuted">小说不存在。</ThemedText>
      </View>
    );
  }

  async function handleGenerate(userInstruction?: string) {
    if (isGenerating) {
      return;
    }
    setShowInstructionInput(false);
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
      showAppAlert('续写失败', error instanceof Error ? error.message : '生成失败，请稍后重试。');
    }
  }

  async function handleBatch() {
    const count = Math.max(1, Math.min(20, Number.parseInt(batchCount, 10) || 1));
    setBatchProgress({ done: 0, total: count });
    try {
      const result = await batchGenerateNovelChapters(novelId, count, {
        onProgress: (done, total) => setBatchProgress({ done, total }),
      });
      if (result.stopped) {
        showAppAlert('批量续写已暂停', result.reason ?? '审核发现高风险，已停止后续章节。');
      } else {
        showAppAlert('批量续写完成', (novel?.continuationSettings?.autoAudit ?? true)
          ? '已生成章节并完成自动审查，可在章节列表查看。'
          : '已生成章节；自动审查已关闭，请在章节列表手动审查。');
      }
    } catch (error) {
      showAppAlert('批量续写失败', error instanceof Error ? error.message : '批量生成失败。');
    } finally {
      setBatchProgress(null);
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

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/novels');
            }
          }}
          hitSlop={10}
          style={styles.headerButton}>
          <ThemedText themeColor="textMuted">←</ThemedText>
        </Pressable>
        <View style={styles.headerText}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {novel.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            定稿 {finalCount} / 共 {chapters.length} 章 · {totalChars} 字
          </ThemedText>
        </View>
      </View>

      <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBarContent}>
          {TABS.map((item) => {
            const active = item.key === tab;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  if (item.key === 'outline') {
                    router.push(`/novel/world-outline/${novelId}`);
                    return;
                  }
                  setTab(item.key);
                }}
                style={[styles.tabItem, active && { borderBottomColor: theme.accent }]}>
                <ThemedText
                  type="smallBold"
                  themeColor={active ? 'accent' : 'textMuted'}>
                  {item.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled">
        {tab === 'chapters' ? (
          <View style={styles.stack}>
            {recoverableWriteJob ? (
              <WorkbenchPanel
                title="发现可恢复的续写任务"
                subtitle={`第 ${recoverableWriteJob.chapterIndex ?? '?'} 章 · 已完成 ${recoverableWriteJob.segmentIndex ?? 0}/${recoverableWriteJob.totalSegments ?? 1} 段`}>
                <View style={[styles.batchRow, { flexWrap: 'wrap' }]}>
                  <Pressable
                    onPress={() => void resumeNovelGenerationJob(novelId, recoverableWriteJob.jobId)}
                    style={[styles.primaryButton, { backgroundColor: theme.primary }]}>
                    <ThemedText type="small" style={{ color: theme.onPrimary }}>继续任务</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => abandonNovelGenerationJob(novelId, recoverableWriteJob.jobId)}
                    style={[styles.ghostButton, { borderColor: theme.border }]}>
                    <ThemedText type="small">放弃任务</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => void retryNovelGenerationJob(novelId, recoverableWriteJob.jobId)}
                    style={[styles.ghostButton, { borderColor: theme.border }]}>
                    <ThemedText type="small">从上一章重试</ThemedText>
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
            {novel.novelStoryAnalysis ? (
              <WorkbenchPanel
                title="智能续写"
                subtitle={`已分析 ${novel.novelStoryAnalysis.lastAnalyzedChapter} 章，续写将基于状态分析（角色状态/正史/伏笔）生成；已选路线则按路线推进。`}>
                <ThemedText type="small" themeColor="textMuted">
                  草稿生成后先进入章节弹窗，可「8 维审查」「AI 修订」，满意后再「采纳定稿」。
                </ThemedText>
              </WorkbenchPanel>
            ) : (
              <WorkbenchPanel
                title="智能续写"
                subtitle="建议先做一次状态分析，续写会基于角色状态 / 正史 / 伏笔生成，质量更高，也支持多路线推演。">
                <Pressable
                  onPress={() => setTab('analysis')}
                  style={[styles.ghostButton, { borderColor: theme.border, alignSelf: 'flex-start' }]}>
                  <ThemedText type="small" themeColor="textMuted">
                    → 去状态分析
                  </ThemedText>
                </Pressable>
              </WorkbenchPanel>
            )}
            <WorkbenchPanel
              title="灵感对话"
              subtitle="自动带入世界观，每次只发送当前提示词；历史问答不占用下一次请求的 token。">
              <Pressable
                onPress={() => setShowSceneInspiration(true)}
                disabled={isGenerating || isBatchGenerating}
                style={[
                  styles.ghostButton,
                  { borderColor: theme.accent, alignSelf: 'flex-start' },
                  (isGenerating || isBatchGenerating) && { opacity: 0.5 },
                ]}>
                <ThemedText type="smallBold" themeColor="accent">
                  ✨ 打开灵感对话
                </ThemedText>
              </Pressable>
            </WorkbenchPanel>
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
              isBatchGenerating={isBatchGenerating}
              isBatchPaused={isBatchPaused}
              batchProgress={batchProgress}
              batchCount={batchCount}
              autoAudit={novel.continuationSettings?.autoAudit ?? true}
              onBatchCountChange={setBatchCount}
              onBatch={() => void handleBatch()}
              onExport={() => void handleExportBook()}
            />
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
  chapters,
  finalCount,
  isGenerating,
  isBatchGenerating = false,
  isBatchPaused = false,
  batchProgress = null,
  draftCount,
  emptyDraftCount,
  onOpenChapter,
  onGenerate,
  onGenerateWithInstruction,
  onBatch = () => undefined,
  onExport,
  onCleanEmptyDrafts,
  batchCount = '',
  autoAudit = false,
  onBatchCountChange = () => undefined,
}: {
  chapters: NovelChapter[];
  finalCount: number;
  isGenerating: boolean;
  isBatchGenerating?: boolean;
  isBatchPaused?: boolean;
  batchProgress?: { done: number; total: number } | null;
  draftCount: number;
  emptyDraftCount: number;
  onOpenChapter: (chapterId: string) => void;
  onGenerate: () => void;
  onGenerateWithInstruction: (text: string) => void;
  onBatch?: () => void;
  onExport: () => void;
  onCleanEmptyDrafts: () => void;
  batchCount?: string;
  autoAudit?: boolean;
  onBatchCountChange?: (value: string) => void;
}) {
  const theme = useTheme();

  if (chapters.length === 0) {
    return (
      <WorkbenchPanel title="还没有章节" subtitle="从第一笔开始，或导入已有正文后在此续写。">
        <View style={styles.emptyCard}>
          <ThemedText type="small" themeColor="textMuted">
            章节化续写：每次生成的正文先落入「草稿」，审查通过后再「采纳定稿」。
          </ThemedText>
          <Pressable
            onPress={onGenerateWithInstruction.bind(null, '')}
            disabled={isGenerating}
            style={[styles.primaryButton, { backgroundColor: theme.accent }, isGenerating && { opacity: 0.5 }]}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
              {isGenerating ? '生成中…' : '✍️ 续写第 1 章'}
            </ThemedText>
          </Pressable>
          <Pressable onPress={onGenerate} disabled={isGenerating} style={[styles.ghostButton, { borderColor: theme.border }]}>
            <ThemedText type="small" themeColor="textMuted">
              带指令续写
            </ThemedText>
          </Pressable>
        </View>
      </WorkbenchPanel>
    );
  }

  return (
    <>
      <WorkbenchPanel
        title="章节列表"
        subtitle={`${finalCount} 定稿 · ${draftCount} 草稿`}
        action={
          <View style={styles.headerActions}>
            {emptyDraftCount > 0 ? (
              <Pressable
                onPress={onCleanEmptyDrafts}
                disabled={isGenerating || isBatchGenerating}
                style={[styles.ghostButton, { borderColor: theme.border }, (isGenerating || isBatchGenerating) && { opacity: 0.5 }]}>
                <ThemedText type="small" themeColor="textMuted">
                  清理空草稿（{emptyDraftCount}）
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable onPress={onGenerate} disabled={isGenerating || isBatchGenerating} style={[styles.primaryButton, { backgroundColor: theme.accent }, (isGenerating || isBatchGenerating) && { opacity: 0.5 }]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                {isGenerating ? '生成中…' : '✍️ 续写下一章'}
              </ThemedText>
            </Pressable>
          </View>
        }>
        <View style={styles.chapterList}>
          {chapters.map((chapter) => (
            <ChapterRow
              key={chapter.id}
              chapter={chapter}
              onPress={() => onOpenChapter(chapter.id)}
            />
          ))}
        </View>
      </WorkbenchPanel>

      <WorkbenchPanel
        title="批量续写"
        subtitle={autoAudit
          ? '连续生产 N 章，每章自动审查，遇到高风险章自动停下等你处理。'
          : '连续生产 N 章；自动审查已关闭，请在章节列表手动审查。'}>
        <View style={styles.batchRow}>
          <TextInput
            value={batchCount}
            onChangeText={onBatchCountChange}
            keyboardType="number-pad"
            style={[styles.batchInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
          />
          <Pressable
            onPress={onBatch}
            disabled={isBatchGenerating || isGenerating}
            style={[styles.ghostButton, { borderColor: theme.border }, (isBatchGenerating || isGenerating) && { opacity: 0.5 }]}>
            <ThemedText type="small" themeColor="textMuted">
              {isBatchPaused
                ? '处理后重新开始'
                : isBatchGenerating
                ? batchProgress
                  ? `生成中 ${batchProgress.done}/${batchProgress.total}`
                  : '生成中…'
                : '开始批量续写'}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={onExport}
            disabled={isBatchGenerating || isGenerating}
            style={[styles.ghostButton, { borderColor: theme.border }, (isBatchGenerating || isGenerating) && { opacity: 0.5 }]}>
            <ThemedText type="small" themeColor="textMuted">
              📤 导出定稿正文
            </ThemedText>
          </Pressable>
        </View>
      </WorkbenchPanel>
    </>
  );
}

function ChapterRow({ chapter, onPress }: { chapter: NovelChapter; onPress: () => void }) {
  const theme = useTheme();
  const auditSummary = useTavernStore((state) => {
    const audits = state.novels
      .find((item) => item.chapters?.some((c) => c.id === chapter.id))
      ?.audits?.filter((item) => item.chapterId === chapter.id);
    return audits?.[0];
  });
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
      {auditSummary ? (
        <ThemedText type="small" themeColor={auditSummary.passed ? undefined : 'textMuted'}>
          {auditSummary.passed ? '✅ 审查通过' : `⚠️ 待处理 ${auditSummary.issues.length} 项`}
        </ThemedText>
      ) : null}
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

      <WorkbenchPanel title="续写设置" subtitle="上下文回溯与篇幅。">
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
          <ThemedText type="smallBold">续写指令（可选）</ThemedText>
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
                开始续写
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
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  batchInput: {
    width: 72,
    minHeight: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    fontSize: 15,
    textAlign: 'center',
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
