import { Image } from 'expo-image';
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { MobileAction, MobileEmptyState, MobileIcon, MobileSegmentedTabs } from '@/components/mobile/MobileUI';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NovelChapter } from '@/types/tavern';
import { resolveNovelImageUri } from '@/utils/novel-images';

type ChapterFilter = 'all' | 'draft' | 'final';
type Props = {
  name: string; worldName?: string; coverUri?: string; chapters: NovelChapter[]; plannedCount: number;
  nextIndex: number; nextTitle?: string; busy: boolean; locked: boolean; notices?: ReactNode;
  onOpen: (id: string) => void; onCreate: () => void; onImport: () => void; onTools: () => void; onExport: () => void;
};

function chapterTitle(chapter: NovelChapter) {
  return chapter.title.replace(/^第[\d零一二三四五六七八九十百千万两〇]+[章节回]\s*[·.、:：\-—]?\s*/, '').trim() || '第 ' + chapter.index + ' 章';
}
function editedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日更新';
}

export function NovelMobileChapterHome({ name, worldName, coverUri, chapters, plannedCount, nextIndex, nextTitle, busy, locked, notices, onOpen, onCreate, onImport, onTools, onExport }: Props) {
  const theme = useTheme();
  const [filter, setFilter] = useState<ChapterFilter>('all');
  const [query, setQuery] = useState('');
  const draft = chapters.find(chapter => chapter.status === 'draft');
  const finalCount = chapters.filter(chapter => chapter.status === 'final').length;
  const draftCount = chapters.length - finalCount;
  const imageUri = resolveNovelImageUri(coverUri);
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return chapters.filter(chapter => (filter === 'all' || chapter.status === filter) && (chapter.index + ' ' + chapter.title).toLocaleLowerCase().includes(search))
      .sort((a, b) => b.index - a.index || b.createdAt.localeCompare(a.createdAt));
  }, [chapters, filter, query]);
  const tabs: { value: ChapterFilter; label: string }[] = [
    { value: 'all', label: '全部 ' + chapters.length }, { value: 'draft', label: '草稿 ' + draftCount }, { value: 'final', label: '已定稿 ' + finalCount },
  ];
  const actionDisabled = busy || (locked && !draft);

  return <FlatList accessibilityLabel="章节目录" style={styles.list} contentContainerStyle={styles.content} data={visible} keyExtractor={chapter => chapter.id}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" initialNumToRender={12} windowSize={7}
    ListHeaderComponent={<View>
      <View style={styles.identity}>
        {imageUri ? <Image source={{ uri: imageUri }} contentFit="cover" style={styles.cover} accessibilityLabel={name + '封面'} /> : <View style={[styles.cover, styles.coverFallback, { backgroundColor: theme.primaryContainer }]}><MobileIcon name={{ ios: 'book.closed', android: 'auto_stories', web: 'auto_stories' }} size={25} /></View>}
        <View style={styles.identityCopy}><ThemedText accessibilityRole="header" style={styles.bookTitle}>{name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{chapters.length} 章 · {finalCount} 章已定稿{plannedCount ? ' · 计划 ' + plannedCount + ' 章' : ''}</ThemedText>
          {worldName && worldName !== name ? <ThemedText numberOfLines={1} type="small" themeColor="textSecondary">{worldName}</ThemedText> : null}
        </View>
      </View>
      <View style={[styles.continuePanel, { backgroundColor: theme.primaryContainer }]}>
        <View style={styles.continueHeading}><MobileIcon name={{ ios: 'pencil.line', android: 'edit_note', web: 'edit_note' }} size={20} /><ThemedText type="small" themeColor="primary">{draft ? '接着写 · 第 ' + draft.index + ' 章' : chapters.length ? '下一章 · 第 ' + nextIndex + ' 章' : '从第一章开始'}</ThemedText></View>
        <ThemedText style={styles.continueTitle}>{draft ? chapterTitle(draft) : nextTitle || (chapters.length ? '让故事继续' : '写下故事的开篇')}</ThemedText>
        <View style={styles.continueBottom}><ThemedText type="small" themeColor="textSecondary" style={styles.continueHint}>{busy ? '正在生成，请稍候' : draft ? '草稿已保存' : '让想法成为故事'}</ThemedText>
          <MobileAction label={busy ? '正在生成…' : draft ? '继续写作' : chapters.length ? '写下一章' : '开始写作'} onPress={() => draft ? onOpen(draft.id) : onCreate()} disabled={actionDisabled} icon={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} />
        </View>
      </View>
      {notices ? <View style={styles.notices}>{notices}</View> : null}
      <View style={styles.directoryHeading}>
        <ThemedText accessibilityRole="header" style={styles.sectionTitle}>章节目录</ThemedText>
        <View style={styles.headingActions}>
          <MobileAction label="导入正文" variant="text" onPress={onImport} disabled={locked} />
          <MobileAction label="新章节" variant="text" onPress={onCreate} disabled={locked} icon={{ ios: 'plus', android: 'add', web: 'add' }} />
        </View>
      </View>
      {chapters.length > 0 ? <View style={styles.filters}>
        <MobileSegmentedTabs items={tabs} value={filter} onChange={setFilter} />
        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
          <MobileIcon name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={20} color={theme.textSecondary} />
          <TextInput accessibilityLabel="搜索章节标题或序号" placeholder="搜索章节" placeholderTextColor={theme.textSecondary} value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false} style={[styles.searchInput, { color: theme.text }]} />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空章节搜索" onPress={() => setQuery('')} style={styles.clearSearch}><MobileIcon name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} color={theme.textSecondary} /></Pressable> : null}
        </View>
      </View> : null}
    </View>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={'打开第 ' + item.index + ' 章 ' + chapterTitle(item) + '，' + (item.status === 'final' ? '已定稿' : '草稿')} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onOpen(item.id)}
      style={({ pressed }) => [styles.chapter, { borderBottomColor: theme.outlineVariant }, pressed && { backgroundColor: theme.surfaceVariant }, busy && styles.disabled]}>
      <ThemedText accessible={false} style={styles.chapterIndex} themeColor="textSecondary">{String(item.index).padStart(2, '0')}</ThemedText>
      <View style={styles.chapterCopy}>
        <View style={styles.chapterHeading}><ThemedText numberOfLines={2} style={styles.chapterTitle}>{chapterTitle(item)}</ThemedText><View style={[styles.badge, { backgroundColor: item.status === 'draft' ? theme.primaryContainer : theme.surfaceVariant }]}><ThemedText style={styles.badgeLabel} themeColor={item.status === 'draft' ? 'primary' : 'textSecondary'}>{item.status === 'final' ? '已定稿' : '草稿'}</ThemedText></View></View>
        {item.summary ? <ThemedText numberOfLines={1} type="small" themeColor="textSecondary">{item.summary}</ThemedText> : <ThemedText type="small" themeColor="textSecondary">{editedDate(item.updatedAt)}</ThemedText>}
      </View>
      <MobileIcon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={18} color={theme.textSecondary} />
    </Pressable>}
    ListEmptyComponent={<MobileEmptyState title={chapters.length ? '没有找到章节' : '故事，正待落笔'} description={chapters.length ? '试试其他关键词，或切换章节状态。' : '写下第一章，也可以导入已有正文，继续你的故事。'} action={chapters.length ? <MobileAction label="查看全部章节" variant="text" onPress={() => { setQuery(''); setFilter('all'); }} /> : undefined} />}
    ListFooterComponent={<View style={[styles.footer, { borderTopColor: theme.outlineVariant }]}>
      <MobileAction label="任务与导出" variant="text" onPress={onTools} icon={{ ios: 'doc.badge.arrow.up', android: 'file_upload', web: 'file_upload' }} />
      <MobileAction label="备份作品" variant="text" onPress={onExport} disabled={busy} icon={{ ios: 'square.stack.3d.up', android: 'layers', web: 'layers' }} />
    </View>}
  />;
}

const styles = StyleSheet.create({
  list: { flex: 1, width: '100%' }, content: { paddingHorizontal: 20, paddingBottom: 24, width: '100%', maxWidth: 720, alignSelf: 'center' },
  identity: { paddingTop: 20, paddingBottom: 20, flexDirection: 'row', gap: 14, alignItems: 'center' }, identityCopy: { flex: 1, minWidth: 0, gap: 4 }, cover: { width: 44, height: 60, borderRadius: 8 }, coverFallback: { justifyContent: 'center', alignItems: 'center' }, bookTitle: { fontFamily: Fonts.serif, fontSize: 26, lineHeight: 36, fontWeight: '600' },
  continuePanel: { borderRadius: 14, padding: 16, gap: 8 }, continueHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 }, continueTitle: { fontFamily: Fonts.serif, fontSize: 22, lineHeight: 32, fontWeight: '600' }, continueBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, continueHint: { flexGrow: 1 },
  notices: { marginTop: 16, gap: 12 }, directoryHeading: { paddingTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 }, sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700', flexGrow: 1 }, headingActions: { flexDirection: 'row', gap: 12 }, filters: { gap: 12, marginTop: 4, marginBottom: 6 },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingLeft: 12, gap: 8 }, searchInput: { flex: 1, minWidth: 0, minHeight: 44, fontFamily: Fonts.sans, fontSize: 15, paddingVertical: 10 }, clearSearch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chapter: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth }, chapterIndex: { fontSize: 18, lineHeight: 28, fontVariant: ['tabular-nums'], minWidth: 26 }, chapterCopy: { flex: 1, minWidth: 0, gap: 6 }, chapterHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }, chapterTitle: { flex: 1, minWidth: 100, fontSize: 16, lineHeight: 24, fontWeight: '700' }, badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }, badgeLabel: { fontSize: 12, lineHeight: 18 },
  footer: { marginTop: 20, paddingTop: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, borderTopWidth: StyleSheet.hairlineWidth }, disabled: { opacity: 0.45 },
});
