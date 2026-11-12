import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import { pickNovelTextFile, type ImportedNovelText } from '@/utils/novel-import';

export function NovelTextImportModal({ novelId, visible, onClose, onImported }: { novelId: string; visible: boolean; onClose: () => void; onImported?: () => void }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<ImportedNovelText | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirmRef = useRef(false);

  function reset() {
    setSelected(null);
    setBusy(false);
    setError('');
    confirmRef.current = false;
  }

  function close() {
    if (busy || confirmRef.current) return;
    reset();
    onClose();
  }

  async function choose() {
    setError('');
    if (busy) return;
    setBusy(true);
    try { setSelected(await pickNovelTextFile()); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取文件。'); } finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || confirmRef.current || !selected) return;
    confirmRef.current = true;
    setBusy(true); setError('');
    try {
      await useTavernStore.getState().importNovelText(novelId, selected);
      setSelected(null); onImported?.(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，请稍后重试。'); confirmRef.current = false; } finally { setBusy(false); }
  }

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close} onDismiss={reset}>
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.header}><View style={styles.headerCopy}><ThemedText type="subtitle">导入正文</ThemedText><ThemedText type="small" themeColor="textSecondary">追加到当前作品，原有章节不会被覆盖。</ThemedText></View><Pressable accessibilityRole="button" disabled={busy} onPress={close} style={[styles.button, busy && styles.disabled]}><ThemedText>关闭</ThemedText></Pressable></View>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">文件会按章节标题识别并作为已定稿章节追加。导入前请先处理草稿、生成任务和未整理聊天正文。</ThemedText>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void choose()} style={({ pressed }) => [styles.button, { borderColor: theme.outlineVariant }, pressed && styles.pressed, busy && styles.disabled]}><ThemedText type="smallBold">{busy ? '正在读取…' : '选择 TXT / Markdown 文件'}</ThemedText></Pressable>
        {selected && <View style={[styles.card, { borderColor: theme.outlineVariant }]}><ThemedText type="smallBold">{selected.fileName}</ThemedText><ThemedText type="small" themeColor="textSecondary">{selected.chapters.length} 章 · {selected.totalChars.toLocaleString()} 字</ThemedText>{selected.chapters.slice(0, 8).map((chapter, index) => <ThemedText key={`${chapter.title}-${index}`} type="small" numberOfLines={1}>{index + 1}. {chapter.title || '未命名章节'}</ThemedText>)}</View>}
        {error ? <ThemedText accessibilityRole="alert" style={{ color: theme.error }}>{error}</ThemedText> : null}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !selected || busy }} disabled={!selected || busy} onPress={() => void confirm()} style={({ pressed }) => [styles.primary, { backgroundColor: theme.primary }, (!selected || busy) && styles.disabled, pressed && styles.pressed]}>{busy ? <ActivityIndicator color={theme.onPrimary} /> : <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>确认追加正文</ThemedText>}</Pressable>
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, header: { minHeight: 96, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: StyleSheet.hairlineWidth }, headerCopy: { flex: 1, minWidth: 0, gap: 4 }, content: { padding: 20, gap: 16 }, button: { minHeight: 48, paddingHorizontal: 16, borderWidth: 1, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }, primary: { minHeight: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }, card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 }, disabled: { opacity: 0.5 }, pressed: { opacity: 0.75 } });
