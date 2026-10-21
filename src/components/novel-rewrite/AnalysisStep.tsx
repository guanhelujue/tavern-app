import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import type { NovelStoryAnalysis } from '@/types/tavern';
import { showAppAlert } from '@/utils/app-alert';

export function AnalysisStep({
  novelId,
  onDone,
  autoStart = false,
  nextLabel,
}: {
  novelId: string;
  onDone: (paused: boolean) => void;
  autoStart?: boolean;
  nextLabel?: string | null;
}) {
  const theme = useTheme();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const analyzeNovelStoryState = useTavernStore((state) => state.analyzeNovelStoryState);

  const [progressText, setProgressText] = useState('');
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const analysis = novel?.novelStoryAnalysis ?? null;
  const finalCount = (novel?.chapters ?? []).filter((item) => item.status === 'final').length;
  const manifest = analysis?.manifest;

  const status = manifest?.status ?? 'idle';
  const manifestProgress = manifest?.progress ?? 0;
  const lastError = manifest?.lastError;
  const analyzed = analysis?.lastAnalyzedChapter ?? 0;

  // 后台运行状态以 store 中的任务记录为准：切页 / 切出本小说后组件重挂载，
  // 也能从 novelGenerationJobs 恢复真实运行状态，避免「点不了 / 误报失败」。
  const analyzeJob =
    (novel?.novelGenerationJobs ?? []).find((job) => job.kind === 'analyze') ?? null;
  const running = analyzeJob?.status === 'running';
  const jobError = analyzeJob?.status === 'failed' ? analyzeJob.lastError : undefined;

  const progress = running ? (analyzeJob?.progress ?? 0) : manifestProgress;
  const currentStepText = running ? (analyzeJob?.currentStep ?? '') : progressText;
  const effectiveError = jobError ?? lastError;

  const isComplete = status === 'complete' && analyzed >= finalCount;

  useEffect(() => {
    if (status === 'complete' && analyzed >= finalCount) {
      // 自动进入下一步（除非用户正在手动操作）。
      onDoneRef.current(false);
    }
    // 仅在进入页面时判断一次，避免重复触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 续写工程创建完成后进入工作台：若指定 autoStart 且分析未完成，自动开始（替代旧「分析小说」步骤）。
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) {
      return;
    }
    autoStartedRef.current = true;
    if (finalCount === 0 || isComplete || running) {
      return;
    }
    const timer = setTimeout(() => {
      void handleAnalyze();
    }, 400);
    return () => clearTimeout(timer);
    // 只以 autoStart 为准；任务运行状态实时来自 store，无需重复触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  async function handleAnalyze() {
    if (running) {
      return;
    }
    if (finalCount === 0) {
      showAppAlert('无法分析', '小说还没有正式章节，请先在创作页导入或生成章节。');
      return;
    }
    setProgressText('');
    try {
      const result = await analyzeNovelStoryState(novelId, {
        onProgress: (_p, chapter) => setProgressText(`已分析至第 ${chapter} 章`),
        onComplete: (ran, paused) => {
          if (!ran && !paused) {
            setProgressText('章节未变化，复用已有分析结果');
          }
        },
      });
      if (result.paused) {
        onDoneRef.current(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '状态分析失败，请重试。';
      if (message.includes('正在执行其他状态任务')) {
        setProgressText('已有分析任务在后台运行，请稍候…');
        return;
      }
      showAppAlert('分析失败', message);
    }
  }

  const percentage = Math.round(progress * 100);

  return (
    <View style={styles.stack}>
      <ThemedText type="subtitle" style={styles.welcome}>
        状态分析
      </ThemedText>
      <ThemedText themeColor="textMuted">
        AI 将按章节顺序分析全书，提取世界规则、人物、伏笔、时间线与文风，用于续写路线推演。支持中断后继续。
      </ThemedText>

      <View
        style={[
          styles.statusCard,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}>
        <ThemedText type="smallBold">分析进度</ThemedText>
        <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: theme.accent, width: `${Math.max(2, percentage)}%` },
            ]}
          />
        </View>
        <ThemedText type="small" themeColor="textMuted">
          {isComplete
            ? `已完成 ${analyzed}/${finalCount} 章`
            : running
              ? `分析中 ${analyzed}/${finalCount} 章`
              : status === 'paused'
                ? `已暂停于第 ${analyzed} 章（${percentage}%）`
                : status === 'failed'
                  ? `上次分析失败于第 ${analyzed} 章`
                  : `待开始（共 ${finalCount} 章）`}
          {currentStepText ? ` · ${currentStepText}` : ''}
        </ThemedText>

        {effectiveError ? (
          <ThemedText type="small" themeColor="textMuted" style={styles.errorText}>
            失败原因：{effectiveError}
          </ThemedText>
        ) : null}

        {isComplete ? (
          <View style={styles.summaryBlock}>
            <ThemedText type="smallBold" themeColor="accent">
              分析完成，已同步到知识库。
            </ThemedText>
            <AnalysisSummary analysis={analysis} />
            {nextLabel ? (
              <Pressable
                onPress={() => onDone(false)}
                style={[styles.primaryButton, { backgroundColor: theme.accent }]}
                accessibilityRole="button">
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  {nextLabel}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Pressable
            onPress={handleAnalyze}
            disabled={running}
            style={[
              styles.primaryButton,
              { backgroundColor: theme.accent, opacity: running ? 0.6 : 1 },
            ]}
            accessibilityRole="button">
            <ThemedText type="smallBold" style={styles.primaryButtonText}>
              {running
                ? '分析中…'
                : status === 'paused'
                  ? '继续分析'
                  : status === 'failed'
                    ? '重新分析'
                    : status === 'complete'
                      ? '重新分析'
                      : '开始分析'}
            </ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function AnalysisSummary({ analysis }: { analysis: NovelStoryAnalysis | null }) {
  if (!analysis) {
    return null;
  }
  return (
    <View style={styles.summaryRow}>
      <SummaryChip label="人物" value={String(analysis.characters.length)} />
      <SummaryChip label="伏笔" value={String(analysis.hooks.filter((hook) => hook.status !== 'resolved').length)} />
      <SummaryChip label="剧情线" value={String(analysis.plotThreads.length)} />
      <SummaryChip label="事件" value={String(analysis.timeline.length)} />
    </View>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.three,
  },
  welcome: {
    fontSize: 22,
    lineHeight: 30,
  },
  statusCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  errorText: {
    color: '#c0392b',
  },
  summaryBlock: {
    gap: Spacing.three,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    alignItems: 'center',
    minWidth: 56,
  },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
  },
});
