import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import {
  MID_TERM_MEMORY_BATCH_SIZE,
  SHORT_TERM_MEMORY_BATCH_SIZE,
} from '@/constants/novel-memory';
import {
  DEFAULT_NOVEL_INJECTION_TOGGLES,
  NOVEL_INJECTION_TOGGLE_OPTIONS,
  type NovelInjectionToggles,
} from '@/constants/session-injection';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { showAppAlert } from '@/utils/app-alert';
import { useTavernStore } from '@/store/tavern-store';

type NovelStoryMemoryModalProps = {
  visible: boolean;
  longTermMemory: string;
  midTermMemories: string[];
  shortTermMemories: string[];
  injectionToggles?: NovelInjectionToggles;
  /** When false, the 8-5-1 memory system is paused. */
  memorySystemEnabled?: boolean;
  isMerging?: boolean;
  lastMemoryError?: string;
  onClose: () => void;
  onSave: (next: {
    longTermMemory: string;
    midTermMemories: string[];
    shortTermMemories: string[];
  }) => Promise<void>;
  onInjectionTogglesChange?: (toggles: NovelInjectionToggles) => void;
  /** Toggle the memory system on/off. */
  onMemorySystemToggle?: (enabled: boolean) => void;
  onMergeNow?: () => void | Promise<void>;
};

type MemoryTier = 'long' | 'mid' | 'short';

function memoriesToDraft(memories: string[]) {
  return memories.join('\n');
}

function draftToMemories(draft: string) {
  return draft
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function NovelStoryMemoryModal({
  visible,
  longTermMemory,
  midTermMemories,
  shortTermMemories,
  injectionToggles = DEFAULT_NOVEL_INJECTION_TOGGLES,
  memorySystemEnabled = true,
  isMerging = false,
  lastMemoryError,
  onClose,
  onSave,
  onInjectionTogglesChange,
  onMemorySystemToggle,
  onMergeNow,
}: NovelStoryMemoryModalProps) {
  const theme = useTheme();
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isCompact = width < 760;
  const [longDraft, setLongDraft] = useState(longTermMemory);
  const [midDraft, setMidDraft] = useState(memoriesToDraft(midTermMemories));
  const [shortDraft, setShortDraft] = useState(memoriesToDraft(shortTermMemories));
  const [toggles, setToggles] = useState(injectionToggles);
  const [activeTier, setActiveTier] = useState<MemoryTier>('short');
  const [reveal] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setLongDraft(longTermMemory);
      setMidDraft(memoriesToDraft(midTermMemories));
      setShortDraft(memoriesToDraft(shortTermMemories));
      setToggles(injectionToggles);
    }, 0);
    return () => clearTimeout(timer);
  }, [injectionToggles, longTermMemory, midTermMemories, shortTermMemories, visible]);

  useEffect(() => {
    reveal.stopAnimation();
    if (!visible) {
      reveal.setValue(0);
      return;
    }
    if (!motionEnabled) {
      reveal.setValue(1);
      return;
    }
    reveal.setValue(0);
    Animated.spring(reveal, {
      toValue: 1,
      damping: 21,
      stiffness: 190,
      mass: 0.76,
      useNativeDriver: true,
    }).start();
  }, [motionEnabled, reveal, visible]);

  const midCount = draftToMemories(midDraft).length;
  const shortCount = draftToMemories(shortDraft).length;
  const canMerge = shortCount > 0 || midCount > 0;
  const activeInjectionCount = NOVEL_INJECTION_TOGGLE_OPTIONS.filter((option) => toggles[option.key]).length;
  const memoryItemCount = shortCount + midCount + (longDraft.trim() ? 1 : 0);

  function updateToggle(key: keyof NovelInjectionToggles, value: boolean) {
    const next = { ...toggles, [key]: value };
    setToggles(next);
    onInjectionTogglesChange?.(next);
  }

  function collectDraft() {
    return {
      longTermMemory: longDraft,
      midTermMemories: draftToMemories(midDraft),
      shortTermMemories: draftToMemories(shortDraft),
    };
  }

  async function saveDraft(merge = false) {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
      await onSave(collectDraft());
      if (merge) await onMergeNow?.();
      else onClose();
    } catch (error) {
      showAppAlert('保存失败', error instanceof Error ? error.message : '无法保存记忆，请重试。');
    } finally { savingRef.current = false; setIsSaving(false); }
  }

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={isSaving ? () => undefined : onClose}>
      <View style={[styles.overlay, isCompact && styles.overlayCompact]}>
        <Pressable disabled={isSaving} style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭写作上下文" />
        <Animated.View style={[
          styles.card,
          isCompact && styles.cardCompact,
          { backgroundColor: theme.surface, borderColor: theme.border },
          {
            opacity: reveal,
            transform: [
              { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
              { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
            ],
          },
        ]}>
          <View pointerEvents="none" style={[styles.signalOrbit, { borderColor: theme.accent }]} />
          <View style={[styles.header, isCompact && styles.headerCompact]}>
            <View style={[styles.headerCopy, isCompact && styles.headerCopyCompact]}>
              <ThemedText type="code" themeColor="accent">CONTEXT ROUTER / LIVE SESSION</ThemedText>
              <ThemedText type="title" style={[styles.title, isCompact && styles.titleCompact]}>写作上下文调度台</ThemedText>
              <ThemedText type="small" themeColor="textMuted">控制这一轮允许发送的设定，并维护剧情记忆的 8 → 5 → 1 压缩链。</ThemedText>
            </View>
            <View style={[styles.headerTelemetry, isCompact && styles.headerTelemetryCompact]}>
              <ThemedText type="code" themeColor={memorySystemEnabled ? 'accent' : 'textMuted'}>{memorySystemEnabled ? 'MEMORY ONLINE' : 'MEMORY PAUSED'}</ThemedText>
              <ThemedText type="code" themeColor="textMuted">{activeInjectionCount}/{NOVEL_INJECTION_TOGGLE_OPTIONS.length} SOURCES · {memoryItemCount} RECORDS</ThemedText>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={[styles.closeButton, isCompact && styles.closeButtonCompact, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel="关闭">
              <ThemedText type="code" themeColor="textMuted">ESC ×</ThemedText>
            </Pressable>
          </View>

          <Animated.View pointerEvents="none" style={[styles.signalLine, { backgroundColor: theme.accent, transform: [{ scaleX: reveal }] }]} />

          {lastMemoryError ? <View style={[styles.errorStrip, { borderColor: theme.error, backgroundColor: theme.errorContainer }]}><ThemedText type="code" themeColor="error">MEMORY WRITE FAILED</ThemedText><ThemedText type="small" themeColor="error">{lastMemoryError}</ThemedText></View> : null}

          <ScrollView style={[styles.scroll, isCompact && styles.scrollCompact]} contentContainerStyle={[styles.scrollContent, isCompact && styles.scrollContentCompact]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TaskModelSelector task="memory" disabled={isSaving || isMerging} />
            <View style={[styles.workspace, isCompact && styles.workspaceCompact]}>
              <View style={[styles.routeDeck, { borderColor: theme.border, backgroundColor: theme.background }]}>
                <View style={styles.sectionHeading}>
                  <View style={styles.sectionNumber}><ThemedText type="code" themeColor="accent">01</ThemedText></View>
                  <View style={styles.sectionCopy}><ThemedText type="subtitle">注入路由</ThemedText><ThemedText type="small" themeColor="textMuted">开关只影响当前会话，不会删除小说资料。</ThemedText></View>
                </View>

                {onMemorySystemToggle ? <View style={[styles.memoryMaster, isCompact && styles.memoryMasterCompact, { borderColor: memorySystemEnabled ? theme.accent : theme.border, backgroundColor: memorySystemEnabled ? theme.accentMuted : theme.surface }]}>
                  <View style={styles.masterCopy}><ThemedText type="code" themeColor={memorySystemEnabled ? 'accent' : 'textMuted'}>8 → 5 → 1</ThemedText><ThemedText type="smallBold">剧情记忆引擎</ThemedText><ThemedText type="small" themeColor="textMuted">关闭后停止自动压缩，也不注入三层剧情记忆。</ThemedText></View>
                  <Switch value={memorySystemEnabled} onValueChange={onMemorySystemToggle} trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }} thumbColor={memorySystemEnabled ? theme.accent : theme.textMuted} accessibilityLabel="剧情记忆引擎" />
                </View> : null}

                {onInjectionTogglesChange ? <View style={styles.sourceList}>
                  {NOVEL_INJECTION_TOGGLE_OPTIONS.map((option, index) => {
                    const enabled = toggles[option.key];
                    return <View key={option.key} style={[styles.sourceRow, isCompact && styles.sourceRowCompact, { borderTopColor: theme.border }]}>
                      <View style={[styles.sourceIndex, isCompact && styles.sourceIndexCompact, { borderColor: enabled ? theme.accent : theme.border }]}><ThemedText type="code" themeColor={enabled ? 'accent' : 'textMuted'}>{String(index + 1).padStart(2, '0')}</ThemedText></View>
                      <View style={styles.switchCopy}><ThemedText type="smallBold">{option.label}</ThemedText><ThemedText type="small" themeColor="textMuted">{option.description}</ThemedText></View>
                      <View style={[styles.sourceState, isCompact && styles.sourceStateCompact]}><ThemedText type="code" themeColor={enabled ? 'accent' : 'textMuted'}>{enabled ? 'SEND' : 'MUTE'}</ThemedText><Switch value={enabled} onValueChange={(value) => updateToggle(option.key, value)} trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }} thumbColor={enabled ? theme.accent : theme.textMuted} accessibilityLabel={`${option.label}${enabled ? '已开启' : '已关闭'}`} /></View>
                    </View>;
                  })}
                </View> : <ThemedText type="small" themeColor="textMuted">当前会话没有可调整的注入源。</ThemedText>}
              </View>

              <View style={[styles.memoryDeck, { borderColor: theme.border, backgroundColor: theme.background }]}>
                <View style={styles.sectionHeading}>
                  <View style={styles.sectionNumber}><ThemedText type="code" themeColor="accent">02</ThemedText></View>
                  <View style={styles.sectionCopy}><ThemedText type="subtitle">记忆阶梯</ThemedText><ThemedText type="small" themeColor="textMuted">选择一层编辑；未展开的内容仍会完整保留。</ThemedText></View>
                </View>

                <View style={styles.memoryRail}>
                  {([
                    ['short', '近期', `${shortCount}/${SHORT_TERM_MEMORY_BATCH_SIZE}`, '每轮事实'],
                    ['mid', '过往', `${midCount}/${MID_TERM_MEMORY_BATCH_SIZE}`, '阶段压缩'],
                    ['long', '长期', longDraft.trim() ? '01' : '00', '稳定总结'],
                  ] as const).map(([tier, label, count, detail], index) => {
                    const selected = activeTier === tier;
                    return <Pressable key={tier} onPress={() => setActiveTier(tier)} style={[styles.tierButton, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accentMuted : theme.surface }]}>
                      <View style={styles.tierTopline}><ThemedText type="code" themeColor={selected ? 'accent' : 'textMuted'}>{count}</ThemedText><ThemedText type="code" themeColor="textMuted">0{index + 1}</ThemedText></View>
                      <ThemedText type="smallBold">{label}记忆</ThemedText><ThemedText type="small" themeColor="textMuted">{detail}</ThemedText>
                    </Pressable>;
                  })}
                </View>

                <View style={[styles.editorDeck, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                  <View style={styles.labelRow}>
                    <View style={styles.sectionCopy}>
                      <ThemedText type="code" themeColor="accent">{activeTier === 'short' ? 'RECENT BUFFER' : activeTier === 'mid' ? 'ARCHIVED BUFFER' : 'CANON SUMMARY'}</ThemedText>
                      <ThemedText type="smallBold">{activeTier === 'short' ? `近期记忆 · ${shortCount} 条` : activeTier === 'mid' ? `过往记忆 · ${midCount} 条` : '长期总结'}</ThemedText>
                    </View>
                    <Pressable onPress={() => activeTier === 'short' ? setShortDraft('') : activeTier === 'mid' ? setMidDraft('') : setLongDraft('')} hitSlop={8} style={({ pressed }) => [styles.clearTier, { borderColor: theme.border }, pressed && styles.pressed]}><ThemedText type="code" themeColor="accent">CLEAR</ThemedText></Pressable>
                  </View>
                  <ThemedText type="small" themeColor="textMuted">{activeTier === 'short' ? `每行一条：时间｜地点｜事件｜关系或物品变化。满 ${SHORT_TERM_MEMORY_BATCH_SIZE} 条进入过往。` : activeTier === 'mid' ? `每行一条阶段记忆。满 ${MID_TERM_MEMORY_BATCH_SIZE} 条后并入长期总结。` : '保留跨章节仍然有效的人物关系、关键事件、未决冲突和稳定状态。'}</ThemedText>
                  <TextInput
                    value={activeTier === 'short' ? shortDraft : activeTier === 'mid' ? midDraft : longDraft}
                    onChangeText={activeTier === 'short' ? setShortDraft : activeTier === 'mid' ? setMidDraft : setLongDraft}
                    multiline
                    placeholder={activeTier === 'short' ? '尚无近期记忆。' : activeTier === 'mid' ? '尚无过往记忆。' : '尚无长期总结。过往记忆满批后会自动写入。'}
                    placeholderTextColor={theme.textMuted}
                    style={[styles.input, { backgroundColor: theme.background, borderColor: theme.border, color: theme.text }]}
                  />
                </View>

                {onMergeNow ? <Pressable disabled={isSaving || isMerging || !canMerge} onPress={() => { void saveDraft(true); }} style={({ pressed }) => [styles.mergeButton, { borderColor: theme.accent, backgroundColor: theme.accentMuted, opacity: isMerging || !canMerge ? 0.42 : pressed ? 0.76 : 1 }]}>{isMerging ? <ActivityIndicator color={theme.accent} /> : <><View style={styles.mergeCopy}><ThemedText type="smallBold" themeColor="accent">推进一次记忆压缩</ThemedText><ThemedText type="small" themeColor="textMuted">近期 → 过往 → 长期；先保存当前编辑内容</ThemedText></View><ThemedText type="code" themeColor="accent">RUN ↗</ThemedText></>}</Pressable> : null}
              </View>
            </View>
          </ScrollView>

          <View style={[styles.actions, isCompact && styles.actionsCompact, isCompact && { paddingBottom: Math.max(Spacing.three, insets.bottom + Spacing.one) }, { borderTopColor: theme.border }]}>
            <Pressable onPress={() => { setLongDraft(''); setMidDraft(''); setShortDraft(''); }} style={[styles.secondaryButton, isCompact && styles.secondaryButtonCompact]}><ThemedText type="small" themeColor="textMuted">清空全部记忆</ThemedText></Pressable>
            <View style={[styles.actionGroup, isCompact && styles.actionGroupCompact]}>
              <Pressable onPress={onClose} style={[styles.cancelButton, { borderColor: theme.border }, isCompact && styles.actionButtonCompact]}><ThemedText type="smallBold" themeColor="textMuted">取消</ThemedText></Pressable>
              <Pressable disabled={isSaving} onPress={() => { void saveDraft(); }} style={({ pressed }) => [styles.saveButton, { backgroundColor: theme.accent }, isCompact && styles.actionButtonCompact, pressed && styles.pressed]}><ThemedText type="smallBold" style={styles.saveText}>保存上下文</ThemedText></Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </KeyboardSafeModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three },
  overlayCompact: { paddingHorizontal: 0, paddingVertical: 0, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(18, 14, 12, 0.48)' },
  card: { position: 'relative', alignSelf: 'center', width: '100%', maxWidth: 1180, maxHeight: '94%', borderWidth: 1, borderRadius: 6, overflow: 'hidden' },
  cardCompact: { height: '96%', maxHeight: '96%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  signalOrbit: { position: 'absolute', width: 280, height: 280, borderRadius: 140, borderWidth: 1, opacity: 0.14, right: -96, top: -170 },
  header: { minHeight: 116, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.four, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.five },
  headerCompact: { minHeight: 0, flexDirection: 'column', alignItems: 'stretch', gap: Spacing.two, padding: Spacing.three, paddingBottom: Spacing.two },
  headerCopy: { flex: 1, maxWidth: 680, gap: 4 },
  headerCopyCompact: { flex: 0, width: '100%', maxWidth: '100%', paddingRight: 64 },
  title: { fontSize: 28, lineHeight: 34 },
  titleCompact: { fontSize: 25, lineHeight: 31 },
  headerTelemetry: { alignItems: 'flex-end', gap: 4, paddingTop: 4 },
  headerTelemetryCompact: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.one, paddingTop: 4 },
  closeButton: { minWidth: 54, minHeight: 32, borderWidth: 1, borderRadius: 3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.one },
  closeButtonCompact: { position: 'absolute', right: Spacing.three, top: Spacing.three, minWidth: 50 },
  signalLine: { alignSelf: 'stretch', marginHorizontal: Spacing.four, height: 2, opacity: 0.7, transformOrigin: 'left center' },
  errorStrip: { marginHorizontal: Spacing.four, marginBottom: Spacing.two, borderWidth: 1, borderRadius: 3, padding: Spacing.two, gap: 3 },
  scroll: { flexGrow: 0 },
  scrollCompact: { flex: 1 },
  scrollContent: { padding: Spacing.four, paddingTop: Spacing.three },
  scrollContentCompact: { padding: Spacing.two, paddingTop: Spacing.two, paddingBottom: Spacing.three },
  workspace: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  workspaceCompact: { flexDirection: 'column' },
  routeDeck: { flex: 0.92, minWidth: 0, width: '100%', borderWidth: 1, borderRadius: 4, padding: Spacing.three, gap: Spacing.three },
  memoryDeck: { flex: 1.08, minWidth: 0, width: '100%', borderWidth: 1, borderRadius: 4, padding: Spacing.three, gap: Spacing.three },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  sectionNumber: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sectionCopy: { flex: 1, gap: 3 },
  memoryMaster: { minHeight: 96, borderWidth: 1, borderRadius: 4, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  memoryMasterCompact: { minHeight: 0, padding: Spacing.two, gap: Spacing.two },
  masterCopy: { flex: 1, gap: 3 },
  sourceList: { gap: 0 },
  sourceRow: { minHeight: 90, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two },
  sourceRowCompact: { minHeight: 78, alignItems: 'flex-start', gap: Spacing.one },
  sourceIndex: { width: 38, height: 38, borderWidth: 1, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sourceIndexCompact: { width: 32, height: 32, borderRadius: 16 },
  switchCopy: { flex: 1, gap: 2 },
  sourceState: { alignItems: 'flex-end', gap: 4 },
  sourceStateCompact: { minWidth: 52, alignItems: 'center', gap: 2 },
  memoryRail: { flexDirection: 'row', gap: Spacing.one },
  tierButton: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 4, padding: Spacing.two, gap: 3 },
  tierTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.one },
  editorDeck: { borderWidth: 1, borderRadius: 4, padding: Spacing.three, gap: Spacing.two },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  clearTier: { minWidth: 58, minHeight: 32, borderWidth: 1, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 218, borderWidth: 1, borderRadius: 3, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15, lineHeight: 23, textAlignVertical: 'top' },
  mergeButton: { minHeight: 64, borderWidth: 1, borderRadius: 4, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  mergeCopy: { flex: 1, gap: 2 },
  actions: { minHeight: 74, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  actionsCompact: { alignItems: 'stretch', flexDirection: 'column', minHeight: 0, gap: Spacing.one, paddingHorizontal: Spacing.two, paddingTop: Spacing.one },
  actionGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actionGroupCompact: { width: '100%' },
  secondaryButton: { minHeight: 40, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonCompact: { minHeight: 26, alignSelf: 'center' },
  cancelButton: { minHeight: 42, minWidth: 92, borderWidth: 1, borderRadius: 3, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  saveButton: { minHeight: 42, minWidth: 142, borderRadius: 3, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center' },
  actionButtonCompact: { flex: 1 },
  saveText: { color: '#120c09' },
  pressed: { opacity: 0.72 },
});
