import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { WorkbenchPanel } from '@/components/novel-continue/WorkbenchPanel';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getAppDatabase } from '@/db/database';
import {
  listConsistencyAuditRuns,
  listConsistencyIssues,
  updateConsistencyIssueStatus,
  type ConsistencyAuditRunRow,
  type ConsistencyIssueRow,
  type ConsistencyIssueStatus,
} from '@/db/repositories/consistency-issues';
import {
  decideEntityMergeCandidate,
  listPendingEntityMergeCandidates,
} from '@/db/repositories/consistency-projections';
import { useTheme } from '@/hooks/use-theme';
import { showAppAlert } from '@/utils/app-alert';

type MergeCandidate = Awaited<ReturnType<typeof listPendingEntityMergeCandidates>>[number];
type IssueFilter = 'active' | 'all';

const STATUS_LABEL: Record<ConsistencyIssueStatus, string> = {
  open: '待处理',
  acknowledged: '已确认',
  resolved: '已解决',
  superseded: '已失效',
};

const KIND_LABEL: Record<string, string> = {
  'scene-consistency-audit': '场景审计',
  'volume-consistency-audit': '卷级审计',
  'mission-verification': '任务校验',
};

export function ConsistencyPanel({ novelId }: { novelId: string }) {
  const theme = useTheme();
  const [issues, setIssues] = useState<ConsistencyIssueRow[]>([]);
  const [runs, setRuns] = useState<ConsistencyAuditRunRow[]>([]);
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [filter, setFilter] = useState<IssueFilter>('active');
  const [loading, setLoading] = useState(Platform.OS !== 'web');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (Platform.OS === 'web') return;
    try {
      const db = await getAppDatabase();
      setLoading(true);
      const [nextIssues, nextRuns, nextCandidates] = await Promise.all([
        listConsistencyIssues(db, novelId, { status: filter === 'active' ? 'active' : undefined }),
        listConsistencyAuditRuns(db, novelId),
        listPendingEntityMergeCandidates(db, novelId),
      ]);
      setIssues(nextIssues);
      setRuns(nextRuns);
      setCandidates(nextCandidates);
    } catch (error) {
      showAppAlert('加载失败', error instanceof Error ? error.message : '无法读取一致性数据。');
    } finally {
      setLoading(false);
    }
  }, [filter, novelId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => ({
    critical: issues.filter((issue) => issue.severity === 'critical' && issue.status !== 'resolved' && issue.status !== 'superseded').length,
    warning: issues.filter((issue) => issue.severity === 'warning' && issue.status !== 'resolved' && issue.status !== 'superseded').length,
    merges: candidates.length,
  }), [candidates.length, issues]);

  async function changeStatus(issue: ConsistencyIssueRow, status: Exclude<ConsistencyIssueStatus, 'open'>) {
    setBusyId(issue.id);
    try {
      const db = await getAppDatabase();
      const changed = await updateConsistencyIssueStatus(
        db,
        novelId,
        issue.id,
        status,
        new Date().toISOString(),
      );
      if (!changed) showAppAlert('状态未更新', '该问题可能已被其他操作处理，请刷新后重试。');
      await load();
    } catch (error) {
      showAppAlert('操作失败', error instanceof Error ? error.message : '无法更新问题状态。');
    } finally {
      setBusyId(null);
    }
  }

  async function decideMerge(candidate: MergeCandidate, decision: 'accepted' | 'rejected') {
    setBusyId(candidate.id);
    try {
      const db = await getAppDatabase();
      await decideEntityMergeCandidate(db, candidate.id, decision, new Date().toISOString());
      await load();
    } catch (error) {
      showAppAlert('操作失败', error instanceof Error ? error.message : '无法处理实体候选。');
    } finally {
      setBusyId(null);
    }
  }

  if (Platform.OS === 'web') {
    return (
      <WorkbenchPanel title="一致性工作台" subtitle="长期一致性审计目前由原生 SQLite 提供。">
        <ThemedText type="small" themeColor="textMuted">
          Web 端继续使用兼容存储，暂不展示审计问题和实体合并候选。
        </ThemedText>
      </WorkbenchPanel>
    );
  }

  return (
    <View style={styles.stack}>
      <WorkbenchPanel
        title="一致性概览"
        subtitle="来自场景边界、卷边界与章节任务校验；修订正史后旧问题会自动失效。"
        action={
          <Pressable onPress={() => void load()} style={[styles.button, { borderColor: theme.border }]}>
            <ThemedText type="small">刷新</ThemedText>
          </Pressable>
        }>
        {loading ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <View style={styles.summaryRow}>
            <SummaryMetric label="严重" value={counts.critical} color={theme.error} />
            <SummaryMetric label="警告" value={counts.warning} color={theme.warning} />
            <SummaryMetric label="待合并" value={counts.merges} color={theme.accent} />
          </View>
        )}
      </WorkbenchPanel>

      <WorkbenchPanel
        title="一致性问题"
        subtitle="确认表示已知悉；解决和失效为终态。"
        action={
          <View style={[styles.filter, { backgroundColor: theme.backgroundElement }]}>
            {(['active', 'all'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => setFilter(value)}
                style={[styles.filterItem, filter === value && { backgroundColor: theme.surface }]}>
                <ThemedText type="smallBold" themeColor={filter === value ? 'accent' : 'textMuted'}>
                  {value === 'active' ? '待处理' : '全部'}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        }>
        {!loading && issues.length === 0 ? (
          <ThemedText type="small" themeColor="textMuted">当前没有符合条件的问题。</ThemedText>
        ) : null}
        {issues.map((issue) => (
          <View key={issue.id} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <View style={styles.chips}>
                <Chip label={issue.severity === 'critical' ? '严重' : issue.severity === 'warning' ? '警告' : '提示'} color={issue.severity === 'critical' ? theme.error : issue.severity === 'warning' ? theme.warning : theme.textMuted} />
                <Chip label={issue.category} color={theme.accent} />
              </View>
              <ThemedText type="small" themeColor="textMuted">{STATUS_LABEL[issue.status]} · r{issue.canonRevision}</ThemedText>
            </View>
            {issue.subject ? <ThemedText type="smallBold">{issue.subject}</ThemedText> : null}
            {issue.evidence.map((evidence, index) => (
              <ThemedText key={`${issue.id}:e:${index}`} type="small">证据：{evidence}</ThemedText>
            ))}
            {issue.suggestion ? <ThemedText type="small" themeColor="textMuted">建议：{issue.suggestion}</ThemedText> : null}
            {issue.status === 'open' || issue.status === 'acknowledged' ? (
              <View style={styles.actions}>
                {issue.status === 'open' ? <ActionButton label="确认" disabled={busyId === issue.id} onPress={() => void changeStatus(issue, 'acknowledged')} /> : null}
                <ActionButton label="解决" disabled={busyId === issue.id} onPress={() => void changeStatus(issue, 'resolved')} />
                <ActionButton label="标记失效" disabled={busyId === issue.id} onPress={() => void changeStatus(issue, 'superseded')} />
              </View>
            ) : null}
          </View>
        ))}
      </WorkbenchPanel>

      <WorkbenchPanel title="实体合并候选" subtitle="系统只提出候选，不会自动合并；用户锁定实体不能作为被合并项。">
        {candidates.length === 0 ? <ThemedText type="small" themeColor="textMuted">暂无待确认候选。</ThemedText> : null}
        {candidates.map((candidate) => (
          <View key={candidate.id} style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <ThemedText type="smallBold">{candidate.secondaryEntityId} → {candidate.primaryEntityId}</ThemedText>
            <ThemedText type="small" themeColor="textMuted">置信度 {Math.round(candidate.confidence * 100)}%</ThemedText>
            <View style={styles.actions}>
              <ActionButton label="接受合并" disabled={busyId === candidate.id} onPress={() => void decideMerge(candidate, 'accepted')} />
              <ActionButton label="拒绝" disabled={busyId === candidate.id} onPress={() => void decideMerge(candidate, 'rejected')} />
            </View>
          </View>
        ))}
      </WorkbenchPanel>

      <WorkbenchPanel title="最近审计" subtitle="审计运行记录不可变，问题状态独立维护。">
        {runs.length === 0 ? <ThemedText type="small" themeColor="textMuted">尚无审计记录。</ThemedText> : null}
        {runs.slice(0, 10).map((run) => (
          <View key={run.id} style={[styles.runRow, { borderBottomColor: theme.border }]}>
            <View style={styles.rowBetween}>
              <ThemedText type="smallBold">{KIND_LABEL[run.kind] ?? run.kind}</ThemedText>
              <ThemedText type="small" themeColor="textMuted">r{run.canonRevision}</ThemedText>
            </View>
            <ThemedText type="small" themeColor="textMuted">{run.summary || '审计完成，未提供摘要。'}</ThemedText>
          </View>
        ))}
      </WorkbenchPanel>
    </View>
  );
}

function SummaryMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.metric}>
      <ThemedText type="subtitle" style={{ color }}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textMuted">{label}</ThemedText>
    </View>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return <View style={[styles.chip, { borderColor: color }]}><ThemedText type="small" style={{ color }}>{label}</ThemedText></View>;
}

function ActionButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.button, { borderColor: theme.border }, disabled && styles.disabled]}>
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.three },
  summaryRow: { flexDirection: 'row', gap: Spacing.two },
  metric: { flex: 1, alignItems: 'center', gap: Spacing.one },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  disabled: { opacity: 0.45 },
  filter: { flexDirection: 'row', borderRadius: 10, padding: 2 },
  filterItem: { borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  runRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: Spacing.two, gap: Spacing.one },
});
