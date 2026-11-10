import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Novel } from '@/types/tavern';
import { resolveNovelImageUri } from '@/utils/novel-images';

type Props = {
  novels: Novel[];
  onOpen: (novelId: string) => void;
  onDelete: (novelId: string) => void;
  onCreate: () => void;
  onImport: () => void;
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '最近更新';
  return `更新于 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
}

function NovelRow({ novel, onOpen, onDelete }: { novel: Novel; onOpen: () => void; onDelete: () => void }) {
  const theme = useTheme();
  const coverUri = resolveNovelImageUri(novel.coverImageUri);
  const chapterCount = novel.chapters?.length ?? 0;

  return <View style={[styles.row, { borderBottomColor: theme.outlineVariant }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`打开作品 ${novel.name}`} onPress={onOpen} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
      {coverUri ? <Image source={{ uri: coverUri }} contentFit="cover" style={styles.cover} accessibilityLabel={`${novel.name}封面`} /> : <View style={[styles.cover, styles.coverPlaceholder, { backgroundColor: theme.surfaceVariant }]}><ThemedText style={[styles.coverLetter, { color: theme.primary }]}>{novel.name.trim().slice(0, 1) || '作'}</ThemedText></View>}
      <View style={styles.copy}>
        <ThemedText style={styles.title}>{novel.name}</ThemedText>
        {novel.worldName && novel.worldName !== novel.name ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{novel.worldName}</ThemedText> : null}
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">{chapterCount} 章</ThemedText>
          {novel.isDraft ? <ThemedText type="small" themeColor="primary">草稿</ThemedText> : null}
          <ThemedText type="small" themeColor="textSecondary">{formatUpdatedAt(novel.updatedAt)}</ThemedText>
        </View>
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`删除作品 ${novel.name}`} onPress={onDelete} style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}><ThemedText type="small" themeColor="textSecondary">删除</ThemedText></Pressable>
  </View>;
}

export function NovelMobileShelf({ novels, onOpen, onDelete, onCreate, onImport }: Props) {
  const theme = useTheme();
  const sortedNovels = [...novels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return <FlatList style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} data={sortedNovels} keyExtractor={(novel) => novel.id}
    renderItem={({ item }) => <NovelRow novel={item} onOpen={() => onOpen(item.id)} onDelete={() => onDelete(item.id)} />}
    ListHeaderComponent={<View style={styles.header}>
      <View style={styles.headerCopy}>
        <ThemedText accessibilityRole="header" style={styles.heading}>作品库</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{novels.length ? `${novels.length} 部作品，继续你的创作` : '从一个世界开始，慢慢写成一本小说'}</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="创建作品" onPress={onCreate} style={({ pressed }) => [styles.createButton, { backgroundColor: theme.primary }, pressed && styles.pressed]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>创建作品</ThemedText></Pressable>
    </View>}
    ListEmptyComponent={<View style={[styles.empty, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}><ThemedText style={styles.emptyTitle}>还没有作品</ThemedText><ThemedText type="small" themeColor="textSecondary">填写世界和故事基础，开始你的第一部作品。</ThemedText></View>}
    ListFooterComponent={<Pressable accessibilityRole="button" onPress={onImport} style={({ pressed }) => [styles.importButton, pressed && styles.pressed]}><ThemedText type="smallBold" themeColor="primary">恢复完整档案</ThemedText><ThemedText type="small" themeColor="textSecondary">从 JSON 备份导入作品</ThemedText></Pressable>}
  />;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, width: '100%' }, content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.five, paddingBottom: Spacing.six, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.four },
  headerCopy: { flexGrow: 1, flexBasis: 160, gap: Spacing.two },
  heading: { fontFamily: Fonts.serif, fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: -0.6 },
  createButton: { minHeight: 48, paddingHorizontal: 18, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 128, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  rowMain: { flex: 1, minWidth: 0, minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cover: { width: 64, height: 88, borderRadius: 10 },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverLetter: { fontFamily: Fonts.serif, fontSize: 30, lineHeight: 38 },
  copy: { flex: 1, minWidth: 0, gap: Spacing.one },
  title: { fontFamily: Fonts.serif, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  deleteButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  empty: { borderWidth: 1, borderRadius: 16, padding: Spacing.four, gap: Spacing.two },
  emptyTitle: { fontFamily: Fonts.serif, fontSize: 22, lineHeight: 30, fontWeight: '600' },
  importButton: { minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingVertical: Spacing.three, marginTop: Spacing.three },
  pressed: { opacity: 0.72 },
});
