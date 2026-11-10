import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

export function NovelAvailabilityState() {
  const theme = useTheme();
  const hydrated = useTavernStore((state) => state.hasHydrated);
  return <View style={[styles.root, { backgroundColor: theme.background }]}>
    <ThemedText type="subtitle">{hydrated ? '当前浏览器中没有这部作品' : '正在读取本地作品…'}</ThemedText>
    <ThemedText themeColor="textSecondary">{hydrated ? '网页版作品保存在当前浏览器中。请使用原来创作的浏览器，或在作品库导入之前导出的 JSON 备份。作品也可能已被删除。' : '正在加载已保存的作品和章节。'}</ThemedText>
    <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)/novels')} style={[styles.button, { backgroundColor: theme.primary }]}><ThemedText style={{ color: theme.onPrimary }}>返回作品库 / 导入备份</ThemedText></Pressable>
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, padding: 32, justifyContent: 'center', gap: 16 }, button: { minHeight: 44, padding: 12, borderRadius: 8, alignSelf: 'flex-start' } });
