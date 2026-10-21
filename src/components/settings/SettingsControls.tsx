import { Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import type { ImageSource } from 'expo-image';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SettingsSelectRowProps = {
  label: string;
  value: string;
  muted?: boolean;
  onPress: () => void;
};

/** Compact settings row: label left, value + chevron right. */
export function SettingsSelectRow({ label, value, muted, onPress }: SettingsSelectRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}：${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectRow,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: pressed ? theme.primary : theme.border,
          transform: [{ translateY: pressed ? 1 : 0 }],
        },
      ]}>
      <ThemedText type="smallBold" style={styles.selectRowLabel}>
        {label}
      </ThemedText>
      <View style={styles.selectRowValue}>
        <ThemedText
          type="small"
          themeColor={muted ? 'textMuted' : 'textSecondary'}
          numberOfLines={1}
          style={styles.selectRowValueText}>
          {value}
        </ThemedText>
        <ThemedText type="code" themeColor="textMuted">
          ›
        </ThemedText>
      </View>
    </Pressable>
  );
}

export type SwitchRowProps = {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

export function SwitchRow({ label, description, value, onValueChange, disabled = false }: SwitchRowProps) {
  const theme = useTheme();

  return (
    <View style={styles.switchRow}>
      <View style={styles.switchCopy}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          {description}
        </ThemedText>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }}
        thumbColor={disabled ? theme.textMuted : value ? theme.accent : theme.textMuted}
      />
    </View>
  );
}

export type OptionsModalProps = {
  visible: boolean;
  title: string;
  options: {
    value: string;
    label: string;
    description?: string;
    icon?: ImageSource;
    accent?: string;
  }[];
  selectedValue: string;
  onClose: () => void;
  onSelect: (value: string) => void;
  searchable?: boolean;
};

export function OptionsModal({
  visible,
  title,
  options,
  selectedValue,
  onClose,
  onSelect,
  searchable = false,
}: OptionsModalProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      [option.label, option.description].filter(Boolean).join(' ').toLowerCase().includes(normalized),
    );
  }, [options, query]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.modalCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
          onPress={(event) => event.stopPropagation()}>
          <View style={styles.modalTitleRow}>
            <View style={[styles.modalSignal, { backgroundColor: theme.primary }]} />
            <View style={styles.modalTitleCopy}>
              <ThemedText type="code" themeColor="accent">SELECT / ROUTE</ThemedText>
              <ThemedText type="subtitle" style={styles.modalTitle}>{title}</ThemedText>
            </View>
          </View>
          {searchable ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="搜索厂商或模型"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.modalSearch, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]}
            />
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.modalList} showsVerticalScrollIndicator={false}>
            {filteredOptions.map((option) => {
              const isSelected = option.value === selectedValue;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => onSelect(option.value)}
                  style={({ pressed }) => [
                    styles.modalOption,
                    {
                      backgroundColor: isSelected ? theme.accentMuted : theme.backgroundElement,
                      borderColor: isSelected ? theme.accent : theme.border,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <View style={styles.modalOptionMain}>
                    {option.icon ? (
                      <Image source={option.icon} style={styles.modalOptionIcon} contentFit="contain" />
                    ) : option.accent ? (
                      <View style={[styles.modalOptionMark, { backgroundColor: option.accent }]} />
                    ) : null}
                    <View style={styles.modalOptionCopy}>
                      <ThemedText type="small" themeColor={isSelected ? 'accent' : 'text'}>
                        {option.label}
                      </ThemedText>
                      {option.description ? (
                        <ThemedText type="small" themeColor="textMuted">
                          {option.description}
                        </ThemedText>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={onClose} style={styles.modalClose}>
            <ThemedText type="code" themeColor="accent">
              关闭
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  selectRow: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  selectRowLabel: {
    flexShrink: 0,
  },
  selectRowValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    minWidth: 0,
  },
  selectRowValueText: {
    flexShrink: 1,
    textAlign: 'right',
  },
  switchRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  switchCopy: {
    flex: 1,
    gap: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(18, 12, 9, 0.45)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    paddingHorizontal: Platform.OS === 'web' ? Spacing.four : 0,
    paddingVertical: Platform.OS === 'web' ? Spacing.four : 0,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: Platform.OS === 'web' ? 22 : 26,
    borderBottomLeftRadius: Platform.OS === 'web' ? 22 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 22 : 0,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Platform.OS === 'web' ? Spacing.four : Spacing.five,
    gap: Spacing.three,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    maxHeight: '78%',
    shadowColor: '#120C09',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
    elevation: 18,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.three,
  },
  modalSignal: {
    width: 3,
    minHeight: 46,
  },
  modalTitleCopy: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  modalList: {
    maxHeight: 320,
  },
  modalSearch: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
  },
  modalOption: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    marginBottom: Spacing.two,
    gap: 2,
  },
  modalOptionMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  modalOptionCopy: {
    flex: 1,
    gap: 2,
  },
  modalOptionIcon: {
    width: 28,
    height: 28,
  },
  modalOptionMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  modalClose: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.75,
  },
});
