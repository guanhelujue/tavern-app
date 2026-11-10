import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove, type NavigationProp } from 'expo-router/react-navigation';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { readNovelBlueprint } from '@/features/novel-creation/legacy-novel-adapter';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import type { NovelForeshadowing, NovelForeshadowingStatus } from '@/types/tavern';
import { importLegacyForeshadowings } from '@/utils/novel-foreshadowing-workspace';
import { confirmAppAction } from '@/utils/app-alert';
import { ThemedText } from '@/components/themed-text';

const newId = () => `foreshadow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const chapterNumber = (value: string) => /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;

function Field({ label, value, onChangeText, multiline = false, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  const theme = useTheme();
  return <View style={styles.field}>
    <ThemedText type="smallBold">{label}</ThemedText>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.textMuted} multiline={multiline} style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: theme.outlineVariant, backgroundColor: theme.surfaceVariant }]} />
  </View>;
}

export default function NovelForeshadowsScreen() {
  const params = useLocalSearchParams<{ novelId?: string }>();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const theme = useTheme();
  const navigation = useNavigation<NavigationProp<{ chapters: { chapterId?: string; inspirationId?: string } }>>();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const replace = useTavernStore((state) => state.replaceNovelForeshadowings);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NovelForeshadowing | null>(null);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);

  const items = novel?.foreshadowings ?? [];
  const legacyThreads = useMemo(() => (novel ? readNovelBlueprint(novel).longForm.openThreads.filter((item) => item.trim()) : []), [novel]);

  usePreventRemove(dirty, ({ data }) => {
    void confirmAppAction('未保存的伏笔', '确定放弃当前修改并离开？').then((confirmed) => {
      if (confirmed) navigation.dispatch(data.action);
    });
  });
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!novel) return <View style={[styles.center, { backgroundColor: theme.background }]}><ThemedText>小说不存在。</ThemedText></View>;

  const openEditor = async (item?: NovelForeshadowing) => {
    if (dirty && !await confirmAppAction('未保存的伏笔', '确定放弃当前修改？')) return;
    openEditorNow(item);
  };

  const closeEditor = async () => {
    if (dirty && !await confirmAppAction('未保存的伏笔', '确定放弃当前修改？')) return;
    setDraft(null); setSelectedId(null); setDirty(false);
  };

  const openEditorNow = (item?: NovelForeshadowing) => {
    setMessage('');
    setDirty(false);
    if (item) {
      setSelectedId(item.id);
      setDraft({ ...item });
      return;
    }
    const now = new Date().toISOString();
    const created: NovelForeshadowing = { id: newId(), keyword: '', description: '', status: 'open', plantedChapterIndex: 0, createdAt: now, note: '', locked: true };
    setSelectedId(created.id);
    setDraft(created);
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.keyword.trim() || !draft.description.trim()) {
      setMessage('请先填写伏笔关键词和描述。');
      return;
    }
    if (![draft.plantedChapterIndex, draft.dueAfterChapterIndex, draft.fulfilledChapterIndex].every((value) => value === undefined || (Number.isInteger(value) && value >= 0))) {
      setMessage('章节编号必须是非负整数。');
      return;
    }
    if (draft.dueAfterChapterIndex !== undefined && draft.dueAfterChapterIndex > 0 && draft.plantedChapterIndex > 0 && draft.dueAfterChapterIndex < draft.plantedChapterIndex) {
      setMessage('预计回收章节不能早于埋设章节。');
      return;
    }
    if (draft.fulfilledChapterIndex !== undefined && draft.fulfilledChapterIndex > 0 && draft.plantedChapterIndex > 0 && draft.fulfilledChapterIndex < draft.plantedChapterIndex) {
      setMessage('实际回收章节不能早于埋设章节。');
      return;
    }
    const latestItems = useTavernStore.getState().novels.find((item) => item.id === novel.id)?.foreshadowings ?? [];
    const latest = latestItems.find((item) => item.id === draft.id);
    const edited = { keyword: draft.keyword.trim(), description: draft.description.trim(), status: draft.status, plantedChapterIndex: draft.plantedChapterIndex, dueAfterChapterIndex: draft.dueAfterChapterIndex, fulfilledChapterIndex: draft.fulfilledChapterIndex, note: draft.note.trim(), locked: true };
    const saved = { ...(latest ?? draft), ...edited };
    const next = latest ? latestItems.map((item) => item.id === draft.id ? saved : item) : [...latestItems, saved];
    replace(novel.id, next);
    setDraft(saved);
    setMessage('已保存伏笔。');
    setDirty(false);
  };

  const removeDraft = async () => {
    if (!draft) return;
    if (!await confirmAppAction('删除伏笔', `确定删除“${draft.keyword || '未命名伏笔'}”吗？`)) return;
    const latestItems = useTavernStore.getState().novels.find((item) => item.id === novel.id)?.foreshadowings ?? [];
    replace(novel.id, latestItems.filter((item) => item.id !== draft.id)); setSelectedId(null); setDraft(null); setDirty(false); setMessage('已删除伏笔。');
  };

  const importLegacy = () => {
    const next = importLegacyForeshadowings(novel, items);
    if (next.length === items.length) { setMessage('没有新的旧版悬念可导入。'); return; }
    replace(novel.id, next);
    setMessage(`已导入 ${next.length - items.length} 条旧版悬念。`);
  };

  const updateStatus = (status: NovelForeshadowingStatus) => { setDirty(true); setDraft((current) => current ? { ...current, status, fulfilledChapterIndex: status === 'fulfilled' ? (current.fulfilledChapterIndex ?? (current.plantedChapterIndex || 0)) : current.fulfilledChapterIndex } : current); };
  const changeDraft = (updates: Partial<NovelForeshadowing>) => { setDirty(true); setDraft((current) => current ? { ...current, ...updates } : current); };

  return <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.topbar}><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} hitSlop={10}><ThemedText type="code" themeColor="accent">← 返回</ThemedText></Pressable><ThemedText type="code" themeColor="textMuted">FORESHADOWS / {novel.name}</ThemedText></View>
      <View style={styles.heading}><ThemedText type="title">伏笔账本</ThemedText><ThemedText type="small" themeColor="textSecondary">把要埋下、推进和回收的线索单独记下来，写作时会作为上下文提供给故事引擎。</ThemedText></View>

      {!!message && !draft && <ThemedText type="small" themeColor="success">{message}</ThemedText>}
      {legacyThreads.length > 0 && <View style={[styles.legacyCard, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
        <ThemedText type="subtitle">已有大纲悬念</ThemedText><ThemedText type="small" themeColor="textSecondary">旧版大纲里的长期悬念仍保留在大纲中；导入后才会进入伏笔账本。</ThemedText>
        {legacyThreads.map((thread) => <ThemedText key={thread} style={styles.thread}>· {thread}</ThemedText>)}
        <Pressable accessibilityRole="button" onPress={importLegacy} style={[styles.primaryButton, { backgroundColor: theme.buttonPrimary }]}><ThemedText style={{ color: theme.buttonText }}>导入到伏笔账本</ThemedText></Pressable>
      </View>}

      <View style={styles.toolbar}><ThemedText type="subtitle">手动伏笔</ThemedText><Pressable accessibilityRole="button" onPress={() => openEditor()} style={[styles.secondaryButton, { borderColor: theme.outline }]}><ThemedText themeColor="accent">＋ 新建伏笔</ThemedText></Pressable></View>
      {items.length === 0 && <View style={[styles.empty, { borderColor: theme.outlineVariant }]}><ThemedText themeColor="textSecondary">还没有伏笔。先记录一个你不想忘记的线索。</ThemedText></View>}
      {items.map((item) => <Pressable accessibilityRole="button" key={item.id} onPress={() => openEditor(item)} style={[styles.item, { backgroundColor: theme.surface, borderColor: item.id === selectedId ? theme.primary : theme.outlineVariant }]}>
        <View style={styles.itemHeader}><ThemedText type="smallBold">{item.keyword || '未命名伏笔'}</ThemedText><ThemedText type="code" themeColor={item.status === 'open' ? 'warning' : item.status === 'fulfilled' ? 'success' : 'textMuted'}>{item.status === 'open' ? '未回收' : item.status === 'fulfilled' ? '已回收' : '已放弃'}</ThemedText></View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{item.description}</ThemedText><ThemedText type="code" themeColor="textMuted">{item.plantedChapterIndex > 0 ? `第${item.plantedChapterIndex}章埋设` : '待埋设'}{item.dueAfterChapterIndex ? ` · 第${item.dueAfterChapterIndex}章后回收` : ''}</ThemedText>
      </Pressable>)}

      {draft && <View style={[styles.editor, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
        <View style={styles.toolbar}><ThemedText type="subtitle">编辑伏笔</ThemedText><Pressable accessibilityRole="button" onPress={() => void closeEditor()}><ThemedText themeColor="textMuted">关闭</ThemedText></Pressable></View>
        <Field label="关键词" value={draft.keyword} onChangeText={(value) => changeDraft({ keyword: value })} placeholder="例如：玉佩上的缺口" />
        <Field label="伏笔描述" value={draft.description} onChangeText={(value) => changeDraft({ description: value })} multiline placeholder="它暗示了什么，读者现在应该知道多少？" />
        <View style={styles.row}><View style={styles.half}><Field label="埋设章节（0=待埋设）" value={Number.isNaN(draft.plantedChapterIndex) ? '' : String(draft.plantedChapterIndex)} onChangeText={(value) => changeDraft({ plantedChapterIndex: chapterNumber(value) })} /></View><View style={styles.half}><Field label="预计回收章节" value={draft.dueAfterChapterIndex === undefined || Number.isNaN(draft.dueAfterChapterIndex) ? '' : String(draft.dueAfterChapterIndex)} onChangeText={(value) => changeDraft({ dueAfterChapterIndex: value.trim() ? chapterNumber(value) : undefined })} placeholder="可留空" /></View></View>
        <Field label="备注" value={draft.note} onChangeText={(value) => changeDraft({ note: value })} multiline placeholder="写作时需要注意的节奏、限制或回收方式" />
        <ThemedText type="smallBold">状态</ThemedText><View style={styles.statusRow}>{(['open', 'fulfilled', 'dropped'] as NovelForeshadowingStatus[]).map((status) => <Pressable accessibilityRole="button" key={status} onPress={() => updateStatus(status)} style={[styles.statusButton, { borderColor: draft.status === status ? theme.primary : theme.outlineVariant, backgroundColor: draft.status === status ? theme.primaryContainer : theme.surfaceVariant }]}><ThemedText type="small">{status === 'open' ? '未回收' : status === 'fulfilled' ? '已回收' : '已放弃'}</ThemedText></Pressable>)}</View>
        {draft.status === 'fulfilled' && <Field label="实际回收章节" value={draft.fulfilledChapterIndex === undefined || Number.isNaN(draft.fulfilledChapterIndex) ? '' : String(draft.fulfilledChapterIndex)} onChangeText={(value) => changeDraft({ fulfilledChapterIndex: value.trim() ? chapterNumber(value) : undefined })} placeholder="可留空" />}
        {!!message && <ThemedText type="small" themeColor="warning">{message}</ThemedText>}
        <View style={styles.actions}><Pressable accessibilityRole="button" onPress={saveDraft} style={[styles.primaryButton, { backgroundColor: theme.buttonPrimary }]}><ThemedText style={{ color: theme.buttonText }}>保存伏笔</ThemedText></Pressable><Pressable accessibilityRole="button" onPress={removeDraft} style={[styles.secondaryButton, { borderColor: theme.error }]}><ThemedText themeColor="error">删除</ThemedText></Pressable></View>
      </View>}

      <View style={[styles.contextCard, { borderColor: theme.outlineVariant }]}><ThemedText type="smallBold">账本概览</ThemedText><ThemedText type="small" themeColor="textSecondary">{items.filter((item) => item.status === 'open').length} 条未回收 · {items.filter((item) => item.status === 'fulfilled').length} 条已回收 · {items.filter((item) => item.status === 'dropped').length} 条已放弃</ThemedText></View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 }, content: { width: '100%', maxWidth: 1080, alignSelf: 'center', padding: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three }, topbar: { minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, heading: { gap: Spacing.one, paddingVertical: Spacing.three }, legacyCard: { borderWidth: 1, borderRadius: Radius.large, padding: Spacing.four, gap: Spacing.two }, thread: { lineHeight: 24 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, item: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.one, minWidth: 0 }, itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, empty: { borderWidth: 1, borderStyle: 'dashed', padding: Spacing.four, borderRadius: Radius.medium }, editor: { borderWidth: 1, borderRadius: Radius.large, padding: Spacing.four, gap: Spacing.three, minWidth: 0 }, field: { gap: Spacing.one, flex: 1, minWidth: 0 }, input: { minHeight: 44, width: '100%', borderWidth: 1, borderRadius: Radius.small, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, fontSize: 15 }, multiline: { minHeight: 92, textAlignVertical: 'top' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three }, half: { flex: 1, minWidth: 220 }, statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, statusButton: { minHeight: 44, justifyContent: 'center', borderWidth: 1, borderRadius: Radius.small, paddingHorizontal: Spacing.three }, actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, primaryButton: { minHeight: 44, borderRadius: Radius.small, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-start' }, secondaryButton: { minHeight: 44, borderWidth: 1, borderRadius: Radius.small, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'center' }, contextCard: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.one }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
