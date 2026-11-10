import { SymbolView } from 'expo-symbols';
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NovelChapter } from '@/types/tavern';

type ChapterFilter = 'all' | 'draft' | 'final';

type Props = {
  name: string;
  worldName?: string;
  chapters: NovelChapter[];
  plannedCount: number;
  nextIndex: number;
  nextTitle?: string;
  busy: boolean;
  locked: boolean;
  notices?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onTools: () => void;
  onExport: () => void;
};

function chapterTitle(chapter: NovelChapter) {
  return chapter.title.replace(/^第[\d零一二三四五六七八九十百千万两〇]+[章节回]\s*[·.、:：\-—]?\s*/, '').trim() || `第 ${chapter.index} 章`;
}

function editedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1} 月 ${date.getDate()} 日更新`;
}

/** Native chapter overview. Keep the manuscript readable in a single vertical list. */
export function NovelMobileChapterHome({ name, worldName, chapters, plannedCount, nextIndex, nextTitle, busy, locked, notices, onOpen, onCreate, onImport, onTools, onExport }: Props) {
  const theme = useTheme();
  const [filter, setFilter] = useState<ChapterFilter>('all');
  const [query, setQuery] = useState('');
  const draft = chapters.find((chapter) => chapter.status === 'draft');
  const finalCount = chapters.filter((chapter) => chapter.status === 'final').length;
  const draftCount = chapters.length - finalCount;
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return chapters.filter((chapter) => (filter === 'all' || chapter.status === filter)
      && `${chapter.index} ${chapter.title}`.toLocaleLowerCase().includes(search))
      .sort((a, b) => b.index - a.index || b.createdAt.localeCompare(a.createdAt));
  }, [chapters, filter, query]);
  const tabs: { value: ChapterFilter; label: string; count: number }[] = [
    { value: 'all', label: '全部', count: chapters.length },
    { value: 'draft', label: '草稿', count: draftCount },
    { value: 'final', label: '已定稿', count: finalCount },
  ];
  const actionDisabled = busy || (locked && !draft);

  return <FlatList
    accessibilityLabel="章节目录"
    style={styles.list}
    contentContainerStyle={styles.content}
    data={visible}
    keyExtractor={(chapter) => chapter.id}
    keyboardShouldPersistTaps="handled"
    keyboardDismissMode="on-drag"
    initialNumToRender={12}
    windowSize={7}
    ListHeaderComponent={<View>
      <View style={styles.intro}>
        <ThemedText accessibilityRole="header" style={styles.bookTitle}>{name}</ThemedText>
        {worldName && worldName !== name ? <ThemedText themeColor="textSecondary">{worldName}</ThemedText> : null}
      </View>
      <View style={[styles.stats, { borderColor: theme.outlineVariant }]}>
        {[['已有章节', chapters.length], ['已定稿', finalCount], ['计划章节', plannedCount || '—']].map(([label, value]) => <View key={label} style={styles.stat}>
          <ThemedText style={styles.statValue}>{value}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
        </View>)}
      </View>
      <View style={[styles.continuePanel, { backgroundColor: theme.surfaceVariant }]}>
        <ThemedText type="small" themeColor="textSecondary">{draft ? `接着写 · 第 ${draft.index} 章` : chapters.length ? `下一章 · 第 ${nextIndex} 章` : '从第一章开始'}</ThemedText>
        <ThemedText style={styles.continueTitle}>{draft ? chapterTitle(draft) : nextTitle || (chapters.length ? '让故事继续' : '写下故事的开篇')}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: actionDisabled, busy }} disabled={actionDisabled}
          onPress={() => draft ? onOpen(draft.id) : onCreate()}
          style={({ pressed }) => [styles.continueButton, { backgroundColor: theme.primary }, pressed && styles.pressed, actionDisabled && styles.disabled]}>
          <ThemedText style={[styles.continueLabel, { color: theme.onPrimary }]}>{busy ? '正在生成…' : draft ? '继续写作' : chapters.length ? '写下一章' : '开始写作'}</ThemedText>
          <SymbolView accessible={false} name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={20} tintColor={theme.onPrimary} />
        </Pressable>
      </View>
      {notices ? <View style={styles.notices}>{notices}</View> : null}
      <View style={styles.directoryHeading}>
        <ThemedText accessibilityRole="header" style={styles.sectionTitle}>章节目录</ThemedText>
        <View style={styles.headingActions}>
          <Pressable accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} onPress={onImport} style={({ pressed }) => [styles.textButton, pressed && styles.pressed, locked && styles.disabled]}>
            <ThemedText type="smallBold" themeColor="primary">导入正文</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} onPress={onCreate} style={({ pressed }) => [styles.textButton, pressed && styles.pressed, locked && styles.disabled]}>
            <ThemedText type="smallBold" themeColor="primary">新章节</ThemedText>
          </Pressable>
        </View>
      </View>
      {chapters.length > 0 && <>
        <View style={[styles.tabs, { borderColor: theme.outlineVariant }]}>
          {tabs.map((tab) => <Pressable key={tab.value} accessibilityRole="tab" accessibilityState={{ selected: filter === tab.value }} onPress={() => setFilter(tab.value)}
            style={({ pressed }) => [styles.tab, { borderBottomColor: filter === tab.value ? theme.primary : 'transparent' }, pressed && styles.pressed]}>
            <ThemedText type={filter === tab.value ? 'smallBold' : 'small'} themeColor={filter === tab.value ? 'primary' : 'textSecondary'}>{tab.label} {tab.count}</ThemedText>
          </Pressable>)}
        </View>
        <View style={[styles.search, { backgroundColor: theme.surfaceVariant }]}>
          <SymbolView accessible={false} name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={20} tintColor={theme.textSecondary} />
          <TextInput accessibilityLabel="搜索章节标题或序号" placeholder="搜索章节标题或序号" placeholderTextColor={theme.textSecondary} value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false} style={[styles.searchInput, { color: theme.text }]} />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="清空章节搜索" onPress={() => setQuery('')} style={styles.clearSearch}><SymbolView accessible={false} name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={theme.textSecondary} /></Pressable> : null}
        </View>
      </>}
    </View>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`打开第 ${item.index} 章 ${chapterTitle(item)}，${item.status === 'final' ? '已定稿' : '草稿'}`} accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => onOpen(item.id)}
      style={({ pressed }) => [styles.chapter, { borderBottomColor: theme.outlineVariant }, pressed && { backgroundColor: theme.surfaceVariant }, busy && styles.disabled]}>
      <ThemedText accessible={false} style={styles.chapterIndex} themeColor="primary">{String(item.index).padStart(2, '0')}</ThemedText>
      <View style={styles.chapterCopy}>
        <ThemedText style={styles.chapterTitle}>{chapterTitle(item)}</ThemedText>
        {item.summary ? <ThemedText numberOfLines={1} type="small" themeColor="textSecondary">{item.summary}</ThemedText> : null}
        <View style={styles.metadata}>
          <ThemedText type="small" themeColor={item.status === 'draft' ? 'primary' : 'textSecondary'}>{item.status === 'final' ? '已定稿' : '草稿'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{editedDate(item.updatedAt)}</ThemedText>
        </View>
      </View>
      <SymbolView accessible={false} name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={20} tintColor={theme.textSecondary} />
    </Pressable>}
    ListEmptyComponent={<View style={styles.empty}>
      <ThemedText style={styles.emptyTitle}>{chapters.length ? '没有找到章节' : '故事，正待落笔'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{chapters.length ? '试试其他关键词，或切换章节状态。' : '从第一章开始创作，\n也可以导入已有正文，继续你的故事。'}</ThemedText>
      {chapters.length > 0 && <Pressable accessibilityRole="button" onPress={() => { setQuery(''); setFilter('all'); }} style={styles.textButton}><ThemedText themeColor="primary">查看全部章节</ThemedText></Pressable>}
    </View>}
    ListFooterComponent={<View style={styles.footer}>
      <ThemedText type="small" themeColor="textSecondary">{chapters.length ? '最新章节在前' : '创作工具'}</ThemedText>
      <View style={styles.footerActions}>
        <Pressable accessibilityRole="button" onPress={onTools} style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}><ThemedText type="small" themeColor="primary">任务与导出</ThemedText></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={onExport} style={({ pressed }) => [styles.textButton, pressed && styles.pressed, busy && styles.disabled]}><ThemedText type="small" themeColor="primary">备份作品</ThemedText></Pressable>
      </View>
    </View>}
  />;
}

const styles = StyleSheet.create({
  list: { flex: 1, width: '100%' }, content: { paddingHorizontal: 24, paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' },
  intro: { paddingTop: 24, paddingBottom: 20, gap: 8 }, bookTitle: { fontFamily: Fonts.serif, fontSize: 32, lineHeight: 44, fontWeight: '600' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, paddingBottom: 20, marginBottom: 20, borderBottomWidth: StyleSheet.hairlineWidth }, stat: { flexGrow: 1, minWidth: 72, gap: 4 }, statValue: { fontSize: 24, lineHeight: 32, fontVariant: ['tabular-nums'] },
  continuePanel: { borderRadius: 18, padding: 16, gap: 8 }, continueTitle: { fontFamily: Fonts.serif, fontSize: 22, lineHeight: 32 }, continueButton: { minHeight: 48, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 }, continueLabel: { flex: 1, fontWeight: '600' },
  notices: { marginTop: 20, gap: 12 }, directoryHeading: { paddingTop: 20, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8 }, sectionTitle: { fontFamily: Fonts.serif, fontSize: 23, lineHeight: 32, flexGrow: 1 }, headingActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  textButton: { minHeight: 48, minWidth: 48, paddingVertical: 12, paddingHorizontal: 4, justifyContent: 'center' }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, borderBottomWidth: StyleSheet.hairlineWidth }, tab: { minHeight: 48, justifyContent: 'center', borderBottomWidth: 2, paddingVertical: 12, minWidth: 48 },
  search: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingLeft: 14, marginTop: 12, marginBottom: 4, gap: 10 }, searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontFamily: Fonts.sans, fontSize: 16, paddingVertical: 12 }, clearSearch: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  chapter: { minHeight: 100, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth }, chapterIndex: { fontSize: 20, lineHeight: 30, fontVariant: ['tabular-nums'], minWidth: 30, alignSelf: 'flex-start', paddingTop: 1 }, chapterCopy: { flex: 1, minWidth: 0, gap: 6 }, chapterTitle: { fontSize: 18, lineHeight: 28, fontWeight: '600' }, metadata: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  empty: { paddingVertical: 36, gap: 12 }, emptyTitle: { fontFamily: Fonts.serif, fontSize: 23, lineHeight: 34 }, emptyCopy: { lineHeight: 24 }, footer: { paddingTop: 20, gap: 8 }, footerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.45 },
});
