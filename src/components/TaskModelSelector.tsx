import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ModelRoutePicker } from '@/components/ModelRoutePicker';
import { ThemedText } from '@/components/themed-text';
import { AI_TASKS } from '@/constants/ai-tasks';
import { providerLogoSource } from '@/constants/provider-logos';
import { useTheme } from '@/hooks/use-theme';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import type { AiTaskId } from '@/types/tavern';
import { modelDisplayName } from '@/utils/model-display-name';

type Props = { task: AiTaskId; disabled?: boolean };

export function TaskModelSelector({ task, disabled = false }: Props) {
  const theme = useTheme();
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const meta = AI_TASKS[task];
  const binding = generationSettings.taskModelBindings?.[task];
  const resolved = useMemo(() => {
    try { return resolveApiSettings(providers, generationSettings, { purpose: meta.purpose, task }); }
    catch { return null; }
  }, [providers, generationSettings, meta.purpose, task]);
  const invalid = Boolean(binding && !resolved);
  const logo = providerLogoSource(resolved?.providerId ?? binding?.providerId ?? '');
  const model = resolved?.model || binding?.modelId;
  const select = (modelId: string, providerId: string) => {
    if (disabled) return;
    const state = useTavernStore.getState();
    state.updateGenerationSettings({ taskModelBindings: { ...state.generationSettings.taskModelBindings, [task]: { modelId, providerId } } });
    setVisible(false);
  };
  const clear = () => {
    if (disabled) return;
    const state = useTavernStore.getState();
    const { [task]: _removed, ...rest } = state.generationSettings.taskModelBindings ?? {};
    state.updateGenerationSettings({ taskModelBindings: rest });
    setVisible(false);
  };
  return <View style={styles.root}>
    <Pressable disabled={disabled} onPress={() => setVisible(true)}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      accessibilityRole="button" accessibilityLabel={`选择${meta.label}模型`}
      accessibilityHint={`${binding ? '已固定' : '沿用默认'}：${model ?? '未配置'}，${resolved?.providerName ?? ''}。点击更换。`}
      accessibilityState={{ disabled, expanded: visible }}
      style={({ pressed }) => [styles.control, {
        backgroundColor: hovered || pressed ? theme.surfaceVariant : theme.surface,
        borderColor: invalid ? theme.error : focused || visible ? theme.primary : theme.outlineVariant,
      }, disabled && styles.disabled]}>
      <ThemedText style={styles.task} themeColor="textSecondary">{meta.label}</ThemedText>
      <View style={[styles.divider, { backgroundColor: theme.outlineVariant }]} />
      {logo && !invalid ? <Image source={logo} style={styles.logo} contentFit="contain" /> : <View style={[styles.statusDot, { backgroundColor: invalid ? theme.error : theme.primary }]} />}
      <ThemedText numberOfLines={1} style={styles.model} themeColor={invalid ? 'error' : 'text'}>{invalid ? '重新选择模型' : model ? modelDisplayName(model) : '选择模型'}</ThemedText>
      {!binding && <ThemedText style={styles.defaultLabel} themeColor="textMuted">默认</ThemedText>}
      <View style={[styles.chevron, { borderColor: theme.textMuted }]} />
    </Pressable>
    <ModelRoutePicker visible={visible} title={`选择${meta.label}模型`}
      description={`为${meta.label}单独选择模型。自动记住选择，其他功能不受影响。`}
      providers={providers} selectedModelId={binding?.modelId ?? resolved?.model}
      selectedProviderId={binding?.providerId ?? resolved?.providerId}
      onClose={() => setVisible(false)} onSelect={select}
      followOption={{ label: '沿用默认模型', description: '跟随系统设置，取消此功能的固定选择', selected: !binding, onPress: clear }} />
  </View>;
}

const styles = StyleSheet.create({
  root: { alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 1 },
  control: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8, maxWidth: 460 },
  task: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  divider: { height: 16, width: 1, marginHorizontal: 1 },
  logo: { width: 19, height: 19 },
  model: { fontSize: 13, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  defaultLabel: { fontSize: 11, lineHeight: 16 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  chevron: { width: 6, height: 6, borderBottomWidth: 1.5, borderRightWidth: 1.5, transform: [{ rotate: '45deg' }], marginLeft: 3, marginTop: -3 },
  disabled: { opacity: 0.45 },
});
