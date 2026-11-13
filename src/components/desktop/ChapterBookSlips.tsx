import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { useTheme } from '@/hooks/use-theme';
import type { NovelChapter } from '@/types/tavern';

function chapterNumber(index: number) {
  if (index < 1 || index >= 1000) return String(index);
  const digits = '零一二三四五六七八九';
  if (index < 10) return digits[index];
  if (index < 100) return `${index < 20 ? '' : digits[Math.floor(index / 10)]}十${index % 10 ? digits[index % 10] : ''}`;
  const remainder = index % 100;
  return `${digits[Math.floor(index / 100)]}百${remainder ? remainder < 10 ? `零${digits[remainder]}` : `${digits[Math.floor(remainder / 10)]}十${remainder % 10 ? digits[remainder % 10] : ''}` : ''}`;
}

function chapterName(chapter: NovelChapter) {
  return chapter.title.replace(/^第[\d零一二三四五六七八九十百千万两〇]+[章节回]\s*[·.、:：\-—]?\s*/, '').trim() || '未命名';
}

function BookSlip({ title, label, accessibleLabel, height, create = false, disabled, onPress }: {
  title: string; label: string; accessibleLabel: string; height: number; create?: boolean; disabled: boolean; onPress: () => void;
}) {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const characters = Array.from(title.replace(/\s/g, ''));
  const columnLength = Math.max(5, Math.min(10, Math.floor((height - 180) / 34)));
  const limit = Math.min(24, columnLength * 3);
  const visible = characters.length > limit ? [...characters.slice(0, limit - 1), '…'] : characters;
  const columns: string[] = [];
  for (let offset = 0; offset < visible.length; offset += columnLength) columns.push(visible.slice(offset, offset + columnLength).join('\n'));
  const emphasized = create || focused || hovered;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibleLabel} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.slip, { width: desktop ? 158 : 132, height, borderColor: emphasized ? theme.primary : theme.outlineVariant, backgroundColor: create ? theme.primaryContainer : theme.surface }, (focused || hovered) && styles.highlighted, (pressed || disabled) && styles.disabled]}>
    <View pointerEvents="none" style={[styles.binding, { borderColor: theme.outlineVariant }]} />
    <View style={[styles.endRule, { borderColor: emphasized ? theme.primary : theme.outlineVariant }]} />
    <ThemedText style={[styles.chapterNumber, { color: create ? theme.primary : theme.text }]}>{label}</ThemedText>
    <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />
    <View style={styles.verticalTitle}>{columns.map((column, index) => <ThemedText key={index} style={[styles.titleColumn, { color: create ? theme.primary : theme.text }, columns.length > 2 && styles.longTitle]}>{column}</ThemedText>)}</View>
    <View style={[styles.endRule, styles.bottomRule, { borderColor: emphasized ? theme.primary : theme.outlineVariant }]} />
  </Pressable>;
}

export function ChapterBookSlips({ chapters, locked, onCreate, onOpen }: {
  chapters: NovelChapter[]; locked: boolean; onCreate: () => void; onOpen: (id: string) => void;
}) {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const { height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const [search, setSearch] = useState('');
  const sorted = [...chapters].sort((a, b) => b.index - a.index || b.createdAt.localeCompare(a.createdAt));
  const visible = sorted.filter((chapter) => `${chapter.index} ${chapter.title}`.toLowerCase().includes(search.trim().toLowerCase()));
  const slipHeight = Math.max(360, Math.min(610, height - (desktop ? 300 : 240)));
  return <View style={styles.root}>
    <View style={[styles.toolbar, !desktop && styles.compactToolbar]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>点击书简，进入章节写作。</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">最新在前</ThemedText>
      <TextInput accessibilityLabel="搜索章节" value={search} onChangeText={(value) => { setSearch(value); scrollRef.current?.scrollTo({ x: 0, animated: false }); }} placeholder="搜索章节…" placeholderTextColor={theme.textMuted} style={[styles.search, { color: theme.text, borderColor: theme.outlineVariant, backgroundColor: theme.surface }]} />
    </View>
    <ScrollView ref={scrollRef} horizontal accessibilityLabel="章节书简" style={styles.ribbon} contentContainerStyle={styles.ribbonContent} showsHorizontalScrollIndicator
      onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={32}>
      <BookSlip title="新建章节" label="＋" accessibleLabel="新建章节" height={slipHeight} create disabled={locked} onPress={onCreate} />
      {visible.map((chapter) => <BookSlip key={chapter.id} title={chapterName(chapter)} label={`第${chapterNumber(chapter.index)}章`} accessibleLabel={`打开章节 ${chapter.title}`} height={slipHeight} disabled={locked} onPress={() => onOpen(chapter.id)} />)}
    </ScrollView>
    {search && !visible.length ? <ThemedText type="small" themeColor="textMuted" style={styles.empty}>没有匹配的章节。</ThemedText> : null}
    <View style={styles.footer}>
      <ThemedText type="small" themeColor="textMuted">{chapters.length ? '向右浏览更早章节' : '从第一条书简，开启你的故事'}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="向前浏览章节" onPress={() => scrollRef.current?.scrollTo({ x: Math.max(0, scrollOffset.current - 520), animated: true })} style={styles.arrow}><ThemedText themeColor="textSecondary">←</ThemedText></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="浏览更早章节" onPress={() => scrollRef.current?.scrollTo({ x: scrollOffset.current + 520, animated: true })} style={styles.arrow}><ThemedText themeColor="textSecondary">→</ThemedText></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, width: '100%' }, toolbar: { paddingHorizontal: 36, paddingTop: 8, paddingBottom: 28, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 18 }, compactToolbar: { paddingHorizontal: 20 }, hint: { flex: 1, minWidth: 190 },
  search: { width: 200, maxWidth: '100%', minHeight: 38, paddingHorizontal: 12, fontSize: 14, borderWidth: 1, borderRadius: 5 }, ribbon: { flexGrow: 0, minWidth: 0, width: '100%' }, ribbonContent: { gap: 16, paddingHorizontal: 36, paddingBottom: 18 },
  slip: { flexShrink: 0, borderWidth: 1, borderRadius: 3, paddingHorizontal: 14, alignItems: 'center', overflow: 'hidden' }, highlighted: { borderWidth: 2 }, disabled: { opacity: 0.5 },
  binding: { position: 'absolute', top: 0, bottom: 0, left: 7, right: 7, borderLeftWidth: 1, borderRightWidth: 1, opacity: 0.42 }, endRule: { width: 78, height: 5, borderTopWidth: 1, borderBottomWidth: 1, marginTop: 20, opacity: 0.6 }, bottomRule: { position: 'absolute', bottom: 20, marginTop: 0 },
  chapterNumber: { fontFamily: Fonts.serif, fontSize: 17, lineHeight: 25, marginTop: 44, fontWeight: '500' }, divider: { width: 24, height: 1, marginTop: 24, marginBottom: 24 },
  verticalTitle: { flexDirection: 'row-reverse', justifyContent: 'center', gap: 8 }, titleColumn: { fontFamily: Fonts.serif, fontSize: 30, lineHeight: 34, textAlign: 'center', fontWeight: '500' }, longTitle: { fontSize: 24 },
  empty: { paddingHorizontal: 36, paddingVertical: 14 }, footer: { paddingHorizontal: 36, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }, arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' } });
