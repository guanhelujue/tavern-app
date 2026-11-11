import { router, useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { NovelMobileNavigation } from '@/components/novel-continue/NovelMobileNavigation';
import { NovelSceneInspirationPanel } from '@/components/NovelSceneInspirationModal';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

export default function NovelInspirationScreen() {
  const params = useLocalSearchParams<{ novelId?: string }>();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  if (!novel) return <View style={[styles.center, { backgroundColor: theme.background }]}><ThemedText>小说不存在。</ThemedText></View>;
  return <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>{Platform.OS !== 'web' ? <NovelMobileNavigation novelId={novel.id} title="灵感对话" /> : null}
    <View style={[styles.content, { paddingHorizontal: width < 640 ? 16 : Spacing.four }]}>
    {Platform.OS === 'web' ? <View style={styles.topbar}><Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => router.back()} hitSlop={10}><ThemedText type="code" themeColor="accent">← 返回作品</ThemedText></Pressable><ThemedText type="code" themeColor="textMuted" numberOfLines={1} style={styles.breadcrumb}>灵感工作台 / {novel.name}</ThemedText></View> : null}
    {Platform.OS === 'web' ? <View style={styles.heading}><ThemedText type="title" style={styles.headingTitle}>灵感对话</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.headingCopy}>围绕当前作品讨论剧情、场景和写法；回复会保存到本地。</ThemedText></View> : null}
    <NovelSceneInspirationPanel
      embedded
      novel={novel}
      onUse={(content, messageId) => { if (!messageId) return; router.push(`/novel/chapters/${novel.id}?inspirationId=${encodeURIComponent(messageId)}` as never); }}
      onContinue={(_prompt, messageId) => {
        if (!messageId) return;
        const draft = (novel.chapters ?? [])
          .filter((chapter) => chapter.status === 'draft' && [chapter.title, chapter.summary, chapter.goal, chapter.content].some((value) => value.trim()))
          .sort((left, right) => left.index - right.index)[0];
        const chapterParam = draft ? `&chapterId=${encodeURIComponent(draft.id)}` : '';
        router.push(`/novel/chapters/${novel.id}?inspirationId=${encodeURIComponent(messageId)}${chapterParam}` as never);
      }}
    />
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safeArea: { flex: 1 }, content: { flex: 1 }, breadcrumb: { flexShrink: 1, textAlign: 'right', marginLeft: 16 }, topbar: { minHeight: 52, width: '100%', maxWidth: 960, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, heading: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: Spacing.one, paddingTop: Spacing.three, paddingBottom: Spacing.three }, headingTitle: { fontSize: 28, lineHeight: 36, letterSpacing: -0.4 }, headingCopy: { maxWidth: 560, lineHeight: 23 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
