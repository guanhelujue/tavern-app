import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { DraftTextInput } from '@/components/ui/DraftTextInput';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CharacterCardUiTheme } from '@/utils/character-card-ui-theme';

type NovelFormFieldProps = {
  label?: string;
  /** 隐藏标签行（问答卡片自带标题时使用）。 */
  hideLabel?: boolean;
  value: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  minHeight?: number;
  onChangeText: (value: string) => void;
  onFocus?: TextInputProps['onFocus'];
  keyboardType?: TextInputProps['keyboardType'];
  preserveDraft?: boolean;
  /** Optional character-card chrome override (edit-on-card modal). */
  chrome?: CharacterCardUiTheme | null;
  editable?: boolean;
};

export function NovelFormField({
  label,
  hideLabel,
  value,
  placeholder,
  required,
  multiline,
  minHeight,
  onChangeText,
  onFocus,
  keyboardType,
  preserveDraft = false,
  chrome,
  editable = true,
}: NovelFormFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const labelColor = chrome?.label ?? theme.text;
  const mutedColor = chrome?.textMuted ?? theme.textMuted;
  const inputBg = chrome?.inputBackground ?? theme.backgroundElement;
  const inputBorder = chrome?.inputBorder ?? theme.border;
  const textColor = chrome?.text ?? theme.text;
  const inputRadius = chrome?.inputRadius ?? 16;

  const showLabel = !hideLabel && (Boolean(label?.trim()) || Boolean(required));
  const InputComponent = preserveDraft ? DraftTextInput : TextInput;

  return (
    <View style={styles.field}>
      {showLabel ? (
        <View style={styles.labelRow}>
          {chrome ? (
            <Text style={[styles.chromeLabel, { color: labelColor }]}>{label}</Text>
          ) : (
            <ThemedText type="smallBold">{label}</ThemedText>
          )}
          {required ? <ThemedText style={styles.required}>*</ThemedText> : null}
        </View>
      ) : null}
      <InputComponent
        accessibilityLabel={label}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={mutedColor}
        autoCapitalize="none"
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        onChangeText={onChangeText}
        editable={editable}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={() => setFocused(false)}
        showSoftInputOnFocus
        contextMenuHidden={false}
        scrollEnabled={Boolean(multiline)}
        style={[
          styles.input,
          multiline && styles.multiline,
          multiline && minHeight ? { minHeight } : null,
          {
            backgroundColor: focused && !chrome ? theme.surfaceElevated : inputBg,
            borderColor: focused && !chrome ? theme.primary : inputBorder,
            color: textColor,
            borderRadius: inputRadius,
            shadowColor: theme.shadow,
            shadowOpacity: focused && !chrome ? 0.08 : 0,
            shadowRadius: focused && !chrome ? 8 : 0,
            shadowOffset: { width: 0, height: 3 },
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chromeLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  required: {
    color: '#c45c3a',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    width: '100%',
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  multiline: {
    minHeight: 96,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
});
