import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { modelIdsEqual } from '@/constants/provider-capabilities';
import { providerLogoSource } from '@/constants/provider-logos';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { LlmProvider } from '@/types/tavern';
import { buildModelRouteCatalog, type ModelBrandGroup, type ModelRouteEntry } from '@/utils/model-route-catalog';
import { modelDisplayName } from '@/utils/model-display-name';

type Props = {
  visible: boolean;
  title: string;
  providers?: Record<string, LlmProvider>;
  catalog?: ModelBrandGroup[];
  description?: string;
  selectedModelId?: string;
  selectedProviderId?: string;
  onClose: () => void;
  onSelect: (modelId: string, providerId: string) => void;
  followOption?: { label: string; description: string; selected?: boolean; onPress: () => void };
};

export function ModelRoutePicker({ visible, ...props }: Props) {
  if (!visible) return null;
  return <ModelRoutePickerContent visible={visible} {...props} />;
}

function ModelRoutePickerContent({
  visible, title, providers, catalog: providedCatalog, description, selectedModelId, selectedProviderId, onClose, onSelect, followOption,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [brandId, setBrandId] = useState<string | null>(null);
  const [routeEntry, setRouteEntry] = useState<ModelRouteEntry | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const catalog = useMemo(() => providedCatalog ?? buildModelRouteCatalog(providers ?? {}), [providedCatalog, providers]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => catalog.map((group) => ({
    ...group,
    models: normalizedQuery && !group.label.toLowerCase().includes(normalizedQuery)
      ? group.models.filter((entry) => entry.label.toLowerCase().includes(normalizedQuery)
        || entry.key.toLowerCase().includes(normalizedQuery)
        || entry.routes.some((route) => `${route.modelId} ${route.providerName}`.toLowerCase().includes(normalizedQuery)))
      : group.models,
  })).filter((group) => group.models.length > 0), [catalog, normalizedQuery]);
  const currentGroupId = visibleGroups.find((group) => group.models.some((entry) => entry.routes.some((route) =>
    route.providerId === selectedProviderId && modelIdsEqual(route.modelId, selectedModelId))))?.id;
  const effectiveBrandId = brandId && visibleGroups.some((group) => group.id === brandId)
    ? brandId : normalizedQuery ? visibleGroups[0]?.id : currentGroupId ?? visibleGroups[0]?.id;
  const selectedGroup = visibleGroups.find((group) => group.id === effectiveBrandId);
  const isCompact = width < 640;
  const following = followOption?.selected ?? !selectedModelId;
  const currentRoute = (entry: ModelRouteEntry) => entry.routes.find((route) =>
    route.providerId === selectedProviderId && modelIdsEqual(route.modelId, selectedModelId));

  function selectEntry(entry: ModelRouteEntry) {
    if (!entry.routes.length) return;
    if (entry.routes.length === 1) onSelect(entry.routes[0].modelId, entry.routes[0].providerId);
    else setRouteEntry(entry);
  }

  function selectionMark(selected: boolean) {
    return selected
      ? <View style={[styles.checkCircle, { backgroundColor: theme.primary }]}><View style={[styles.check, { borderColor: theme.onPrimary }]} /></View>
      : <View style={[styles.rowChevron, { borderColor: theme.textMuted }]} />;
  }

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={[styles.overlay, { backgroundColor: theme.scrim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} focusable={false} />
      <View style={[styles.panel, {
        backgroundColor: theme.surface, borderColor: theme.outlineVariant,
        height: Math.min(height - 40 - insets.top - insets.bottom, 600),
        paddingBottom: isCompact ? insets.bottom : 0,
      }]}>
        <View style={[styles.header, isCompact && styles.compactPadding]}>
          <View style={styles.headerCopy}>
            <ThemedText style={styles.title}>{routeEntry ? '选择模型连接' : title}</ThemedText>
            <ThemedText style={styles.description} themeColor="textSecondary">
              {routeEntry ? `为 ${modelDisplayName(routeEntry.label)} 选择一个已配置的连接。` : description ?? '选择模型，再选择你希望使用的连接。'}
            </ThemedText>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭模型选择" hitSlop={4}
            onHoverIn={() => setHovered('close')} onHoverOut={() => setHovered(null)}
            style={({ pressed }) => [styles.close, { backgroundColor: hovered === 'close' || pressed ? theme.surfaceVariant : 'transparent' }]}>
            <View style={[styles.closeLine, { backgroundColor: theme.textSecondary, transform: [{ rotate: '45deg' }] }]} />
            <View style={[styles.closeLine, { backgroundColor: theme.textSecondary, transform: [{ rotate: '-45deg' }] }]} />
          </Pressable>
        </View>
        {!routeEntry && <View style={[styles.searchArea, isCompact && styles.compactSearch]}>
          <View style={[styles.searchBox, { backgroundColor: theme.background, borderColor: searchFocused ? theme.primary : theme.outlineVariant }]}>
            <View style={styles.searchIcon}><View style={[styles.searchRing, { borderColor: theme.textMuted }]} /><View style={[styles.searchStem, { backgroundColor: theme.textMuted }]} /></View>
            <TextInput value={query} onChangeText={(value) => { setQuery(value); setBrandId(null); }}
              onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
              accessibilityLabel="搜索模型" placeholder="搜索品牌、模型或线路" placeholderTextColor={theme.textMuted}
              autoCapitalize="none" autoCorrect={false} style={[styles.search, { color: theme.text }]} />
            {query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="清空搜索" style={styles.clear}><ThemedText type="small" themeColor="textSecondary">清空</ThemedText></Pressable> : null}
          </View>
        </View>}
        <View style={[styles.body, { borderTopColor: theme.outlineVariant }]}>
          {routeEntry ? <ScrollView contentContainerStyle={styles.routeList} keyboardShouldPersistTaps="handled">
            <Pressable onPress={() => setRouteEntry(null)} accessibilityRole="button" style={styles.backRow}><ThemedText type="small" themeColor="primary">‹ 返回模型列表</ThemedText></Pressable>
            {routeEntry.routes.map((route) => {
              const selected = route.providerId === selectedProviderId && modelIdsEqual(route.modelId, selectedModelId);
              return <Pressable key={route.providerId + ':' + route.modelId} onPress={() => onSelect(route.modelId, route.providerId)}
                accessibilityRole="button" accessibilityState={{ selected }}
                onHoverIn={() => setHovered(route.providerId)} onHoverOut={() => setHovered(null)}
                style={({ pressed }) => [styles.row, { backgroundColor: selected ? theme.primaryContainer : hovered === route.providerId || pressed ? theme.surfaceVariant : 'transparent', borderColor: selected ? theme.primary : 'transparent' }]}>
                <View style={styles.rowCopy}><ThemedText style={styles.modelName}>{route.providerName}</ThemedText><ThemedText style={styles.modelId} themeColor="textSecondary">{route.modelId}</ThemedText></View>
                {selectionMark(selected)}
              </Pressable>;
            })}
          </ScrollView> : <View style={[styles.catalog, isCompact && styles.catalogCompact]}>
            {visibleGroups.length > 0 && <ScrollView horizontal={isCompact} showsHorizontalScrollIndicator={false}
              style={[styles.brands, { backgroundColor: theme.background, borderColor: theme.outlineVariant }, isCompact && styles.brandsCompact]}
              contentContainerStyle={[styles.brandContent, isCompact && styles.brandContentCompact]}>
              {!isCompact && <ThemedText style={styles.sectionLabel} themeColor="textMuted">模型品牌</ThemedText>}
              {visibleGroups.map((group) => {
                const active = effectiveBrandId === group.id;
                const logo = providerLogoSource(group.id);
                return <Pressable key={group.id} onPress={() => setBrandId(group.id)}
                  accessibilityRole="button" accessibilityLabel={group.label} accessibilityState={{ selected: active }}
                  onHoverIn={() => setHovered(group.id)} onHoverOut={() => setHovered(null)}
                  style={({ pressed }) => [styles.brandRow, { backgroundColor: active ? theme.surfaceElevated : hovered === group.id || pressed ? theme.surfaceVariant : 'transparent', borderColor: active ? theme.outlineVariant : 'transparent' }]}>
                  {logo ? <Image source={logo} style={styles.brandLogo} contentFit="contain" /> : <View style={[styles.brandFallback, { backgroundColor: theme.outlineVariant }]} />}
                  <ThemedText style={[styles.brandName, active && styles.activeBrand]} numberOfLines={1}>{group.label}</ThemedText>
                  <ThemedText style={styles.count} themeColor="textMuted">{group.models.length}</ThemedText>
                </Pressable>;
              })}
            </ScrollView>}
            <ScrollView style={styles.models} contentContainerStyle={styles.modelContent} keyboardShouldPersistTaps="handled">
              {selectedGroup ? <>
                <View style={styles.listHeading}><ThemedText style={styles.sectionLabel} themeColor="textSecondary">{selectedGroup.label}</ThemedText><ThemedText style={styles.count} themeColor="textMuted">{selectedGroup.models.length} 个模型</ThemedText></View>
                {selectedGroup.models.map((entry) => {
                  const selected = Boolean(currentRoute(entry));
                  return <Pressable key={entry.key} onPress={() => selectEntry(entry)} disabled={!entry.routes.length}
                    accessibilityRole="button" accessibilityState={{ selected, disabled: !entry.routes.length }}
                    onHoverIn={() => setHovered(entry.key)} onHoverOut={() => setHovered(null)}
                    style={({ pressed }) => [styles.row, { backgroundColor: selected ? theme.primaryContainer : hovered === entry.key || pressed ? theme.surfaceVariant : 'transparent', borderColor: selected ? theme.primary : 'transparent' }, !entry.routes.length && styles.disabled]}>
                    <View style={styles.rowCopy}>
                      <View style={styles.nameLine}><ThemedText style={styles.modelName} numberOfLines={1}>{modelDisplayName(entry.label)}</ThemedText>{selected && <ThemedText style={styles.selectedLabel} themeColor="primary">当前使用</ThemedText>}</View>
                      <ThemedText style={styles.modelId} themeColor="textSecondary" numberOfLines={1}>{entry.routes[0]?.modelId ?? entry.key}</ThemedText>
                      <ThemedText style={styles.connection} themeColor="textMuted" numberOfLines={1}>{entry.routes.length > 1 ? `${entry.routes.length} 个连接 · ${entry.routes.map((route) => route.providerName).join(' / ')}` : entry.routes[0]?.providerName ?? '请先配置连接'}</ThemedText>
                    </View>
                    {selectionMark(selected)}
                  </Pressable>;
                })}
              </> : <View style={styles.empty}><ThemedText style={styles.emptyTitle}>{query ? '没有找到这个模型' : '还没有可选模型'}</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>{query ? '试试模型名称的一部分，或按厂商品牌搜索。' : '在「系统设置 → 模型连接」中添加厂商并获取模型列表，然后回到这里选择。'}</ThemedText>{query && <Pressable accessibilityRole="button" onPress={() => setQuery('')} style={styles.backRow}><ThemedText type="smallBold" themeColor="primary">查看全部模型</ThemedText></Pressable>}</View>}
            </ScrollView>
          </View>}
        </View>
        {followOption ? <Pressable onPress={followOption.onPress} accessibilityRole="button"
          accessibilityState={{ selected: following }}
          onHoverIn={() => setHovered('follow')} onHoverOut={() => setHovered(null)}
          style={({ pressed }) => [styles.footer, { borderColor: theme.outlineVariant, backgroundColor: hovered === 'follow' || pressed ? theme.surfaceVariant : theme.background }]}>
          <View style={[styles.followMark, { borderColor: following ? theme.primary : theme.outline }]}>
            {following && <View style={[styles.followDot, { backgroundColor: theme.primary }]} />}
          </View>
          <View style={styles.rowCopy}><ThemedText style={styles.footerLabel}>{followOption.label}</ThemedText><ThemedText style={styles.connection} themeColor="textSecondary">{followOption.description}</ThemedText></View>
          <ThemedText style={styles.selectedLabel} themeColor="primary">{following ? '已启用' : '恢复'}</ThemedText>
        </Pressable> : <View style={[styles.simpleFooter, { borderColor: theme.outlineVariant }]}><ThemedText style={styles.connection} themeColor="textSecondary">选中后立即生效，可随时更换。</ThemedText></View>}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  panel: { width: '100%', maxWidth: 760, borderWidth: 1, borderRadius: 18, overflow: 'hidden', boxShadow: '0 24px 80px rgba(28,22,18,0.18)' },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 28, paddingBottom: 20, gap: 12 },
  compactPadding: { padding: 20, paddingBottom: 16 },
  headerCopy: { flex: 1, gap: 8, minWidth: 0 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: -0.5 },
  description: { fontSize: 13, lineHeight: 21 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  closeLine: { width: 16, height: 1.5, position: 'absolute' },
  searchArea: { paddingHorizontal: 28, paddingBottom: 24 },
  compactSearch: { paddingHorizontal: 20, paddingBottom: 18 },
  searchBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 9, paddingLeft: 14, minHeight: 46 },
  search: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 12, fontFamily: Fonts.sans, fontSize: 14 },
  searchIcon: { width: 16, height: 16 },
  searchRing: { width: 11, height: 11, borderWidth: 1.5, borderRadius: 7 },
  searchStem: { position: 'absolute', width: 6, height: 1.5, left: 9, top: 11, transform: [{ rotate: '45deg' }] },
  clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  body: { flex: 1, minHeight: 0, borderTopWidth: 1 },
  catalog: { flex: 1, flexDirection: 'row', minHeight: 0 },
  catalogCompact: { flexDirection: 'column' },
  brands: { width: 178, flexGrow: 0, borderRightWidth: 1 },
  brandsCompact: { width: '100%', maxHeight: 68, borderRightWidth: 0, borderBottomWidth: 1 },
  brandContent: { padding: 12, gap: 4 },
  brandContentCompact: { flexDirection: 'row', alignItems: 'center' },
  sectionLabel: { fontSize: 12, lineHeight: 18, fontWeight: '500', marginVertical: 4 },
  brandRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, borderRadius: 7, borderWidth: 1 },
  brandLogo: { width: 18, height: 18 },
  brandFallback: { width: 16, height: 16, borderRadius: 4 },
  brandName: { fontSize: 13, lineHeight: 20, flexShrink: 1, fontWeight: '500' },
  activeBrand: { fontWeight: '600' },
  count: { fontSize: 11, lineHeight: 18, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  models: { flex: 1, minWidth: 0 },
  modelContent: { padding: 16, gap: 6, flexGrow: 1 },
  listHeading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 7 },
  row: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 9, borderWidth: 1 },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  nameLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  modelName: { fontSize: 15, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  modelId: { fontFamily: Fonts.mono, fontSize: 11, lineHeight: 18 },
  connection: { fontSize: 12, lineHeight: 18 },
  selectedLabel: { fontSize: 11, lineHeight: 18, fontWeight: '600' },
  checkCircle: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  check: { width: 8, height: 5, borderBottomWidth: 1.5, borderLeftWidth: 1.5, transform: [{ rotate: '-45deg' }], marginTop: -2 },
  rowChevron: { width: 6, height: 6, borderRightWidth: 1, borderTopWidth: 1, transform: [{ rotate: '45deg' }], marginRight: 4 },
  routeList: { padding: 20, gap: 8 },
  backRow: { minHeight: 44, justifyContent: 'center' },
  footer: { minHeight: 76, paddingVertical: 16, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1 },
  footerLabel: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  followMark: { width: 17, height: 17, borderWidth: 1.5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  followDot: { width: 7, height: 7, borderRadius: 4 },
  simpleFooter: { paddingVertical: 14, paddingHorizontal: 24, borderTopWidth: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyCopy: { textAlign: 'center', maxWidth: 300 },
  disabled: { opacity: 0.45 },
});
