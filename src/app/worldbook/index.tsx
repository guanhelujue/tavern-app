import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AppPageHeader } from '@/components/ui/AppPageHeader';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import type { WorldbookEntry } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';

export default function WorldbookScreen() {
  const theme = useTheme();
  const {
    createWorldbookEntry,
    deleteWorldbookEntry,
    toggleWorldbookEntry,
    updateWorldbookEntry,
    worldbookEntries,
  } = useTavernStore();
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [keys, setKeys] = useState('');
  const [content, setContent] = useState('');
  const [enabled, setEnabled] = useState(true);

  const editingEntry = worldbookEntries.find((entry) => entry.id === editingEntryId);

  function resetForm() {
    setEditingEntryId(null);
    setKeys('');
    setContent('');
    setEnabled(true);
  }

  function startEditing(entry: WorldbookEntry) {
    setEditingEntryId(entry.id);
    setKeys(Array.isArray(entry.keys) ? entry.keys.join(', ') : entry.keys);
    setContent(entry.content);
    setEnabled(entry.enabled);
  }

  function handleSaveEntry() {
    const normalizedKeys = keys.trim();
    const normalizedContent = content.trim();

    if (!normalizedKeys || !normalizedContent) {
      showAppAlert('无法保存', '触发词和设定内容都不能为空。');
      return;
    }

    if (editingEntry) {
      updateWorldbookEntry(editingEntry.id, {
        keys: normalizedKeys,
        content: normalizedContent,
        enabled,
      });
    } else {
      createWorldbookEntry({
        keys: normalizedKeys,
        content: normalizedContent,
        enabled,
      });
    }

    resetForm();
  }

  async function handleDeleteEntry(entryId: string) {
    const entry = worldbookEntries.find((item) => item.id === entryId);
    if (!entry) return;
    const label = Array.isArray(entry.keys) ? entry.keys.join(', ') : entry.keys;
    if (!await confirmAppAction(
      '删除世界书词条',
      `确定删除「${label}」吗？删除后无法撤销。`,
      { confirmLabel: '删除' },
    )) return;
    deleteWorldbookEntry(entryId);

    if (entryId === editingEntryId) {
      resetForm();
    }
  }

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/settings');
  }

  return (
    <ThemedView decorated style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppPageHeader
            title="世界书管理"
            eyebrow="LEGACY / WORLDBOOK"
            index="WB"
            meta={`${worldbookEntries.length} 个词条`}
            description="最近几条对话里出现触发词时，会自动带上对应设定。"
            actions={
              <Pressable onPress={handleBack} style={[styles.backButton, { borderColor: theme.border }]}>
                <ThemedText type="code" themeColor="accent">← 返回</ThemedText>
              </Pressable>
            }
          />

          <ThemedView type="surface" style={[styles.panel, { borderColor: theme.border }]}>
            <SettingField
              label="触发词"
              value={keys}
              placeholder="例如：旧城区, 酒馆老板, 失踪案"
              onChangeText={setKeys}
            />
            <SettingField
              label="设定内容"
              value={content}
              placeholder="出现触发词时，需要让模型知道的世界观、人物关系或剧情事实。"
              multiline
              onChangeText={setContent}
            />
            <View style={styles.switchRow}>
              <View style={styles.switchCopy}>
                <ThemedText type="smallBold">启用词条</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  关闭后本条不会参与匹配
                </ThemedText>
              </View>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }}
                thumbColor={enabled ? theme.accent : theme.textMuted}
              />
            </View>

            <View style={styles.formActions}>
              <Pressable
                onPress={handleSaveEntry}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.accent },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  {editingEntry ? '保存修改' : '添加词条'}
                </ThemedText>
              </Pressable>
              {editingEntry ? (
                <Pressable
                  onPress={resetForm}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: theme.border },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    取消编辑
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          </ThemedView>

          <View style={styles.sectionTitle}>
            <ThemedText type="subtitle">词条列表</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {worldbookEntries.length} 个词条
            </ThemedText>
          </View>

          <View style={styles.entryList}>
            {worldbookEntries.map((entry) => (
              <ThemedView
                key={entry.id}
                type="surface"
                style={[styles.entryCard, { borderColor: theme.border }]}>
                <View style={styles.entryHeader}>
                  <View style={styles.entryCopy}>
                    <ThemedText type="smallBold">
                      {Array.isArray(entry.keys) ? entry.keys.join(', ') : entry.keys}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
                      {entry.content}
                    </ThemedText>
                  </View>
                  <Switch
                    value={entry.enabled}
                    onValueChange={() => toggleWorldbookEntry(entry.id)}
                    trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }}
                    thumbColor={entry.enabled ? theme.accent : theme.textMuted}
                  />
                </View>

                <View style={styles.entryActions}>
                  <Pressable
                    onPress={() => startEditing(entry)}
                    style={({ pressed }) => [
                      styles.smallAction,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="code" themeColor="accent">
                      编辑
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteEntry(entry.id)}
                    style={({ pressed }) => [
                      styles.smallAction,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="code" themeColor="error">
                      删除
                    </ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            ))}

            {worldbookEntries.length === 0 ? (
              <ThemedView type="accentMuted" style={styles.emptyState}>
                <ThemedText type="smallBold" themeColor="accent">
                  还没有世界书词条
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  添加触发词后，对话里出现相关词时会自动带上设定。
                </ThemedText>
              </ThemedView>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

type SettingFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onChangeText: (value: string) => void;
};

function SettingField({ label, value, placeholder, multiline, onChangeText }: SettingFieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        value={value}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  backButton: {
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    borderWidth: 1,
    borderRadius: 28,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderRadius: 18,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 120,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  switchCopy: {
    flex: 1,
  },
  formActions: {
    gap: Spacing.two,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  primaryButtonText: {
    color: '#120c09',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  sectionTitle: {
    gap: Spacing.one,
  },
  entryList: {
    gap: Spacing.three,
  },
  entryCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  entryCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  entryActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  smallAction: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  emptyState: {
    borderRadius: 24,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.75,
  },
});
