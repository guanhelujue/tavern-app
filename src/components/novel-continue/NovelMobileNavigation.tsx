import { Image } from 'expo-image';
import { router, useLocalSearchParams, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MobileAction, MobileIcon, type MobileIconName } from '@/components/mobile/MobileUI';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import { resolveNovelImageUri } from '@/utils/novel-images';

type Destination = { label: string; description: string; path: string; icon: MobileIconName; focus?: string };
export function NovelMobileNavigation({ novelId, title }: { novelId: string; title?: string }) {
  const theme = useTheme();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const novel = useTavernStore(state => state.novels.find(item => item.id === novelId));
  const coverUri = resolveNovelImageUri(novel?.coverImageUri);
  const [open, setOpen] = useState(false);
  const groups: { label: string; items: Destination[] }[] = [
    { label: '构思与设定', items: [
      { label: '世界与大纲', description: '故事背景与章节规划', path: '/novel/world-outline/' + novelId, icon: { ios: 'map', android: 'map', web: 'map' } },
      { label: '人物', description: '角色档案与关系', path: '/novel/knowledge/characters/' + novelId, icon: { ios: 'person.2', android: 'group', web: 'group' } },
      { label: '知识库', description: '设定、规则与资料', path: '/novel/knowledge/lore/' + novelId, icon: { ios: 'books.vertical', android: 'library_books', web: 'library_books' } },
    ] },
    { label: '创作与推演', items: [
      { label: '伏笔管理', description: '埋下线索，安排回收', path: '/novel/foreshadows/' + novelId, icon: { ios: 'bookmark', android: 'bookmark_border', web: 'bookmark_border' } },
      { label: '灵感对话', description: '推演情节，整理想法', path: '/novel/inspiration/' + novelId, icon: { ios: 'bubble.left', android: 'chat_bubble_outline', web: 'chat_bubble_outline' } },
      { label: '剧情资料', description: '汇总故事进展', path: '/novel/workbench/' + novelId, focus: 'knowledge', icon: { ios: 'doc.text', android: 'description', web: 'description' } },
    ] },
    { label: '写作控制', items: [
      { label: '上下文管理', description: '选择模型读取的资料', path: '/novel/workbench/' + novelId, focus: 'context', icon: { ios: 'square.stack.3d.up', android: 'layers', web: 'layers' } },
      { label: '正文分析', description: '审阅文本与提取信息', path: '/novel/workbench/' + novelId, focus: 'analysis', icon: { ios: 'doc.text.magnifyingglass', android: 'find_in_page', web: 'find_in_page' } },
      { label: '作品设定', description: '世界背景与写作偏好', path: '/novel/edit/' + novelId, icon: { ios: 'gearshape', android: 'settings', web: 'settings' } },
    ] },
  ];
  const activeDestination = groups.flatMap(group => group.items).find(item => pathname === item.path && (!item.focus || item.focus === focus));
  const pageTitle = title ?? activeDestination?.label ?? (focus === 'tools' ? '任务与导出' : focus === 'forecast' ? '路线推演' : focus === 'consistency' ? '一致性检查' : '工作台');
  function navigate(destination: Destination) {
    setOpen(false);
    const href = destination.path + (destination.focus ? '?focus=' + destination.focus : '');
    if (pathname === destination.path && (!destination.focus || destination.focus === focus)) return;
    router.push(href as Href);
  }

  return <>
    <View style={[styles.bar, { borderBottomColor: theme.outlineVariant, backgroundColor: theme.background }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="返回作品库" onPress={() => router.replace('/(tabs)/novels')} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><MobileIcon name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={20} /><ThemedText type="small" themeColor="primary">作品库</ThemedText></Pressable>
      <ThemedText numberOfLines={1} accessibilityRole="header" style={styles.title}>{pageTitle}</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="打开工作台导航" accessibilityState={{ expanded: open }} onPress={() => setOpen(true)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><MobileIcon name={{ ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' }} size={21} /><ThemedText type="small" themeColor="primary">导航</ThemedText></Pressable>
    </View>
    <Modal visible={open} animationType="none" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
        <View style={styles.modalBar}><ThemedText accessibilityRole="header" style={styles.modalTitle}>工作台导航</ThemedText><Pressable accessibilityRole="button" accessibilityLabel="关闭工作台导航" onPress={() => setOpen(false)} style={({ pressed }) => [styles.close, pressed && styles.pressed]}><MobileIcon name={{ ios: 'xmark', android: 'close', web: 'close' }} size={24} /></Pressable></View>
        <ScrollView contentContainerStyle={styles.menu} showsVerticalScrollIndicator={false}>
          <View style={styles.identity}>
            {coverUri ? <Image source={{ uri: coverUri }} contentFit="cover" style={styles.cover} /> : <View style={[styles.cover, styles.fallback, { backgroundColor: theme.primaryContainer }]}><MobileIcon name={{ ios: 'book', android: 'menu_book', web: 'menu_book' }} size={26} /></View>}
            <View style={styles.identityCopy}><ThemedText style={styles.novelName}>{novel?.name || '小说工作台'}</ThemedText><ThemedText type="small" themeColor="textSecondary">小说工作台</ThemedText></View>
          </View>
          {groups.map(group => <View key={group.label} style={styles.group}>
            <View style={styles.groupHeading}><ThemedText type="smallBold" themeColor="primary">{group.label}</ThemedText><View style={[styles.rule, { backgroundColor: theme.outlineVariant }]} /></View>
            {group.items.map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityState={{ selected: activeDestination?.label === item.label }} onPress={() => navigate(item)} style={({ pressed }) => [styles.destination, { borderBottomColor: theme.outlineVariant }, (pressed || activeDestination?.label === item.label) && { backgroundColor: theme.surfaceVariant }]}>
              <View style={[styles.icon, { backgroundColor: theme.primaryContainer }]}><MobileIcon name={item.icon} /></View>
              <View style={styles.destinationCopy}><ThemedText style={styles.destinationTitle}>{item.label}</ThemedText><ThemedText style={styles.description} themeColor="textSecondary">{item.description}</ThemedText></View>
              <MobileIcon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={19} color={theme.textSecondary} />
            </Pressable>)}
          </View>)}
          <MobileAction label="返回章节目录" variant="text" onPress={() => { setOpen(false); router.push(('/novel/chapters/' + novelId) as Href); }} icon={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  bar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, textAlign: 'center', fontSize: 17, lineHeight: 24, fontWeight: '700' }, back: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 4 }, button: { minHeight: 48, minWidth: 64, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center' },
  page: { flex: 1 }, modalBar: { paddingHorizontal: 20, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { fontSize: 21, lineHeight: 30, fontWeight: '700' }, close: { width: 48, height: 48, justifyContent: 'center', alignItems: 'flex-end' },
  menu: { paddingHorizontal: 20, paddingBottom: 20, gap: 14, width: '100%', maxWidth: 720, alignSelf: 'center' }, identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8, paddingBottom: 8 }, cover: { width: 48, height: 60, borderRadius: 10 }, fallback: { alignItems: 'center', justifyContent: 'center' }, identityCopy: { flex: 1, minWidth: 0, gap: 4 }, novelName: { fontFamily: Fonts.serif, fontSize: 24, lineHeight: 34, fontWeight: '600' },
  group: { gap: 2 }, groupHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }, rule: { height: StyleSheet.hairlineWidth, flex: 1 },
  destination: { minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 12 }, icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, destinationCopy: { flex: 1, minWidth: 0, gap: 2 }, destinationTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600' }, description: { fontSize: 12, lineHeight: 18 }, pressed: { opacity: 0.7 },
});
