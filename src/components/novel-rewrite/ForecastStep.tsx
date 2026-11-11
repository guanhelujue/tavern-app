import { TaskModelSelector } from '@/components/TaskModelSelector';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import type { UserGuide } from '@/components/novel-rewrite/NovelRewriteScreen';
import type { NovelForecast, NovelForecastRoute } from '@/types/tavern';
import { showAppAlert } from '@/utils/app-alert';

export function ForecastStep({
  novelId,
  divergenceChapter,
  guide,
  onForecastCreated,
  onOutlineGenerated,
}: {
  novelId: string;
  divergenceChapter: number;
  guide: UserGuide;
  onForecastCreated: (forecastId: string) => void;
  onOutlineGenerated?: (outlineReady: boolean) => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 600;
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const createNovelForecast = useTavernStore((state) => state.createNovelForecast);
  const selectNovelForecastRoute = useTavernStore((state) => state.selectNovelForecastRoute);
  const generateNovelOutlineForPlan = useTavernStore((state) => state.generateNovelOutlineForPlan);

  const [message, setMessage] = useState('');

  const forecasts = novel?.novelForecasts ?? [];
  const plans = novel?.novelContinuationPlans ?? [];
  const latestActive = forecasts.find((item) => item.status === 'active');
  const staleForecasts = forecasts.filter((item) => item.status === 'stale');
  const selectedPlan = plans.find((item) => item.status === 'active') ?? null;

  // 后台运行状态以 store 中的任务记录为准：切页后组件重挂载也能恢复真实状态。
  const forecastJob =
    (novel?.novelGenerationJobs ?? []).find((job) => job.kind === 'forecast') ?? null;
  const running = forecastJob?.status === 'running';
  const jobMessage = running ? (forecastJob?.currentStep ?? '') : '';

  const outlineJob =
    (novel?.novelGenerationJobs ?? []).find((job) => job.kind === 'outline') ?? null;
  const outlining = outlineJob?.status === 'running';

  // 推演输入是否与最近一次一致（用于展示 stale 提示）。
  const latest = latestActive;
  const guideChanged =
    !!latest &&
    (latest.userGuide.endingPreference !== guide.endingPreference ||
      latest.userGuide.mustKeep !== guide.mustKeep ||
      latest.userGuide.mustAvoid !== guide.mustAvoid ||
      latest.divergenceChapter !== divergenceChapter);

  async function handleForecast() {
    if (running) {
      return;
    }
    setMessage('');
    try {
      const forecastId = await createNovelForecast(novelId, {
        mode: 'continue',
        divergenceChapter,
        userGuide: guide,
        onProgress: (text) => setMessage(text),
      });
      if (forecastId) {
        onForecastCreated(forecastId);
      }
    } catch (error) {
      const errText = error instanceof Error ? error.message : '推演失败，请重试。';
      if (errText.includes('正在执行其他状态任务')) {
        return;
      }
      showAppAlert('路线推演失败', errText);
    }
  }

  function handleSelect(forecast: NovelForecast, route: NovelForecastRoute) {
    selectNovelForecastRoute(novelId, forecast.forecastId, route.routeId);
    showAppAlert('已选择路线', `《${route.title}》\n\n该路线尚未写入正文，可在生成页开始续写。`);
    onForecastCreated(forecast.forecastId);
  }

  async function handleGenerateOutline() {
    if (outlining || !selectedPlan) {
      return;
    }
    setMessage('');
    try {
      await generateNovelOutlineForPlan(novelId, selectedPlan.planId);
      onOutlineGenerated?.(true);
    } catch (error) {
      showAppAlert(
        '生成大纲失败',
        error instanceof Error ? error.message : '依据路线生成大纲失败，请重试。',
      );
    }
  }

  return (
    <View style={styles.stack}>
      <ThemedText type="subtitle" style={styles.welcome}>
        路线推演
      </ThemedText>
      <ThemedText themeColor="textMuted">
        基于当前正史与你的要求，推演 3 条互相独立、非正史的候选路线。选中的路线只生成写作计划，不会改动正文。
      </ThemedText>

      <TaskModelSelector task="outline" disabled={running || outlining} />

      {guideChanged ? (
        <View style={[styles.staleBanner, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
          <ThemedText type="small" themeColor="textMuted">
            你的指导或分歧点已改变，建议重新推演以获得更贴合的结果。
          </ThemedText>
        </View>
      ) : null}
      {staleForecasts.length > 0 ? (
        <View style={[styles.staleBanner, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
          <ThemedText type="small" themeColor="textMuted">
            部分旧路线因正史变化已失效（标记为 stale），请重新推演。
          </ThemedText>
        </View>
      ) : null}

      {!latestActive || guideChanged ? (
        <Pressable
          onPress={handleForecast}
          disabled={running}
          style={[
            styles.primaryButton,
            { backgroundColor: theme.accent, opacity: running ? 0.6 : 1 },
          ]}
          accessibilityRole="button">
          <ThemedText type="smallBold" style={styles.primaryButtonText}>
            {running ? '推演中…' : '推演 3 条候选路线'}
          </ThemedText>
        </Pressable>
      ) : null}

      {running || message ? (
        <ThemedText type="small" themeColor="textMuted">
          {jobMessage || message}
        </ThemedText>
      ) : null}

      {latestActive ? (
        <View style={styles.stack}>
          {latestActive.routes.map((route) => {
            const isSelected = selectedPlan?.forecastId === latestActive.forecastId && selectedPlan?.routeId === route.routeId;
            return (
              <Pressable
                key={route.routeId}
                onPress={() => handleSelect(latestActive, route)}
                style={[
                  [styles.routeCard, mobile && styles.mobileRouteCard],
                  {
                    backgroundColor: theme.surface,
                    borderColor: isSelected ? theme.accent : theme.border,
                  },
                ]}>
                <View style={styles.routeHeader}>
                  <ThemedText type="smallBold" style={styles.routeTitle}>
                    {route.title}
                  </ThemedText>
                  <View
                    style={[
                      styles.scoreBadge,
                      { backgroundColor: isSelected ? theme.accent : theme.border },
                    ]}>
                    <ThemedText type="small" style={{ color: isSelected ? theme.onPrimary : undefined }}>
                      {route.intentScore} 分
                    </ThemedText>
                  </View>
                </View>
                <ThemedText type="small" themeColor="textMuted">
                  前提：{route.premise}
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted" numberOfLines={2}>
                  节拍：{route.beats.map((beat) => `第${beat.chapter}拍 ${beat.summary}`).join('；')}
                </ThemedText>
                {route.hookAdvance.length > 0 ? (
                  <ThemedText type="small" themeColor="textMuted">
                    推进/回收伏笔：{route.hookAdvance.join('、')}
                  </ThemedText>
                ) : null}
                {route.risks.length > 0 ? (
                  <ThemedText type="small" themeColor="textMuted" numberOfLines={2}>
                    风险：{route.risks.map((risk) => `[${risk.kind}] ${risk.description}`).join('；')}
                  </ThemedText>
                ) : null}
                {route.endingNote ? (
                  <ThemedText type="small" themeColor="textMuted" numberOfLines={3}>
                    结局收束：{route.endingNote}
                  </ThemedText>
                ) : null}
                {isSelected ? (
                  <View style={styles.selectedBlock}>
                    <ThemedText type="smallBold" themeColor="accent">
                      ✓ 已选择（可在「章节」页开始续写）
                    </ThemedText>
                    <Pressable
                      onPress={handleGenerateOutline}
                      disabled={outlining}
                      style={[
                        styles.ghostButton,
                        { borderColor: theme.accent },
                        outlining && { opacity: 0.5 },
                      ]}
                      accessibilityRole="button">
                      <ThemedText type="small" themeColor="accent">
                        {outlining ? '生成中…' : '📋 依据此路线生成大纲'}
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="accent">
                    选择此路线 →
                  </ThemedText>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : null}
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
  staleBanner: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
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
  routeCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  mobileRouteCard: { borderRadius: 12, padding: 16 },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  routeTitle: {
    fontSize: 16,
    flex: 1,
  },
  scoreBadge: {
    borderRadius: 10,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  selectedBlock: {
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  ghostButton: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: 8,
  },
});
