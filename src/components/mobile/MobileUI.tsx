import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type MobileIconName = SymbolViewProps['name'];

export function MobileIcon({ name, size = 22, color }: { name: MobileIconName; size?: number; color?: string }) {
  const theme = useTheme();
  return <SymbolView accessible={false} name={name} size={size} tintColor={color ?? theme.primary} />;
}

export function MobilePageHeader({ title, subtitle, action, onBack, backLabel }: { title: string; subtitle?: string; action?: ReactNode; onBack?: () => void; backLabel?: string }) {
  const theme = useTheme();
  return <View style={[mobileStyles.header, { borderBottomColor: theme.outlineVariant }]}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel={backLabel ? `返回${backLabel}` : '返回'} onPress={onBack} style={mobileStyles.back}>
      <MobileIcon name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} />
      {backLabel ? <ThemedText type="small" themeColor="primary">{backLabel}</ThemedText> : null}
    </Pressable> : null}
    <View style={mobileStyles.headerCopy}><ThemedText accessibilityRole="header" style={mobileStyles.headerTitle}>{title}</ThemedText>{subtitle ? <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText> : null}</View>
    {action}
  </View>;
}

export function MobilePageIntro({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <View style={mobileStyles.intro}>
    <View style={mobileStyles.introCopy}><ThemedText accessibilityRole="header" style={mobileStyles.pageTitle}>{title}</ThemedText>{subtitle ? <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText> : null}</View>
    {action}
  </View>;
}

export function MobileSectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return <View style={mobileStyles.sectionHeading}><ThemedText accessibilityRole="header" style={mobileStyles.sectionTitle}>{title}</ThemedText>{action}</View>;
}

export function MobileAction({ label, onPress, icon, variant = 'primary', disabled, busy, style }: {
  label: string; onPress: () => void; icon?: MobileIconName; variant?: 'primary' | 'secondary' | 'text' | 'danger'; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const color = variant === 'primary' ? theme.onPrimary : variant === 'danger' ? theme.error : theme.primary;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [mobileStyles.action, { backgroundColor: variant === 'primary' ? theme.primary : 'transparent', borderColor: variant === 'secondary' ? theme.outlineVariant : 'transparent', borderWidth: variant === 'secondary' ? 1 : 0 }, variant === 'text' && mobileStyles.textAction, (disabled || busy) && mobileStyles.disabled, pressed && mobileStyles.pressed, style]}>
    {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <MobileIcon name={icon} size={20} color={color} /> : null}
    <ThemedText style={[mobileStyles.actionLabel, { color }]}>{label}</ThemedText>
  </Pressable>;
}

export function MobileSegmentedTabs<T extends string>({ items, value, onChange }: { items: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const theme = useTheme();
  return <View accessibilityRole="tablist" style={[mobileStyles.tabs, { backgroundColor: theme.surfaceVariant }]}>{items.map(item => <Pressable key={item.value} accessibilityRole="tab" accessibilityState={{ selected: item.value === value }} onPress={() => onChange(item.value)}
    style={({ pressed }) => [mobileStyles.tab, items.length > 3 && { flexBasis: 48 }, item.value === value && { backgroundColor: theme.primaryContainer }, pressed && mobileStyles.pressed]}>
    <ThemedText type={item.value === value ? 'smallBold' : 'small'} themeColor={item.value === value ? 'onPrimaryContainer' : 'textSecondary'} style={mobileStyles.tabLabel}>{item.label}</ThemedText>
  </Pressable>)}</View>;
}

export function MobileEmptyState({ title, description, icon, action }: { title: string; description: string; icon?: MobileIconName; action?: ReactNode }) {
  const theme = useTheme();
  return <View style={mobileStyles.empty}>{icon ? <View style={[mobileStyles.emptyIcon, { backgroundColor: theme.primaryContainer }]}><MobileIcon name={icon} size={28} /></View> : null}<ThemedText style={mobileStyles.sectionTitle}>{title}</ThemedText><ThemedText themeColor="textSecondary" style={mobileStyles.emptyDescription}>{description}</ThemedText>{action}</View>;
}

export const mobileStyles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 }, headerTitle: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
  back: { minWidth: 44, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 },
  intro: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }, introCopy: { flex: 1, minWidth: 160, gap: 6 },
  pageTitle: { fontFamily: Fonts.serif, fontSize: 28, lineHeight: 38, fontWeight: '600' },
  sectionHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  action: { minHeight: 48, minWidth: 48, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actionLabel: { fontSize: 15, lineHeight: 22, fontWeight: '700', flexShrink: 1 }, textAction: { paddingHorizontal: 4 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, padding: 4, gap: 4 },
  tab: { flexGrow: 1, flexBasis: 72, minHeight: 44, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 10, justifyContent: 'center', alignItems: 'center' }, tabLabel: { textAlign: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.sans, fontSize: 16, lineHeight: 24 },
  empty: { paddingVertical: 32, gap: 12, alignItems: 'flex-start' }, emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, emptyDescription: { lineHeight: 26 },
  pressed: { opacity: 0.7 }, disabled: { opacity: 0.45 },
});
