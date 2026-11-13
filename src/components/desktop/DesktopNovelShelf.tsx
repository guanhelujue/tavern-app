import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Novel } from '@/types/tavern';
import { resolveNovelImageUri } from '@/utils/novel-images';

type Filter = 'all' | 'active' | 'draft';

export type DesktopNovelShelfProps = {
  novels: Novel[];
  onOpen: (novelId: string) => void;
  onDelete: (novelId: string) => void;
  onCreate: () => void;
  onImport: () => void;
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部作品' },
  { key: 'active', label: '创作中' },
  { key: 'draft', label: '草稿' },
];

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更新时间未知';
  return `更新于 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
}

export function DesktopNovelShelf({ novels, onOpen, onDelete, onCreate, onImport }: DesktopNovelShelfProps) {
  const theme = useTheme();
  const [contentWidth, setContentWidth] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const columns = contentWidth >= 1000 ? 3 : contentWidth >= 600 ? 2 : 1;
  const cardWidth = contentWidth ? (contentWidth - Spacing.four * (columns - 1)) / columns : 280;
  const visibleNovels = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return novels
      .filter((novel) => filter === 'all' || (filter === 'draft' ? novel.isDraft : !novel.isDraft))
      .filter((novel) => {
        if (!normalizedQuery) return true;
        return [novel.name, novel.worldName, novel.shortIntro, novel.detailedIntro]
          .join(' ')
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [filter, novels, query]);

  const chapterCount = novels.reduce((total, novel) => total + (novel.chapters?.length ?? 0), 0);
  const activeCount = novels.filter((novel) => !novel.isDraft).length;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.page} onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
          <View style={[styles.heroRow, contentWidth < 1040 && styles.heroCompact]}>
            <View style={styles.heroCopy}>
              <ThemedText type="title" style={styles.title}>我的作品</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                管理你的小说，继续上一次创作。
              </ThemedText>
            </View>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="创建作品"
                onPress={onCreate}
                style={({ pressed }) => [styles.primaryAction, { backgroundColor: theme.primary }, pressed && styles.pressed]}>
                <ThemedText style={{ color: theme.onPrimary, fontWeight: '700' }}>创建作品</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="导入备份" onPress={onImport} style={({ pressed }) => [styles.secondaryAction, { borderColor: theme.outlineVariant }, pressed && styles.pressed]}>
                <ThemedText>导入备份</ThemedText>
              </Pressable>
            </View>
          </View>

          <View style={[styles.stats, { borderTopColor: theme.outlineVariant, borderBottomColor: theme.outlineVariant }]}>
            <Stat label="作品总数" value={novels.length} theme={theme} />
            <Stat label="创作中" value={activeCount} theme={theme} />
            <Stat label="章节总数" value={chapterCount} theme={theme} />
          </View>

          <View style={styles.toolbar}>
            <View style={styles.filters}>
              {FILTERS.map((item) => {
                const selected = filter === item.key;
                return (
                  <Pressable key={item.key} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setFilter(item.key)} style={({ pressed }) => [styles.filter, selected && { backgroundColor: theme.primaryContainer }, pressed && styles.pressed]}>
                    <ThemedText type="smallBold" themeColor={selected ? 'onPrimaryContainer' : 'textSecondary'}>{item.label}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              accessibilityLabel="搜索作品"
              value={query}
              onChangeText={setQuery}
              placeholder="搜索作品、世界或简介"
              placeholderTextColor={theme.textSecondary}
              style={[styles.search, { color: theme.text, borderColor: theme.outlineVariant, backgroundColor: theme.surface }]}
              returnKeyType="search"
            />
          </View>

          {novels.length === 0 ? (
            <EmptyState title="书架还是空的" detail="填写世界名称与内容，进入工作台写作。" actionLabel="创建作品" onPress={onCreate} theme={theme} />
          ) : visibleNovels.length === 0 ? (
            <EmptyState title="没有匹配的作品" detail="换一个关键词，或清除筛选后继续浏览。" actionLabel="清除筛选" onPress={() => { setFilter('all'); setQuery(''); }} theme={theme} />
          ) : (
            <View style={styles.grid}>
              {visibleNovels.map((novel) => <NovelCard key={novel.id} novel={novel} width={cardWidth} onOpen={onOpen} onDelete={onDelete} theme={theme} />)}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, theme }: { label: string; value: number; theme: ReturnType<typeof useTheme> }) {
  return <View style={styles.stat}><ThemedText type="code" themeColor="textSecondary">{label}</ThemedText><ThemedText style={[styles.statValue, { color: theme.text }]}>{value}</ThemedText></View>;
}

function NovelCard({ novel, width, onOpen, onDelete, theme }: { novel: Novel; width: number; onOpen: (id: string) => void; onDelete: (id: string) => void; theme: ReturnType<typeof useTheme> }) {
  const [hovered, setHovered] = useState(false);
  const imageUri = resolveNovelImageUri(novel.coverImageUri);
  const description = novel.shortIntro || novel.detailedIntro || '还没有简介，从第一章开始塑造这个世界。';
  return (
    <View style={[styles.card, { width, backgroundColor: hovered ? theme.surfaceElevated : theme.surface, borderColor: hovered ? theme.primary : theme.outlineVariant }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`打开作品 ${novel.name}`} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPress={() => onOpen(novel.id)} style={({ pressed }) => [pressed && styles.cardPressed]}>
      <View style={[styles.cover, { backgroundColor: theme.primaryContainer }]}>
        {imageUri ? <Image source={{ uri: imageUri }} contentFit="cover" accessibilityLabel={`${novel.name}的封面`} style={StyleSheet.absoluteFill} /> : <View style={styles.coverFallback}><ThemedText style={[styles.coverLetter, { color: theme.onPrimaryContainer }]}>{novel.name.slice(0, 1) || '书'}</ThemedText><ThemedText type="code" themeColor="onPrimaryContainer" numberOfLines={1}>{novel.worldName || '未命名的世界'}</ThemedText></View>}
        {imageUri && <View style={styles.coverVeil} />}
        <ThemedText type="code" style={[styles.coverStatus, { color: theme.onPrimary, backgroundColor: theme.primary }]}>{novel.isDraft ? '草稿' : '创作中'}</ThemedText>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardHeading}><ThemedText type="subtitle" numberOfLines={1} style={styles.cardTitle}>{novel.name}</ThemedText><ThemedText type="code" themeColor="textSecondary">{formatUpdatedAt(novel.updatedAt)}</ThemedText></View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.description}>{description}</ThemedText>
        <View style={[styles.cardMeta, { borderTopColor: theme.outlineVariant }]}><ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={{ flex: 1 }}>{novel.worldName || '未命名世界'}</ThemedText><ThemedText type="code" themeColor="textSecondary">{novel.chapters?.length ?? 0} 章</ThemedText></View>
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`删除作品 ${novel.name}`} onPress={() => onDelete(novel.id)} style={({ pressed }) => [styles.deleteAction, { borderTopColor: theme.outlineVariant }, pressed && styles.pressed]}>
      <ThemedText type="small" style={{ color: theme.error }}>删除作品</ThemedText>
    </Pressable>
    </View>
  );
}

function EmptyState({ title, detail, actionLabel, onPress, theme }: { title: string; detail: string; actionLabel: string; onPress: () => void; theme: ReturnType<typeof useTheme> }) {
  return <View style={[styles.empty, { borderColor: theme.outlineVariant, backgroundColor: theme.surface }]}><View style={[styles.emptySignal, { backgroundColor: theme.primary }]} /><ThemedText type="subtitle">{title}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.emptyDetail}>{detail}</ThemedText><Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.secondaryAction, { borderColor: theme.outlineVariant }, pressed && styles.pressed]}><ThemedText type="smallBold">{actionLabel}</ThemedText></Pressable></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: 32 },
  page: { width: '100%', maxWidth: 1440, alignSelf: 'center', gap: Spacing.five },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.five, paddingTop: Spacing.four },
  heroCopy: { flex: 1, gap: Spacing.two },
  heroCompact: { flexDirection: 'column', alignItems: 'flex-start', gap: 20 },
  title: { fontSize: 34, lineHeight: 44 },
  subtitle: { maxWidth: 640, lineHeight: 24 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryAction: { minHeight: 46, paddingHorizontal: Spacing.four, borderRadius: Radius.small, alignItems: 'center', justifyContent: 'center' },
  secondaryAction: { minHeight: 46, paddingHorizontal: Spacing.three, borderRadius: Radius.small, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  stats: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, gap: Spacing.six },
  stat: { gap: Spacing.one, minWidth: 100 },
  statValue: { fontFamily: Fonts.serif, fontSize: 30, lineHeight: 34 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, flexWrap: 'wrap' },
  filters: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
  filter: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: Radius.small, justifyContent: 'center' },
  search: { height: 44, minWidth: 260, flexGrow: 1, maxWidth: 360, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.small, paddingHorizontal: Spacing.three, fontFamily: Fonts.sans },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  card: { minWidth: 0, maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.medium, overflow: 'hidden' },
  deleteAction: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'flex-end', borderTopWidth: StyleSheet.hairlineWidth },
  cardPressed: { opacity: 0.88, transform: [{ translateY: 1 }] },
  cover: { height: 190, position: 'relative', overflow: 'hidden' },
  coverFallback: { flex: 1, justifyContent: 'flex-end', padding: Spacing.four, gap: Spacing.two },
  coverLetter: { fontFamily: Fonts.serif, fontSize: 64, lineHeight: 76, opacity: 0.75 },
  coverVeil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20, 14, 10, 0.22)' },
  coverStatus: { position: 'absolute', right: Spacing.three, top: Spacing.three, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  cardBody: { padding: Spacing.three, gap: Spacing.two },
  cardHeading: { gap: Spacing.one },
  cardTitle: { fontSize: 24, lineHeight: 30 },
  description: { minHeight: 40, lineHeight: 20 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two },
  empty: { minHeight: 260, alignItems: 'center', justifyContent: 'center', padding: Spacing.five, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.medium, gap: Spacing.two },
  emptySignal: { width: 36, height: 4, marginBottom: Spacing.two },
  emptyDetail: { textAlign: 'center', maxWidth: 440, marginBottom: Spacing.two },
});
