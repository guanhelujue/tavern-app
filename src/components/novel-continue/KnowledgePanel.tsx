import { router, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";

import { WorkbenchPanel } from "@/components/novel-continue/WorkbenchPanel";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  dedupeCharactersInAnalysis,
  detectMisalignedStoryAnalysis,
  normalizeAnalysisEntityIds,
} from "@/services/novel-story-state";
import { useTavernStore } from "@/store/tavern-store";
import type {
  NovelPlotThread,
  NovelStoryAnalysis,
  NovelTimelineEvent,
} from "@/types/tavern";

type KnowledgeSection = "plots" | "events";

const PLOT_KIND_LABEL: Record<NovelPlotThread["kind"], string> = {
  main: "主线",
  sub: "支线",
  arc: "情感弧",
};

const TIMELINE_TYPE_LABEL: Record<NovelTimelineEvent["type"], string> = {
  timeline: "事件",
  location: "地点",
  faction: "势力",
  item: "物品",
  resource: "资源",
};

/** 只读展示状态分析生成的剧情线与事件资料；正式设定统一进入各自知识页。 */
export function KnowledgePanel({ novelId }: { novelId: string }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 600;
  const novel = useTavernStore((state) =>
    state.novels.find((item) => item.id === novelId),
  );
  const [section, setSection] = useState<KnowledgeSection>("plots");
  const analysis = useMemo(() => {
    if (!novel?.novelStoryAnalysis) {
      return null;
    }
    return normalizeAnalysisEntityIds(
      dedupeCharactersInAnalysis(novel.novelStoryAnalysis),
    );
  }, [novel]);
  const finalChapterCount = (novel?.chapters ?? []).filter(
    (chapter) => chapter.status === "final",
  ).length;

  const navigate = (path: string) => router.push(path as Href);

  return (
    <WorkbenchPanel
      title="剧情资料"
      subtitle="正文分析生成的只读资料；正式设定请在统一知识页维护。"
    >
      <View
        style={[
          [styles.entryCard, mobile && styles.mobileCard],
          {
            backgroundColor: theme.backgroundSelected,
            borderColor: theme.border,
          },
        ]}
      >
        <ThemedText type="smallBold">统一设定入口</ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          人物卡、世界设定和伏笔都使用同一套正式编辑页面，修改会直接供后续写作读取。
        </ThemedText>
        <View style={styles.entryActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开人物"
            onPress={() => navigate(`/novel/knowledge/characters/${novelId}`)}
            style={[styles.entryButton, { borderColor: theme.border }]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              人物
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开知识库（世界设定）"
            onPress={() => navigate(`/novel/knowledge/lore/${novelId}`)}
            style={[styles.entryButton, { borderColor: theme.border }]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              知识库
            </ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              世界设定
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开伏笔管理"
            onPress={() => navigate(`/novel/foreshadows/${novelId}`)}
            style={[styles.entryButton, { borderColor: theme.border }]}
          >
            <ThemedText type="smallBold" themeColor="accent">
              伏笔管理
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <View
        style={[
          [styles.segmentRow, mobile && styles.mobileSegmentRow],
          { backgroundColor: theme.backgroundElement },
        ]}
      >
        {(
          [
            ["plots", "剧情"],
            ["events", "事件"],
          ] as const
        ).map(([key, label]) => {
          const active = section === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setSection(key)}
              style={[
                styles.segmentItem,
                active && {
                  backgroundColor: theme.surface,
                  borderColor: theme.accent,
                },
              ]}
            >
              <ThemedText
                type="smallBold"
                themeColor={active ? "accent" : "textMuted"}
              >
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {!analysis ? (
        <View style={styles.emptyBlock}>
          <ThemedText type="small" themeColor="textMuted">
            还没有剧情资料。可以先到“状态分析”提取正文中的剧情线和事件；人物与世界设定仍可直接从上方统一入口维护。
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开状态分析"
            onPress={() =>
              navigate(`/novel/workbench/${novelId}?focus=analysis`)
            }
          >
            <ThemedText type="smallBold" themeColor="accent">
              去状态分析 →
            </ThemedText>
          </Pressable>
        </View>
      ) : section === "plots" ? (
        <PlotSection analysis={analysis} />
      ) : (
        <EventSection analysis={analysis} totalChapters={finalChapterCount} />
      )}
    </WorkbenchPanel>
  );
}

function PlotSection({ analysis }: { analysis: NovelStoryAnalysis }) {
  const theme = useTheme();

  if (analysis.plotThreads.length === 0) {
    return <EmptyHint text="暂无剧情线记录。" />;
  }

  return (
    <View style={styles.section}>
      {analysis.plotThreads.map((thread) => (
        <View
          key={thread.id}
          style={[
            styles.listCard,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.listRowHeader}>
            <ThemedText
              type="smallBold"
              numberOfLines={1}
              style={styles.listTitle}
            >
              {thread.title}
            </ThemedText>
            <TagChip label={PLOT_KIND_LABEL[thread.kind] ?? thread.kind} />
          </View>
          <ThemedText type="small" themeColor="textMuted">
            {thread.description}
          </ThemedText>
          <View
            style={[
              styles.progressBlock,
              {
                backgroundColor: theme.backgroundSelected,
                borderColor: theme.border,
              },
            ]}
          >
            <ThemedText type="smallBold">当前进度</ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              {thread.progress || "（未推进）"}
            </ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              起于第 {thread.startChapter} 章
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

function EventSection({
  analysis,
  totalChapters,
}: {
  analysis: NovelStoryAnalysis;
  totalChapters: number;
}) {
  const theme = useTheme();
  const misaligned = useMemo(
    () => detectMisalignedStoryAnalysis(analysis, totalChapters),
    [analysis, totalChapters],
  );
  const timeline = useMemo(
    () => [...analysis.timeline].sort((a, b) => a.chapter - b.chapter),
    [analysis.timeline],
  );
  const summaries = useMemo(
    () => [...analysis.chapterSummaries].sort((a, b) => a.chapter - b.chapter),
    [analysis.chapterSummaries],
  );

  return (
    <View style={styles.section}>
      {misaligned ? (
        <View
          style={[
            styles.warningCard,
            {
              backgroundColor: theme.backgroundSelected,
              borderColor: theme.border,
            },
          ]}
        >
          <ThemedText type="smallBold" themeColor="accent">
            章节编号异常
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            检测到章节摘要编号被整体推高（例如全书 {totalChapters} 章，却记录了{" "}
            {summaries.length}{" "}
            条），会导致续写上下文引用错误的章节号。请到「分析」tab
            重新运行一次状态分析，系统会自动重置错位数据并重新生成。
          </ThemedText>
        </View>
      ) : null}

      {summaries.length > 0 ? (
        <>
          <ThemedText type="smallBold">章节摘要</ThemedText>
          {summaries.map((row) => (
            <View
              key={row.chapter}
              style={[
                styles.listCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <ThemedText type="smallBold">
                第 {row.chapter} 章 {row.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textMuted">
                {row.events}
              </ThemedText>
              {row.stateChanges ? (
                <ThemedText type="small" themeColor="textMuted">
                  章末：{row.stateChanges}
                </ThemedText>
              ) : null}
              {row.hookActivity ? (
                <ThemedText type="small" themeColor="textMuted">
                  伏笔：{row.hookActivity}
                </ThemedText>
              ) : null}
              {row.mood ? <TagChip label={`基调 ${row.mood}`} /> : null}
            </View>
          ))}
        </>
      ) : null}

      {timeline.length > 0 ? (
        <>
          <ThemedText type="smallBold">时间线（{timeline.length}）</ThemedText>
          {timeline.map((event) => (
            <View
              key={event.id}
              style={[
                styles.listCard,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}
            >
              <View style={styles.listRowHeader}>
                <ThemedText
                  type="smallBold"
                  numberOfLines={1}
                  style={styles.listTitle}
                >
                  {event.subject}
                </ThemedText>
                <View style={styles.tagGroup}>
                  <TagChip
                    label={TIMELINE_TYPE_LABEL[event.type] ?? event.type}
                  />
                  <TagChip label={`第${event.chapter}章`} />
                </View>
              </View>
              <ThemedText type="small" themeColor="textMuted">
                {event.event}
              </ThemedText>
            </View>
          ))}
        </>
      ) : null}

      {timeline.length === 0 && summaries.length === 0 ? (
        <EmptyHint text="暂无事件记录。" />
      ) : null}
    </View>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <ThemedText type="small" themeColor="textMuted">
      {text}
    </ThemedText>
  );
}

function TagChip({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tagChip,
        {
          backgroundColor: theme.backgroundSelected,
          borderColor: theme.border,
        },
      ]}
    >
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  entryCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 8,
  },
  mobileCard: { borderRadius: 12, padding: 16 },
  entryActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  entryButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  segmentRow: { flexDirection: "row", borderRadius: 12, padding: 3, gap: 4 },
  mobileSegmentRow: { minHeight: 48, padding: 4 },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  emptyBlock: { gap: 12 },
  listCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
  listRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  listTitle: { flex: 1 },
  tagGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 4,
  },
  tagChip: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  progressBlock: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 2,
  },
  warningCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
});
