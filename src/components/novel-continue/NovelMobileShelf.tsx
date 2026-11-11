import { Image } from 'expo-image';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { MobileAction, MobileEmptyState, MobileIcon } from '@/components/mobile/MobileUI';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
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
  if (Number.isNaN(date.getTime())) return '最近编辑';
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' 更新';
}

function NovelRow({ novel, featured, onOpen, onDelete }: { novel: Novel; featured: boolean; onOpen: () => void; onDelete: () => void }) {
  const theme = useTheme();
  const coverUri = resolveNovelImageUri(novel.coverImageUri);
  const chapterCount = novel.chapters?.length ?? 0;
  function showActions() {
    Alert.alert(novel.name, '作品操作', [
      { text: '进入工作台', onPress: onOpen },
      { text: '删除作品', style: 'destructive', onPress: onDelete },
      { text: '取消', style: 'cancel' },
    ]);
  }

  return <View style={[styles.row, { borderBottomColor: theme.outlineVariant }, featured && [styles.featured, { backgroundColor: theme.primaryContainer }]]}>
    <Pressable accessibilityRole="button" accessibilityLabel={'打开作品 ' + novel.name} onPress={onOpen} style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
      {coverUri ? <Image source={{ uri: coverUri }} contentFit="cover" style={[styles.cover, featured && styles.featuredCover]} accessibilityLabel={novel.name + '封面'} /> : <View style={[styles.cover, styles.coverPlaceholder, featured && styles.featuredCover, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
        <MobileIcon name={{ ios: 'book.closed', android: 'auto_stories', web: 'auto_stories' }} size={24} />
        <ThemedText numberOfLines={2} style={[styles.coverLetter, { color: theme.primary }]}>{novel.name.trim().slice(0, 2) || '作品'}</ThemedText>
      </View>}
      <View style={styles.copy}>
        {featured ? <ThemedText type="small" themeColor="primary">最近编辑</ThemedText> : null}
        <ThemedText numberOfLines={2} style={[styles.title, featured && styles.featuredTitle]}>{novel.name}</ThemedText>
        {novel.worldName && novel.worldName !== novel.name ? <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{novel.worldName}</ThemedText> : null}
        <ThemedText type="small" themeColor="textSecondary">{chapterCount} 章 · {novel.isDraft ? '草稿' : formatUpdatedAt(novel.updatedAt)}</ThemedText>
        {featured ? <View style={styles.openLink}><ThemedText type="smallBold" themeColor="primary">进入工作台</ThemedText><MobileIcon name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }} size={18} /></View> : null}
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={novel.name + '的更多操作'} onPress={showActions} style={({ pressed }) => [styles.more, pressed && styles.pressed]}><MobileIcon name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} color={theme.textSecondary} /></Pressable>
  </View>;
}

export function NovelMobileShelf({ novels, onOpen, onDelete, onCreate, onImport }: Props) {
  const theme = useTheme();
  const sortedNovels = [...novels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return <FlatList style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} data={sortedNovels} keyExtractor={(novel) => novel.id}
    renderItem={({ item, index }) => <NovelRow novel={item} featured={index === 0} onOpen={() => onOpen(item.id)} onDelete={() => onDelete(item.id)} />}
    ListHeaderComponent={<View>
      <View style={styles.brandRow}><View style={styles.brand}><MobileIcon name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }} size={26} /><ThemedText style={styles.brandName}>酒馆</ThemedText></View>
        <Pressable accessibilityRole="button" accessibilityLabel="恢复作品档案" onPress={onImport} style={({ pressed }) => [styles.more, pressed && styles.pressed]}><MobileIcon name={{ ios: 'archivebox', android: 'inventory_2', web: 'inventory_2' }} /></Pressable>
      </View>
      <View style={styles.header}>
        <View style={styles.headerCopy}><ThemedText accessibilityRole="header" style={styles.heading}>作品库</ThemedText><ThemedText type="small" themeColor="textSecondary">让故事继续生长</ThemedText></View>
        <MobileAction label="创建作品" onPress={onCreate} icon={{ ios: 'plus', android: 'add', web: 'add' }} />
      </View>
    </View>}
    ListEmptyComponent={<MobileEmptyState title="故事，正待落笔" description="从一个世界开始，慢慢写成你的第一部作品。" icon={{ ios: 'book', android: 'menu_book', web: 'menu_book' }} />}
    ListFooterComponent={<Pressable accessibilityRole="button" onPress={onImport} style={({ pressed }) => [styles.importButton, { borderTopColor: theme.outlineVariant }, pressed && styles.pressed]}>
      <View style={[styles.importIcon, { backgroundColor: theme.primaryContainer }]}><MobileIcon name={{ ios: 'arrow.counterclockwise', android: 'restore', web: 'restore' }} /></View>
      <View style={styles.copy}><ThemedText style={styles.importTitle}>恢复作品档案</ThemedText><ThemedText type="small" themeColor="textSecondary">从备份继续创作</ThemedText></View>
      <MobileIcon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={20} color={theme.textSecondary} />
    </Pressable>}
  />;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, width: '100%' }, content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28, width: '100%', maxWidth: 720, alignSelf: 'center' },
  brandRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, brandName: { fontFamily: Fonts.serif, fontSize: 22, lineHeight: 30, fontWeight: '600' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 24 }, headerCopy: { flexGrow: 1, flexBasis: 140, gap: 6 },
  heading: { fontFamily: Fonts.serif, fontSize: 32, lineHeight: 42, fontWeight: '600' },
  row: { minHeight: 128, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  featured: { padding: 14, borderRadius: 16, borderBottomWidth: 0, marginBottom: 8, gap: 0 },
  rowMain: { flex: 1, minWidth: 0, minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 14 },
  cover: { width: 64, height: 88, borderRadius: 10 }, featuredCover: { width: 76, height: 108 },
  coverPlaceholder: { borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 8 },
  coverLetter: { fontFamily: Fonts.serif, fontSize: 15, lineHeight: 22, textAlign: 'center' }, copy: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontFamily: Fonts.serif, fontSize: 20, lineHeight: 28, fontWeight: '600' }, featuredTitle: { fontSize: 23, lineHeight: 32 },
  more: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, openLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 5 },
  importButton: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20, marginTop: 20, borderTopWidth: StyleSheet.hairlineWidth }, importIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }, importTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
