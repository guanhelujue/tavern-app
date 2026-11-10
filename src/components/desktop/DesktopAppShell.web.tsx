import { Link, useGlobalSearchParams, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

type IconName = 'book' | 'create' | 'import' | 'settings' | 'model' | 'debug' | 'world' | 'people' | 'outline' | 'analysis' | 'route' | 'check' | 'back' | 'panel' | 'inspiration' | 'foreshadow';
type NavItem = { label: string; href: string; icon: IconName; active: boolean };

function NavIcon({ name, color }: { name: IconName; color: string }) {
  const paths: Record<IconName, ReactNode> = {
    book: <><path d="M12 6C9 4 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1Z" /><path d="M12 6v14" /></>,
    create: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8m-4-4h8" /></>,
    import: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    model: <><rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" /></>,
    debug: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></>,
    world: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" /></>,
    outline: <><path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1" /></>,
    analysis: <><path d="M4 3v18h17M8 17v-5m5 5V8m5 9V5" /></>,
    route: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10m12-10v2c0 3-12 3-12 6" /></>,
    check: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></>,
    back: <path d="m10 5-7 7 7 7M3 12h18" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    inspiration: <><path d="M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 4V5a2 2 0 0 1 2-2Z" /><path d="M7 8h10M7 12h7" /></>,
    foreshadow: <><path d="M6 21V3h13l-3 5 3 5H6" /></>,
  };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function DesktopAppShell({ children }: { children: ReactNode }) {
  const desktop = useDesktopLayout();
  const theme = useTheme();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ novelId?: string | string[]; focus?: string | string[] }>();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const { width } = useWindowDimensions();
  const [sidebarCollapsed, setCollapsed] = useState<boolean | null>(null);
  const collapsed = sidebarCollapsed ?? width < 1000;
  const inOutline = pathname.startsWith('/novel/world-outline/');
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const inWorkbench = pathname.startsWith('/novel/workbench/');
  const globalItems: NavItem[] = [
    { label: '我的作品', href: '/(tabs)/novels', icon: 'book', active: pathname === '/novels' || pathname === '/' },
    { label: '创建作品', href: '/novel/create', icon: 'create', active: pathname === '/novel/create' || pathname === '/novel/continue' },
  ];
  const settingsItems: NavItem[] = [
    { label: '系统设置', href: '/(tabs)/settings', icon: 'model', active: pathname === '/settings' || pathname === '/explore' },
    { label: '小说配置', href: '/(tabs)/novel-settings', icon: 'settings', active: pathname === '/novel-settings' },
    { label: '调试工具', href: '/(tabs)/debug', icon: 'debug', active: pathname === '/debug' },
  ];
  const projectItems: NavItem[] = novel ? [
    { label: '章节创作', href: `/novel/chapters/${novel.id}`, icon: 'book', active: pathname.startsWith('/novel/chapters/') || pathname === `/novel/${novel.id}` || (inWorkbench && (!focus || focus === 'chapters' || focus === 'tools')) },
    { label: '故事大纲', href: `/novel/world-outline/${novel.id}`, icon: 'outline', active: pathname.startsWith('/novel/world-outline/') || pathname.startsWith('/novel/world/') },
    { label: '人物', href: `/novel/knowledge/characters/${novel.id}`, icon: 'people', active: pathname.startsWith('/novel/knowledge/characters/') },
    { label: '知识库', href: `/novel/knowledge/lore/${novel.id}`, icon: 'world', active: pathname.startsWith('/novel/knowledge/lore/') || pathname === `/novel/knowledge/${novel.id}` },
    { label: '伏笔管理', href: `/novel/foreshadows/${novel.id}`, icon: 'foreshadow', active: pathname.startsWith('/novel/foreshadows/') },
    { label: '灵感对话', href: `/novel/inspiration/${novel.id}`, icon: 'inspiration', active: pathname.startsWith('/novel/inspiration/') },
    { label: '剧情资料', href: `/novel/workbench/${novel.id}?focus=knowledge`, icon: 'world', active: inWorkbench && focus === 'knowledge' },
    { label: '上下文管理', href: `/novel/workbench/${novel.id}?focus=context`, icon: 'panel', active: inWorkbench && focus === 'context' },
    { label: '作品设定', href: `/novel/edit/${novel.id}`, icon: 'settings', active: pathname.startsWith('/novel/edit/') },
  ] : [];
  const current = [...globalItems, ...settingsItems, ...projectItems].find((item) => item.active)?.label ?? '创作工作区';

  function navigationItem(item: NavItem) {
    return (
      <Link key={item.label} href={item.href as Href} asChild>
        <Pressable
          accessibilityLabel={item.label}
          accessibilityState={{ selected: item.active }}
          onHoverIn={() => setHoveredItem(item.label)}
          onHoverOut={() => setHoveredItem(null)}
          style={StyleSheet.flatten([styles.navItem, collapsed && styles.collapsedItem, { backgroundColor: item.active ? theme.primaryContainer : hoveredItem === item.label ? theme.surfaceVariant : 'transparent' }])}>
          <NavIcon name={item.icon} color={item.active ? theme.primary : theme.textSecondary} />
          {!collapsed && <ThemedText type={item.active ? 'smallBold' : 'small'} themeColor={item.active ? 'primary' : 'textSecondary'}>{item.label}</ThemedText>}
          {item.active && <View style={[styles.activeMark, { backgroundColor: theme.primary }]} />}
        </Pressable>
      </Link>
    );
  }

  return (
    <View style={[styles.shell, { backgroundColor: theme.background }]}>
      {desktop && (
        <View role="navigation" accessibilityLabel="桌面导航" style={[styles.sidebar, { width: collapsed ? 80 : 224, backgroundColor: theme.surface, borderRightColor: theme.outlineVariant }]}>
          <Link href="/(tabs)/novels" asChild>
            <Pressable accessibilityLabel="酒馆 · 返回我的作品" style={styles.brand}>
              <View style={[styles.brandMark, { backgroundColor: theme.primary }]}><ThemedText style={{ color: theme.onPrimary, fontSize: 22 }}>酒</ThemedText></View>
              {!collapsed && <View><ThemedText type="smallBold" style={{ fontSize: 18 }}>酒馆</ThemedText><ThemedText style={{ fontSize: 11, color: theme.textSecondary }}>小说创作空间</ThemedText></View>}
            </Pressable>
          </Link>
          <ScrollView contentContainerStyle={styles.navigation} showsVerticalScrollIndicator={false}>
            {novel ? <>
              {navigationItem({ label: '返回作品库', href: '/(tabs)/novels', icon: 'back', active: false })}
              {!collapsed && <View style={[styles.projectHeading, { borderTopColor: theme.outlineVariant }]}><ThemedText type="code" themeColor="textSecondary">当前作品</ThemedText><ThemedText type="smallBold" numberOfLines={2}>{novel.name}</ThemedText></View>}
              {projectItems.map(navigationItem)}
            </> : <>
              {!collapsed && <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>创作空间</ThemedText>}
              {globalItems.map(navigationItem)}
            </>}
            <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />
            {!collapsed && <ThemedText type="code" themeColor="textSecondary" style={styles.sectionLabel}>偏好与工具</ThemedText>}
            {settingsItems.map(navigationItem)}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel={collapsed ? '展开侧栏' : '收起侧栏'} accessibilityState={{ expanded: !collapsed }} onPress={() => setCollapsed(!collapsed)} style={({ pressed }) => [styles.collapseButton, { borderTopColor: theme.outlineVariant }, pressed && styles.pressed]}>
            <NavIcon name="panel" color={theme.textSecondary} />
            {!collapsed && <ThemedText type="small" themeColor="textSecondary">收起侧栏</ThemedText>}
          </Pressable>
        </View>
      )}
      <View key="workspace" style={styles.workspace}>
        {desktop && !inOutline && <View style={[styles.topbar, { backgroundColor: theme.surfaceElevated, borderBottomColor: theme.outlineVariant }]}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.breadcrumb}>{novel ? `${novel.name}  /  ${current}` : `创作空间  /  ${current}`}</ThemedText>
          {width >= 1000 && <ThemedText type="code" themeColor="textSecondary">TAVERN · WRITING STUDIO</ThemedText>}
        </View>}
        <View key="screens" style={styles.screens}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', minHeight: 0 },
  sidebar: { flexShrink: 0, borderRightWidth: 1 },
  brand: { height: 88, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 },
  brandMark: { width: 36, height: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  navigation: { padding: 12, gap: 5 },
  sectionLabel: { paddingHorizontal: 12, marginTop: 12, marginBottom: 8, fontSize: 11, letterSpacing: 1 },
  navItem: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 7 },
  collapsedItem: { paddingHorizontal: 0, justifyContent: 'center' },
  activeMark: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 2 },
  projectHeading: { marginTop: 12, padding: 12, paddingTop: 20, gap: 8, borderTopWidth: 1 },
  divider: { height: 1, marginHorizontal: 12, marginTop: 24, marginBottom: 12 },
  collapseButton: { minHeight: 60, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1 },
  workspace: { flex: 1, minWidth: 0, minHeight: 0 },
  topbar: { minHeight: 56, paddingHorizontal: 32, gap: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  breadcrumb: { flex: 1 },
  screens: { flex: 1, minWidth: 0, minHeight: 0 },
  pressed: { opacity: 0.7 },
});
