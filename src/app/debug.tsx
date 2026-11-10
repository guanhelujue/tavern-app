import { Stack, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  clearDebugRequestHistory,
  filterDebugRequestHistoryByCategory,
  getDebugRequestHistory,
  getDebugRequestCategory,
  normalizeDebugPurpose,
  subscribeDebugRequestHistory,
  type DebugRequestCategory,
  type DebugRequestSnapshot,
} from '@/services/debug-request-history';
import { useTavernStore } from '@/store/tavern-store';
import { confirmAppAction } from '@/utils/app-alert';
import { formatImageDebugStep } from '@/services/image-request-trace';

// ── Observatory console palette ──
const C = {
  bg: '#EEE8DF',
  surface: '#FAF7F1',
  surfaceHover: '#E9E0D6',
  border: '#CFC3B6',
  green: '#4E6B59',
  greenDim: '#71877A',
  greenMuted: '#688876',
  cyan: '#587985',
  cyanDim: '#6F8C94',
  cyanMuted: '#86A7AF',
  amber: '#9B6845',
  amberDim: '#B18A69',
  red: '#A24F45',
  redDim: '#C47B70',
  white: '#252927',
  whiteDim: '#6D7470',
};

function getPurposeLabel(purpose?: string): string {
  return normalizeDebugPurpose(purpose);
}

const CATEGORY_FILTERS: { key: DebugRequestCategory; label: string }[] = [
  { key: 'writing', label: 'WRITE' },
  { key: 'collaboration', label: 'COLLAB' },
  { key: 'support', label: 'AUX' },
  { key: 'image', label: 'IMAGE / 生图' },
];

function timeLabel(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19);
}

function tagColor(tag: DebugRequestCategory): string {
  switch (tag) {
    case 'writing': return C.green;
    case 'collaboration': return C.cyan;
    default: return C.amber;
  }
}

function formatDebugSnapshotForClipboard(snapshot: DebugRequestSnapshot): string {
  const lines = [
    `[${timeLabel(snapshot.at)}] ${snapshot.status ?? (snapshot.error ? 'error' : 'success')}`,
    `provider: ${snapshot.providerName ?? 'unknown'}`,
    `model: ${snapshot.model}`,
    `purpose: ${getPurposeLabel(snapshot.purpose)}`,
    `streaming: ${snapshot.streaming ? 'true' : 'false'}`,
    `messages: ${snapshot.messages.length}`,
  ];

  if (snapshot.finishReason) lines.push(`finish_reason: ${snapshot.finishReason}`);
  if (snapshot.responseTokens) {
    lines.push(
      `tokens: prompt=${snapshot.responseTokens.promptTokens ?? '?'}, completion=${snapshot.responseTokens.completionTokens ?? '?'}`,
    );
  }
  if (snapshot.error) lines.push(`\n## error\n${snapshot.error}`);
  if (snapshot.phase) lines.push(`phase: ${snapshot.phase}`);
  if (snapshot.promptId) lines.push(`prompt_id: ${snapshot.promptId}`);
  if (snapshot.durationMs !== undefined) lines.push(`duration: ${snapshot.durationMs} ms`);
  if (snapshot.steps) lines.push('\n## 调用链路（密钥与图片数据已省略）', ...snapshot.steps.map(formatImageDebugStep));

  lines.push(
    '\n## request',
    ...snapshot.messages.map(
      (message, index) => `[${index}] ${message.role}\n${message.content}`,
    ),
  );
  if (snapshot.responseContent) {
    lines.push(`\n## response\n${snapshot.responseContent}`);
  }
  if (snapshot.reasoningContent) {
    lines.push(`\n## thinking\n${snapshot.reasoningContent}`);
  }
  return lines.join('\n');
}

// ── Sub-components ──

function TerminalLogEntry({
  snapshot,
  expanded,
  onToggle,
}: {
  snapshot: DebugRequestSnapshot;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const tag = getDebugRequestCategory(snapshot.purpose);
  const hasResponse = Boolean(snapshot.responseContent);
  const hasReasoning = Boolean(snapshot.reasoningContent);
  const hasError = Boolean(snapshot.error);
  const purpose = getPurposeLabel(snapshot.purpose);
  const accent = tagColor(tag);

  const pending = snapshot.status === 'pending';
  const cancelled = snapshot.status === 'cancelled';
  const statusIcon = pending ? '[RUN]' : cancelled ? '[STOP]' : hasError ? '[ERR]' : '[OK ]';
  const statusColor = pending || cancelled ? C.amber : hasError ? C.red : C.green;

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(formatDebugSnapshotForClipboard(snapshot));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [snapshot]);

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.logEntry,
        {
          backgroundColor: pressed ? C.surfaceHover : C.surface,
          borderLeftColor: hasError ? C.red : accent,
        },
      ]}>
      {/* Header line */}
      <View style={styles.logHeader}>
        <View style={styles.logStatusGroup}>
          <ThemedText type="code" style={{ color: C.whiteDim, fontSize: 11 }}>
            [{timeLabel(snapshot.at)}]
          </ThemedText>
          <ThemedText type="code" style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>
            {statusIcon}
          </ThemedText>
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              void handleCopy();
            }}
            hitSlop={6}
            style={({ pressed }) => [styles.copyButton, { opacity: pressed ? 0.55 : 1 }]}>
            <ThemedText type="code" style={{ color: copied ? C.green : C.cyan, fontSize: 10, fontWeight: '700' }}>
              {copied ? '[COPIED]' : '[COPY]'}
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Model line */}
      <View style={styles.logMeta}>
        {snapshot.providerName ? (
          <ThemedText
            type="code"
            style={{ color: C.cyan, fontSize: 11, fontWeight: '700' }}
            numberOfLines={1}>
            {snapshot.providerName}
          </ThemedText>
        ) : null}
        <ThemedText
          type="code"
          style={{ color: C.greenDim, fontSize: 11 }}
          numberOfLines={1}>
          {snapshot.model}
        </ThemedText>
        <ThemedText type="code" style={{ color: accent, fontSize: 10 }}>
          {purpose}
        </ThemedText>
        <ThemedText type="code" style={{ color: C.whiteDim, fontSize: 10 }}>
          {snapshot.streaming ? '| stream' : '| sync'}
        </ThemedText>
      </View>

      {/* One-liner summary */}
      <View style={styles.logMeta}>
        <ThemedText type="code" style={{ color: C.whiteDim, fontSize: 10 }}>
          {snapshot.steps ? `steps:${snapshot.steps.length}` : `msgs:${snapshot.messages.length}`}
        </ThemedText>
        {hasResponse && (
          <ThemedText type="code" style={{ color: C.whiteDim, fontSize: 10 }}>
            out:{snapshot.responseContent!.length}ch
          </ThemedText>
        )}
        {hasReasoning && (
          <ThemedText type="code" style={{ color: C.cyanMuted, fontSize: 10 }}>
            think:{snapshot.reasoningContent!.length}ch
          </ThemedText>
        )}
        {snapshot.finishReason && (
          <ThemedText type="code" style={{ color: C.whiteDim, fontSize: 10 }}>
            {snapshot.finishReason}
          </ThemedText>
        )}
        {snapshot.responseTokens && (
          <ThemedText type="code" style={{ color: C.greenDim, fontSize: 10 }}>
            tok:{snapshot.responseTokens.promptTokens ?? '?'}/
            {snapshot.responseTokens.completionTokens ?? '?'}
          </ThemedText>
        )}
        <ThemedText type="code" style={{ color: expanded ? C.green : C.greenDim, fontSize: 10 }}>
          {expanded ? '▲' : '▼'}
        </ThemedText>
      </View>

      {snapshot.phase ? (
        <ThemedText type="code" style={{ color: statusColor, fontSize: 11 }}>
          {snapshot.phase}{snapshot.durationMs !== undefined ? ` · ${(snapshot.durationMs / 1000).toFixed(1)}s` : ''}
          {snapshot.promptId ? ` · prompt_id: ${snapshot.promptId}` : ''}
        </ThemedText>
      ) : null}

      {/* Expanded detail */}
      {expanded && (
        <View style={styles.expandedArea}>
          {hasError && (
            <View style={[styles.logBlock, { borderLeftColor: C.red }]}>
              <ThemedText type="code" style={{ color: C.red, marginBottom: 4 }}>
                ## error
              </ThemedText>
              <ThemedText type="code" style={{ color: C.redDim }} selectable>
                {snapshot.error}
              </ThemedText>
            </View>
          )}

          {/* Messages */}
          {snapshot.messages.length > 0 && <View style={styles.logBlock}>
            <ThemedText type="code" style={{ color: C.green, marginBottom: 4 }}>
              ## request ({snapshot.messages.length} messages)
            </ThemedText>
            {snapshot.messages.map((message, index) => (
              <View key={`${message.role}-${index}`} style={styles.msgLine}>
                <ThemedText type="code" style={{ color: C.amber, marginBottom: 2 }}>
                  [{index}] {message.role} ({message.content.length}ch)
                </ThemedText>
                <ThemedText type="code" style={{ color: C.whiteDim }} selectable>
                  {message.content}
                </ThemedText>
              </View>
            ))}
          </View>}

          {snapshot.steps && (
            <View style={{ gap: 12 }}>
              <ThemedText type="code" style={{ color: C.cyan }}>
                ## 生图调用链路 · 密钥与图片数据已省略
              </ThemedText>
              {snapshot.steps.length === 0 ? (
                <ThemedText type="code" style={{ color: C.whiteDim }}>尚未发出 HTTP 请求</ThemedText>
              ) : snapshot.steps.map((step) => (
                <View key={step.id} style={[styles.logBlock, { borderLeftColor: step.status === 'error' ? C.red : C.cyan }]}>
                  <ThemedText type="code" style={{ color: C.whiteDim }} selectable>
                    {formatImageDebugStep(step)}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}

          {/* Provider thinking/reasoning, kept separate from the generated prose. */}
          {hasReasoning && (
            <View style={[styles.logBlock, { borderLeftColor: C.cyan }]}>
              <ThemedText type="code" style={{ color: C.cyan, marginBottom: 4 }}>
                ## thinking ({snapshot.reasoningContent!.length}ch)
              </ThemedText>
              <ThemedText type="code" style={{ color: C.cyanMuted }} selectable>
                {snapshot.reasoningContent}
              </ThemedText>
            </View>
          )}

          {/* Response */}
          {hasResponse && (
            <View style={styles.logBlock}>
              <ThemedText type="code" style={{ color: C.green, marginBottom: 4 }}>
                ## response ({snapshot.responseContent!.length}ch)
              </ThemedText>
              <ThemedText type="code" style={{ color: C.white }} selectable>
                {snapshot.responseContent}
              </ThemedText>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

// ── Main page ──

export function DebugScreen({ embedded = false }: { embedded?: boolean }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<DebugRequestCategory | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const debugEnabled = useTavernStore(
    (state) => state.generationSettings.debugPromptInspectorEnabled,
  );
  const updateGenerationSettings = useTavernStore((state) => state.updateGenerationSettings);

  // Subscribe to immutable history updates so requests appear immediately,
  // including when the Debug tab stays mounted in the tab navigator.
  const history = useSyncExternalStore(
    subscribeDebugRequestHistory,
    getDebugRequestHistory,
    getDebugRequestHistory,
  );
  const allSnapshots = useMemo(() => [...history].reverse(), [history]);

  const filteredSnapshots = useMemo(
    () => filterDebugRequestHistoryByCategory(allSnapshots, filter),
    [allSnapshots, filter],
  );

  // Newest requests are first, including pending image tasks.
  useEffect(() => {
    if (!autoScroll || filteredSnapshots.length === 0) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [filteredSnapshots.length, autoScroll]);

  const handleToggle = useCallback((index: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleClear = useCallback(async () => {
    if (await confirmAppAction('清除调试记录', '确定清除所有已记录的请求/响应历史吗？', { confirmLabel: '清除' })) {
      clearDebugRequestHistory();
      setExpandedIds(new Set());
      setFilter(null);
    }
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, []);

  const writingCount = allSnapshots.filter(
    (s) => getDebugRequestCategory(s.purpose) === 'writing',
  ).length;
  const collaborationCount = allSnapshots.filter(
    (s) => getDebugRequestCategory(s.purpose) === 'collaboration',
  ).length;
  const supportCount = allSnapshots.filter(
    (s) => getDebugRequestCategory(s.purpose) === 'support',
  ).length;
  const categoryCounts: Record<DebugRequestCategory, number> = {
    writing: writingCount,
    collaboration: collaborationCount,
    support: supportCount,
    image: allSnapshots.filter((s) => getDebugRequestCategory(s.purpose) === 'image').length,
  };

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}> 
      <SafeAreaView
        style={styles.safeArea}
        edges={embedded ? ['top', 'left', 'right'] : ['left', 'right']}>
      {!embedded ? <Stack.Screen options={{ headerShown: false }} /> : null}
      <View style={styles.consoleDeck}>
      {/* Status bar */}
      <View style={[styles.statusBar, { borderBottomColor: C.border }]}> 
        {!embedded ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
            hitSlop={8}
            style={({ pressed }) => [styles.statusAction, pressed && styles.actionPressed]}>
            <ThemedText type="code" style={styles.statusActionText}>← BACK</ThemedText>
          </Pressable>
        ) : null}
        <View style={[styles.liveIndicator, { backgroundColor: debugEnabled ? C.green : C.amber }]} />
        <ThemedText type="code" style={styles.archiveTitle}>LIVE REQUEST ARCHIVE</ThemedText>
        <ThemedText type="code" style={styles.archiveCount}>{filteredSnapshots.length} / {allSnapshots.length}</ThemedText>
        <View style={{ flex: 1 }} />
        {!debugEnabled ? (
          <Pressable
            onPress={() => updateGenerationSettings({ debugPromptInspectorEnabled: true })}
            hitSlop={8}
            style={({ pressed }) => [styles.statusAction, pressed && styles.actionPressed]}>
            <ThemedText type="code" style={[styles.statusActionText, { color: C.amber }]}>START RECORDING</ThemedText>
          </Pressable>
        ) : null}
        {allSnapshots.length > 0 ? (
          <>
            <Pressable onPress={handleCollapseAll} hitSlop={8} style={({ pressed }) => [styles.statusAction, pressed && styles.actionPressed]}>
              <ThemedText type="code" style={styles.statusActionText}>COLLAPSE</ThemedText>
            </Pressable>
            <Pressable onPress={handleClear} hitSlop={8} style={({ pressed }) => [styles.statusAction, pressed && styles.actionPressed]}>
              <ThemedText type="code" style={[styles.statusActionText, { color: C.red }]}>CLEAR</ThemedText>
            </Pressable>
          </>
        ) : null}
        <Pressable onPress={() => setAutoScroll((p) => !p)} hitSlop={8}>
          <ThemedText
            type="code"
            style={{ color: autoScroll ? C.green : C.greenDim, fontSize: 9 }}>
            AUTO FOLLOW · {autoScroll ? 'ON' : 'OFF'}
          </ThemedText>
        </Pressable>
      </View>

      {/* Filter tabs */}
      <View style={[styles.filterRow, { borderBottomColor: C.border }]}>
        <ScrollView
          horizontal
          style={styles.filterScroll}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRowContent}>
          <ThemedText type="code" style={{ color: C.greenDim, fontSize: 10 }}>
            FILTER:
          </ThemedText>
          {[null, ...CATEGORY_FILTERS].map((category) => {
            const active = filter === (category === null ? null : category.key);
            const count = category === null
              ? allSnapshots.length
              : categoryCounts[category.key];
            const label = category === null ? 'ALL' : category.label;
            const fc = category === null
              ? C.green
              : category.key === 'writing'
                ? C.green
                : category.key === 'collaboration'
                  ? C.cyan
                  : C.amber;
            return (
              <Pressable
                key={category === null ? 'all' : category.key}
                onPress={() => setFilter(category === null ? null : category.key)}
                style={[
                  styles.filterChip,
                  {
                    borderColor: active ? fc : C.border,
                    backgroundColor: active
                      ? (fc === C.green ? C.greenDim : fc === C.cyan ? C.cyanDim : C.amberDim) + '30'
                      : 'transparent',
                  },
                ]}>
                <ThemedText
                  type="code"
                  style={{
                    color: active ? fc : C.whiteDim,
                    fontSize: 10,
                  }}>
                  {label}({count})
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Log list */}
      <ScrollView
        style={styles.logScroll}
        ref={scrollRef}
        contentContainerStyle={[
          styles.logList,
          { paddingBottom: Math.max(insets.bottom, Spacing.four) },
        ]}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={() => setAutoScroll(false)}>
        {filteredSnapshots.length === 0 ? (
          <View style={styles.emptyLog}>
            <View style={styles.emptyInstrument}>
              <View style={styles.emptyOrbitOuter} />
              <View style={styles.emptyOrbitInner} />
              <View style={[styles.emptySignal, { backgroundColor: C.amber }]} />
            </View>
            <ThemedText type="code" style={styles.emptyEyebrow}>SIGNAL CHANNEL OPEN</ThemedText>
            <ThemedText style={styles.emptyTitle}>等待第一条模型信号</ThemedText>
            <ThemedText style={styles.emptyDescription}>
              {debugEnabled
                ? '执行正文生成、AI 补全或生图。生图会从请求开始实时记录调用链路，展开可查看请求 JSON、状态与结果。'
                : '模型请求记录当前关闭。启动记录后，新的文本与生图请求会出现在这里。'}
            </ThemedText>
            {!debugEnabled ? (
              <Pressable
                onPress={() => updateGenerationSettings({ debugPromptInspectorEnabled: true })}
                style={({ pressed }) => [styles.enableDebugButton, pressed && styles.actionPressed]}>
                <ThemedText style={styles.enableDebugLabel}>启动记录</ThemedText>
                <ThemedText style={styles.enableDebugArrow}>↗</ThemedText>
              </Pressable>
            ) : null}
            <View style={styles.emptyCapabilityRow}>
              <View style={styles.emptyCapability}>
                <ThemedText type="code" style={styles.emptyCapabilityIndex}>01</ThemedText>
                <ThemedText style={styles.emptyCapabilityTitle}>输入上下文</ThemedText>
                <ThemedText type="code" style={styles.emptyCapabilityCopy}>system · user · history</ThemedText>
              </View>
              <View style={styles.emptyCapability}>
                <ThemedText type="code" style={styles.emptyCapabilityIndex}>02</ThemedText>
                <ThemedText style={styles.emptyCapabilityTitle}>模型输出</ThemedText>
                <ThemedText type="code" style={styles.emptyCapabilityCopy}>thinking · response</ThemedText>
              </View>
              <View style={styles.emptyCapability}>
                <ThemedText type="code" style={styles.emptyCapabilityIndex}>03</ThemedText>
                <ThemedText style={styles.emptyCapabilityTitle}>消耗与异常</ThemedText>
                <ThemedText type="code" style={styles.emptyCapabilityCopy}>tokens · finish · error</ThemedText>
              </View>
            </View>
          </View>
        ) : (
          filteredSnapshots.map((snapshot, index) => (
            <TerminalLogEntry
              key={snapshot.id ?? `${snapshot.at}-${index}`}
              snapshot={snapshot}
              expanded={expandedIds.has(snapshot.id ?? `${snapshot.at}-${index}`)}
              onToggle={() => handleToggle(snapshot.id ?? `${snapshot.at}-${index}`)}
            />
          ))
        )}
      </ScrollView>
      </View>
      </SafeAreaView>
    </View>
  );
}

export default DebugScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, zIndex: 1 },
  actionPressed: { opacity: 0.6, transform: [{ translateY: 1 }] },
  consoleDeck: {
    flex: 1,
    width: '100%',
    backgroundColor: C.bg,
    overflow: 'hidden',
  },
  statusBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    minHeight: 42,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  liveIndicator: { width: 7, height: 7, borderRadius: 4 },
  archiveTitle: { color: '#3D433F', fontSize: 9, letterSpacing: 1.1, fontWeight: '800' },
  archiveCount: { color: '#81766D', fontSize: 9 },
  statusAction: { minHeight: 26, justifyContent: 'center', paddingHorizontal: 3 },
  statusActionText: { color: C.greenDim, fontSize: 8, letterSpacing: 0.7 },
  enableDebugButton: {
    marginTop: 18,
    backgroundColor: C.amber,
    borderRadius: 14,
    minWidth: 180,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  enableDebugLabel: { color: '#18120D', fontSize: 14, fontWeight: '800' },
  enableDebugArrow: { color: '#18120D', fontSize: 20 },
  filterRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterScroll: {
    flexGrow: 0,
  },
  filterRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  logScroll: { flex: 1 },
  logList: {
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  emptyLog: {
    flex: 1,
    minHeight: 330,
    paddingVertical: 32,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyInstrument: {
    width: 82,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  emptyOrbitOuter: {
    position: 'absolute', width: 80, height: 80, borderRadius: 40,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#A98B73',
  },
  emptyOrbitInner: {
    position: 'absolute', width: 48, height: 48, borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#7E8D85',
  },
  emptySignal: { width: 8, height: 8, borderRadius: 4 },
  emptyEyebrow: { color: C.amber, fontSize: 9, letterSpacing: 1.2, fontWeight: '800' },
  emptyTitle: { color: '#292522', fontSize: 24, lineHeight: 32, fontWeight: '800', marginTop: 8 },
  emptyDescription: {
    maxWidth: 560, color: '#746C66', fontSize: 12, lineHeight: 21,
    textAlign: 'center', marginTop: 6,
  },
  emptyCapabilityRow: {
    width: '100%', maxWidth: 620, flexDirection: 'row', flexWrap: 'wrap',
    gap: Spacing.two, marginTop: Spacing.four,
  },
  emptyCapability: {
    flex: 1, minWidth: 150, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#B7A99C', paddingTop: Spacing.two, gap: 3,
  },
  emptyCapabilityIndex: { color: C.amber, fontSize: 8 },
  emptyCapabilityTitle: { color: '#383330', fontSize: 12, fontWeight: '700' },
  emptyCapabilityCopy: { color: '#8B827B', fontSize: 8 },
  logEntry: {
    borderRadius: 12,
    borderLeftWidth: 3,
    padding: 12,
    gap: 5,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logStatusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  copyButton: {
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  logMeta: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  expandedArea: {
    marginTop: 6,
    gap: 6,
  },
  logBlock: {
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: C.greenDim,
  },
  msgLine: {
    marginBottom: 6,
  },
});
