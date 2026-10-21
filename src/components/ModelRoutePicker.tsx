import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { modelIdsEqual } from '@/constants/provider-capabilities';
import { providerLogoSource } from '@/constants/provider-logos';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { LlmProvider } from '@/types/tavern';
import { buildModelRouteCatalog, type ModelRouteEntry } from '@/utils/model-route-catalog';

type Props = {
  visible: boolean;
  title: string;
  providers: Record<string, LlmProvider>;
  selectedModelId?: string;
  selectedProviderId?: string;
  onClose: () => void;
  onSelect: (modelId: string, providerId: string) => void;
  followOption?: { label: string; description: string; onPress: () => void };
};

export function ModelRoutePicker({
  visible, ...props
}: Props) {
  if (!visible) return null;
  return <ModelRoutePickerContent visible={visible} {...props} />;
}

function ModelRoutePickerContent({
  visible, title, providers, selectedModelId, selectedProviderId, onClose, onSelect, followOption,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [brandId, setBrandId] = useState<string | null>(null);
  const [routeEntry, setRouteEntry] = useState<ModelRouteEntry | null>(null);
  const catalog = useMemo(() => buildModelRouteCatalog(providers), [providers]);
  const mergedRouteCount = catalog.reduce((count, group) => count + group.models.reduce(
    (groupCount, entry) => groupCount + Math.max(0, entry.routes.length - 1), 0), 0);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => catalog
    .map((group) => ({
      ...group,
      models: normalizedQuery && !group.label.toLowerCase().includes(normalizedQuery)
        ? group.models.filter((entry) =>
            entry.label.toLowerCase().includes(normalizedQuery) ||
            entry.routes.some((route) =>
              `${route.modelId} ${route.providerName}`.toLowerCase().includes(normalizedQuery)))
        : group.models,
    }))
    .filter((group) => group.models.length > 0), [catalog, normalizedQuery]);
  const currentGroupId = visibleGroups.find((group) => group.models.some((entry) =>
    entry.routes.some((route) => route.providerId === selectedProviderId &&
      modelIdsEqual(route.modelId, selectedModelId))))?.id;
  const effectiveBrandId = brandId && visibleGroups.some((group) => group.id === brandId)
    ? brandId
    : normalizedQuery ? visibleGroups[0]?.id : currentGroupId ?? visibleGroups[0]?.id;
  const selectedGroup = visibleGroups.find((group) => group.id === effectiveBrandId);
  const isCompact = width < 720;

  function selectEntry(entry: ModelRouteEntry) {
    if (entry.routes.length === 1) {
      onSelect(entry.routes[0].modelId, entry.routes[0].providerId);
      return;
    }
    setRouteEntry(entry);
  }

  const currentRoute = (entry: ModelRouteEntry) => entry.routes.find((route) =>
    route.providerId === selectedProviderId && modelIdsEqual(route.modelId, selectedModelId));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.panel, {
          backgroundColor: theme.surfaceElevated,
          borderColor: theme.border,
          height: isCompact ? Math.min(height * 0.86, 720) : undefined,
          maxHeight: Math.min(height * 0.86, 720),
          minHeight: isCompact ? undefined : Math.min(height * 0.75, 360),
          paddingBottom: Math.max(insets.bottom, Spacing.three),
        }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerText}>
              <ThemedText type="code" themeColor="accent">MODEL / ROUTE</ThemedText>
              <ThemedText style={styles.title}>{routeEntry ? '选择连接线路' : title}</ThemedText>
              {routeEntry ? (
                <ThemedText type="small" themeColor="textMuted">{routeEntry.label} 有 {routeEntry.routes.length} 条可用线路</ThemedText>
              ) : (
                <ThemedText type="small" themeColor="textMuted">
                  按模型名称归类{mergedRouteCount ? ` · ${mergedRouteCount} 条同名线路已折叠` : ''}
                </ThemedText>
              )}
            </View>
            <Pressable onPress={onClose} accessibilityLabel="关闭模型选择" hitSlop={10}>
              <ThemedText type="smallBold" themeColor="accent">关闭</ThemedText>
            </Pressable>
          </View>

          {!routeEntry ? (
            <TextInput
              value={query}
              onChangeText={(value) => { setQuery(value); setBrandId(null); }}
              placeholder="搜索品牌、模型或线路"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
            />
          ) : null}

          <View style={styles.body}>
            {routeEntry ? (
              <ScrollView contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                <Pressable onPress={() => setRouteEntry(null)} style={styles.backRow}>
                  <ThemedText type="smallBold" themeColor="accent">‹ 返回模型</ThemedText>
                </Pressable>
                {routeEntry.routes.map((route) => {
                  const selected = route.providerId === selectedProviderId && modelIdsEqual(route.modelId, selectedModelId);
                  return (
                    <Pressable key={`${route.providerId}:${route.modelId}`}
                      onPress={() => onSelect(route.modelId, route.providerId)}
                      style={({ pressed }) => [styles.row, {
                        backgroundColor: selected ? theme.accentMuted : theme.backgroundElement,
                        borderColor: selected ? theme.accent : theme.border,
                      }, pressed && styles.pressed]}>
                      <View style={styles.rowCopy}>
                        <ThemedText type="smallBold">{route.providerName}</ThemedText>
                        <ThemedText type="code" themeColor="textMuted" numberOfLines={1}>{route.modelId}</ThemedText>
                      </View>
                      {selected ? <ThemedText type="smallBold" themeColor="accent">当前</ThemedText> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={[styles.catalog, isCompact && styles.catalogCompact]}>
                <ScrollView style={[styles.brandPane, isCompact && styles.brandPaneCompact]}
                  horizontal={isCompact} showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[styles.brandContent, isCompact && styles.brandContentCompact]}>
                  {followOption ? (
                    <Pressable onPress={followOption.onPress}
                      style={({ pressed }) => [styles.brandRow, !selectedModelId && { backgroundColor: theme.accentMuted }, pressed && styles.pressed]}>
                      <View style={styles.followCopy}>
                        <ThemedText type="smallBold" numberOfLines={1}>{followOption.label}</ThemedText>
                        {!isCompact ? <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>{followOption.description}</ThemedText> : null}
                      </View>
                    </Pressable>
                  ) : null}
                  {visibleGroups.map((group) => {
                    const active = effectiveBrandId === group.id;
                    const logo = providerLogoSource(group.id);
                    return (
                      <Pressable key={group.id} onPress={() => setBrandId(group.id)}
                        accessibilityRole="button" accessibilityState={{ selected: active }}
                        style={({ pressed }) => [styles.brandRow, {
                          backgroundColor: active ? theme.accentMuted : 'transparent',
                          borderColor: active ? theme.accent : 'transparent',
                        }, pressed && styles.pressed]}>
                        {logo ? <Image source={logo} style={styles.brandLogo} contentFit="contain" /> : null}
                        <ThemedText type="smallBold" numberOfLines={1}>{group.label}</ThemedText>
                        <ThemedText type="code" themeColor="textMuted">{group.models.length}</ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <ScrollView style={styles.modelPane} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                  {visibleGroups.length === 0 ? (
                    <ThemedText type="small" themeColor="textMuted" style={styles.empty}>没有匹配的模型</ThemedText>
                  ) : null}
                  {(selectedGroup ?? visibleGroups[0])?.models.map((entry) => {
                    const route = currentRoute(entry);
                    return (
                      <Pressable key={entry.key} onPress={() => selectEntry(entry)}
                        accessibilityRole="button" accessibilityState={{ selected: Boolean(route) }}
                        style={({ pressed }) => [styles.row, {
                          backgroundColor: route ? theme.accentMuted : theme.backgroundElement,
                          borderColor: route ? theme.accent : theme.border,
                        }, pressed && styles.pressed]}>
                        <View style={styles.rowCopy}>
                          <ThemedText type="smallBold" numberOfLines={1}>{entry.label}</ThemedText>
                          <ThemedText type="code" themeColor="textMuted" numberOfLines={1}>
                            {entry.routes[0].modelId}
                          </ThemedText>
                          {entry.routes.length > 1 ? (
                            <ThemedText type="small" themeColor="textMuted">
                              {entry.routes.length} 条线路 · {entry.routes.map((item) => item.providerName).join(' / ')}
                            </ThemedText>
                          ) : (
                            <ThemedText type="small" themeColor="textMuted">{entry.routes[0].providerName}</ThemedText>
                          )}
                        </View>
                        <ThemedText type="smallBold" themeColor={route ? 'accent' : 'textMuted'}>{route ? '当前' : '›'}</ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.three, backgroundColor: 'rgba(19, 15, 13, 0.66)' },
  panel: { width: '100%', maxWidth: 920, borderWidth: 1, borderRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth, padding: Spacing.four },
  headerText: { flex: 1, gap: 4 },
  title: { fontSize: 23, lineHeight: 29, fontWeight: '700' },
  search: { marginHorizontal: Spacing.four, marginVertical: Spacing.three, minHeight: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: Spacing.three, fontSize: 14 },
  body: { flex: 1, minHeight: 0 },
  catalog: { flex: 1, flexDirection: 'row' },
  catalogCompact: { flexDirection: 'column' },
  brandPane: { width: 230, flexGrow: 0 },
  brandPaneCompact: { width: '100%', maxHeight: 64 },
  brandContent: { paddingHorizontal: Spacing.two, paddingBottom: Spacing.three, gap: 4 },
  brandContentCompact: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingBottom: 0 },
  brandRow: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  brandLogo: { width: 20, height: 20 },
  followCopy: { flex: 1, minWidth: 0, gap: 2 },
  modelPane: { flex: 1, minWidth: 0, minHeight: 0 },
  listContent: { padding: Spacing.three, gap: Spacing.two },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  backRow: { minHeight: 32, justifyContent: 'center' },
  empty: { padding: Spacing.three },
});
