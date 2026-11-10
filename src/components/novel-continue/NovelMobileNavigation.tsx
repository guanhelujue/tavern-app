import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export function NovelMobileNavigation({ novelId }: { novelId: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const destinations = [
    ['世界与大纲', `/novel/world-outline/${novelId}`],
    ['人物', `/novel/knowledge/characters/${novelId}`],
    ['知识库', `/novel/knowledge/lore/${novelId}`],
    ['伏笔管理', `/novel/foreshadows/${novelId}`],
    ['灵感对话', `/novel/inspiration/${novelId}`],
    ['剧情资料', `/novel/workbench/${novelId}?focus=knowledge`],
    ['上下文管理', `/novel/workbench/${novelId}?focus=context`],
    ['正文分析', `/novel/workbench/${novelId}?focus=analysis`],
    ['作品设定', `/novel/edit/${novelId}`],
  ];
  return <>
    <View style={[styles.bar, { borderBottomColor: theme.outlineVariant }]}>
      <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)/novels')} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><ThemedText themeColor="primary">作品库</ThemedText></Pressable>
      <ThemedText type="smallBold" style={styles.title}>小说工作台</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="打开工作台导航" accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><ThemedText themeColor="primary">导航</ThemedText></Pressable>
    </View>
    <Modal visible={open} animationType="none" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
        <View style={styles.bar}><ThemedText type="subtitle" style={styles.title}>工作台导航</ThemedText><Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><ThemedText themeColor="primary">关闭</ThemedText></Pressable></View>
        <ScrollView contentContainerStyle={styles.menu}>
          {destinations.map(([label, href]) => <Pressable key={label} accessibilityRole="button" onPress={() => { setOpen(false); router.push(href as Href); }} style={({ pressed }) => [styles.destination, { borderColor: theme.outlineVariant, backgroundColor: theme.surface }, pressed && styles.pressed]}><ThemedText>{label}</ThemedText><ThemedText accessible={false} themeColor="textSecondary">›</ThemedText></Pressable>)}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, textAlign: 'center' },
  button: { minHeight: 48, minWidth: 56, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  page: { flex: 1 }, menu: { padding: 20, gap: 12 },
  destination: { minHeight: 56, borderWidth: 1, borderRadius: 12, padding: 16, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  pressed: { opacity: 0.7 },
});
