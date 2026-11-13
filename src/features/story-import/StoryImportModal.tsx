import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { confirmAppAction } from '@/utils/app-alert';
import { getStoryImportEntries, storyImportFingerprint, type StoryImportCandidate, type StoryImportEntry } from './model';
import { requestStoryImport, type StoryImportProgress } from './service';

const GROUPS: { kind: StoryImportEntry['kind']; title: string; destination: string }[] = [
  { kind: 'summary', title: '全书总纲', destination: '故事大纲 → 故事主线' },
  { kind: 'volume', title: '卷纲与章纲', destination: '故事大纲 → 分卷目录' },
  { kind: 'character', title: '人物', destination: '人物 → 公开档案' },
  { kind: 'lore', title: '世界设定', destination: '知识库 → 对应分类' },
  { kind: 'foreshadowing', title: '伏笔', destination: '伏笔管理 → 待埋设' },
  { kind: 'writing', title: '写作要求', destination: '写作设置 → 写作要求与目标字数' },
];

const PROGRESS_LABELS: Record<StoryImportProgress['phase'], string> = {
  waiting: '等待模型返回内容',
  thinking: '模型正在思考',
  receiving: '正在接收识别结果',
  validating: '正在核对结果与原文',
};

export function StoryImportModal({ novelId, visible, onClose, onApplied }: {
  novelId: string; visible: boolean; onClose: () => void; onApplied: () => void;
}) {
  const theme = useTheme();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const configuredModel = useTavernStore((state) => {
    try {
      return resolveApiSettings(state.providers, state.generationSettings, { purpose: 'utility', task: 'analysis' }).model;
    } catch {
      return '';
    }
  });
  const [source, setSource] = useState('');
  const [candidate, setCandidate] = useState<StoryImportCandidate | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [baseFingerprint, setBaseFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<StoryImportProgress | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const entries = useMemo(() => candidate && novel ? getStoryImportEntries(candidate, novel) : [], [candidate, novel]);
  const stale = Boolean(candidate && novel && baseFingerprint !== storyImportFingerprint(novel));
  const selectionCount = entries.filter((entry) => selected.has(entry.id) && !entry.blockedReason).length;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible || !source.trim() || completed !== null) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [visible, source, completed]);

  function selectSafeItems(next: StoryImportEntry[]) {
    setSelected(new Set(next.filter((item) => !item.blockedReason && !item.replaces).map((item) => item.id)));
  }

  async function close() {
    if (busy && !await confirmAppAction('停止识别', '关闭后停止当前识别，已粘贴的文字仍保留在本页。', { confirmLabel: '停止并关闭' })) return;
    controller.current?.abort();
    onClose();
  }

  async function recognize() {
    if (busy || !source.trim() || !novel) return;
    const state = useTavernStore.getState();
    let apiSettings;
    try {
      apiSettings = resolveApiSettings(state.providers, state.generationSettings, { purpose: 'utility', task: 'analysis' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '当前功能模型尚未配置。');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(''); setProgress(null); setElapsedSeconds(0);
    try {
      const result = await requestStoryImport({ source, apiSettings, signal: abort.signal, onProgress: (next) => {
        if (controller.current === abort && !abort.signal.aborted) setProgress(next);
      } });
      if (abort.signal.aborted) return;
      const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
      if (!latest) throw new Error('作品已不存在，未写入任何内容。');
      setCandidate(result.candidate);
      setBaseFingerprint(storyImportFingerprint(latest));
      selectSafeItems(getStoryImportEntries(result.candidate, latest));
      setExpanded(new Set());
      if (result.tokens && result.tokens > 0) state.recordNovelContinuationUsage(novelId, 'story-import', result.tokens);
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '识别失败，请重试。');
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  }

  function apply() {
    if (!candidate || stale || busy || !selectionCount) return;
    try {
      const report = useTavernStore.getState().applyNovelStoryImport(novelId, candidate, [...selected], baseFingerprint);
      setCompleted(report.appliedCount);
      setError('');
      onApplied();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '写入失败，未采用本次结果。');
    }
  }

  function toggle(id: string) {
    setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function navigate(path: string) { onClose(); router.push(path as Href); }

  function reset() { setCandidate(null); setSource(''); setError(''); setCompleted(null); setSelected(new Set()); }

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={() => void close()}>
      <View style={[styles.overlay, { backgroundColor: theme.scrim }]}>
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
          <View style={[styles.header, { borderBottomColor: theme.outlineVariant }]}>
            <View style={styles.flex}>
              <ThemedText type="subtitle">{completed !== null ? '已写入作品' : candidate ? '核对识别结果' : '粘贴识别故事资料'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{candidate ? '按内容选择写入，展开条目查看全文与原文依据。' : '把大纲、人物设定和写作要求一起粘贴，AI 会分开整理。'}</ThemedText>
            </View>
            <Button label="关闭" onPress={() => void close()} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {error ? <ThemedText accessibilityRole="alert" themeColor="error">{error}</ThemedText> : null}
            {completed !== null ? (
              <>
                <ThemedText accessibilityLiveRegion="polite">已写入 {completed} 项。可以进入对应页面继续编辑。</ThemedText>
                <View style={styles.actions}>
                  <Button label="查看故事大纲" onPress={onClose} />
                  <Button label="查看人物" onPress={() => navigate(`/novel/knowledge/characters/${novelId}`)} />
                  <Button label="查看世界设定" onPress={() => navigate(`/novel/knowledge/lore/${novelId}`)} />
                  <Button label="查看伏笔" onPress={() => navigate(`/novel/foreshadows/${novelId}`)} />
                  <Button label="查看写作要求" onPress={() => navigate(`/novel/workbench/${novelId}?focus=settings`)} />
                </View>
                <Button label="整理另一份资料" onPress={reset} />
              </>
            ) : !candidate ? (
              <>
                <ThemedText type="smallBold">原始资料</ThemedText>
                <TextInput
                  accessibilityLabel="待识别的故事资料" multiline textAlignVertical="top" editable={!busy}
                  value={source} onChangeText={setSource} autoFocus
                  placeholder="粘贴故事大纲、分卷阶段、人物设定、世界规则或写作要求……"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.outlineVariant }]}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  按原文整理，不补写剧情。未明确分章的事件保留在卷纲，章数留待规划。识别后先预览，再选择写入。
                </ThemedText>
                <TaskModelSelector task="analysis" disabled={busy} />
                <ThemedText type="small" themeColor="textMuted">{source.length.toLocaleString()} 字符 · 后台模型：{configuredModel || '尚未配置'}（可在“模型连接”中修改）</ThemedText>
                {busy ? <View style={styles.actions}>
                  <ActivityIndicator color={theme.primary} />
                  <View style={styles.flex}>
                    <ThemedText accessibilityLiveRegion="polite" type="small">
                      {progress && progress.attempt > 1 ? '自动修正识别结果 · ' : ''}{PROGRESS_LABELS[progress?.phase ?? 'waiting']}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textMuted">
                      已用 {elapsedSeconds} 秒{progress?.receivedCharacters ? ` · 已接收 ${progress.receivedCharacters.toLocaleString()} 字符` : progress?.reasoningCharacters ? ` · 已接收思考 ${progress.reasoningCharacters.toLocaleString()} 字符` : ''}
                    </ThemedText>
                  </View>
                  <Button label="停止识别" onPress={() => controller.current?.abort()} />
                </View> : null}
              </>
            ) : (
              <>
                {candidate.warnings.map((warning, index) => <ThemedText key={index} type="small" themeColor="textSecondary">提示：{warning}</ThemedText>)}
                {stale ? <View style={styles.group}>
                  <ThemedText themeColor="error">作品资料在预览期间发生了变化，请刷新对照后重新勾选。</ThemedText>
                  <Button label="刷新对照" onPress={() => { if (novel) { setBaseFingerprint(storyImportFingerprint(novel)); selectSafeItems(entries); setError(''); } }} />
                </View> : null}
                {GROUPS.map((group) => {
                  const items = entries.filter((item) => item.kind === group.kind);
                  return <View key={group.kind} style={[styles.group, { borderTopColor: theme.outlineVariant }]}>
                    <View style={styles.row}>
                      <View style={styles.flex}><ThemedText type="smallBold">{group.title} · {items.length} 项</ThemedText><ThemedText type="small" themeColor="textMuted">写入：{group.destination}</ThemedText></View>
                      {items.some((item) => !item.blockedReason && !item.replaces) ? <Button label="选择新增项" onPress={() => setSelected((previous) => new Set([...previous, ...items.filter((item) => !item.blockedReason && !item.replaces).map((item) => item.id)]))} /> : null}
                    </View>
                    {!items.length ? <ThemedText type="small" themeColor="textMuted">原文未识别出此类内容。</ThemedText> : items.map((item) => {
                      const open = expanded.has(item.id);
                      return <View key={item.id} style={[styles.item, { borderColor: theme.outlineVariant }]}>
                        <View style={styles.row}>
                          <Pressable
                            accessibilityRole="checkbox" accessibilityLabel={`写入${item.title}`}
                            accessibilityState={{ checked: selected.has(item.id), disabled: Boolean(item.blockedReason) }}
                            disabled={Boolean(item.blockedReason)} onPress={() => toggle(item.id)}
                            style={({ pressed }) => [styles.checkbox, { opacity: item.blockedReason ? 0.5 : pressed ? 0.7 : 1 }]}>
                            <ThemedText themeColor="primary">{selected.has(item.id) ? '☑' : '☐'}</ThemedText>
                            <ThemedText type="smallBold" style={styles.flex}>{item.title}</ThemedText>
                          </Pressable>
                          <Button label={open ? '收起' : '展开'} onPress={() => setExpanded((previous) => { const next = new Set(previous); if (open) next.delete(item.id); else next.add(item.id); return next; })} />
                        </View>
                        {item.blockedReason ? <ThemedText type="small" themeColor="textMuted">{item.blockedReason}</ThemedText> : item.replaces ? <ThemedText type="small" themeColor="error">勾选后替换已有内容；请展开核对。</ThemedText> : null}
                        <ThemedText numberOfLines={open ? undefined : 3} style={styles.prose}>{item.content}</ThemedText>
                        {open ? <>
                          {item.replaces ? <><ThemedText type="smallBold">当前内容</ThemedText><ThemedText style={styles.prose}>{item.replaces}</ThemedText></> : null}
                          <ThemedText type="smallBold">原文依据</ThemedText><ThemedText type="small" themeColor="textSecondary">{item.evidence}</ThemedText>
                        </> : null}
                      </View>;
                    })}
                  </View>;
                })}
              </>
            )}
          </ScrollView>
          {completed === null ? <View style={[styles.footer, { borderTopColor: theme.outlineVariant }]}>
            {candidate ? <>
              <Button label="返回修改原文" onPress={() => { setCandidate(null); setError(''); }} />
              <Button label="全部取消" onPress={() => setSelected(new Set())} />
              <Button primary label={`写入所选 ${selectionCount} 项`} disabled={!selectionCount || stale || busy} onPress={apply} />
            </> : <Button primary label={busy ? '识别中…' : '开始识别'} disabled={busy || !source.trim()} onPress={() => void recognize()} />}
          </View> : null}
        </View>
      </View>
    </KeyboardSafeModal>
  );
}

function Button({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, { borderColor: primary ? theme.primary : theme.outlineVariant, backgroundColor: primary ? theme.primary : 'transparent', opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
    <ThemedText type="smallBold" style={{ color: primary ? theme.onPrimary : theme.text }}>{label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  sheet: { width: '100%', maxWidth: 1040, height: '92%', borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  header: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1 },
  body: { padding: 20, gap: 16 }, flex: { flex: 1, minWidth: 0, gap: 6 },
  input: { minHeight: 320, padding: 16, borderWidth: 1, borderRadius: 6, fontSize: 15, lineHeight: 25 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  group: { borderTopWidth: 1, paddingTop: 20, gap: 12 },
  item: { borderWidth: 1, borderRadius: 6, padding: 12, gap: 10 },
  checkbox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  prose: { fontSize: 15, lineHeight: 25 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, padding: 16, borderTopWidth: 1 },
  button: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
