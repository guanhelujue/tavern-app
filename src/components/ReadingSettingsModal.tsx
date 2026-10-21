import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import {
  CHAT_FONT_FAMILY_OPTIONS,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  clampChatFontSize,
  resolveChatFontFamily,
  type ChatFontFamilyId,
} from '@/constants/reading';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';

type ReadingSettingsModalProps = {
  visible: boolean;
  fontFamily: ChatFontFamilyId;
  fontSize: number;
  onClose: () => void;
  onSave: (next: { fontFamily: ChatFontFamilyId; fontSize: number }) => void;
};

export function ReadingSettingsModal({
  visible,
  fontFamily,
  fontSize,
  onClose,
  onSave,
}: ReadingSettingsModalProps) {
  const theme = useTheme();
  const [family, setFamily] = useState<ChatFontFamilyId>(fontFamily);
  const [sizeText, setSizeText] = useState(String(fontSize));

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        setFamily(fontFamily);
        setSizeText(String(fontSize));
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [fontFamily, fontSize, visible]);

  const previewSize = clampChatFontSize(Number.parseInt(sizeText, 10));

  function commitSizeText() {
    const next = clampChatFontSize(Number.parseInt(sizeText, 10));
    setSizeText(String(next));
    return next;
  }

  return (
    <KeyboardSafeModal
      visible={visible}
      onRequestClose={onClose}
      scrollable>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => undefined}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              阅读设置
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <ThemedText themeColor="textMuted">✕</ThemedText>
            </Pressable>
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">正文字体</ThemedText>
            <View style={styles.fontOptions}>
              {CHAT_FONT_FAMILY_OPTIONS.map((option) => {
                const selected = family === option.id;
                const optionFont = resolveChatFontFamily(option.id);

                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setFamily(option.id)}
                    style={({ pressed }) => [
                      styles.fontOption,
                      {
                        borderColor: selected ? theme.accent : theme.border,
                        backgroundColor: selected
                          ? theme.backgroundSelected
                          : theme.backgroundElement,
                      },
                      pressed && { opacity: 0.8 },
                    ]}>
                    <ThemedText type="smallBold" style={optionFont ? { fontFamily: optionFont } : undefined}>
                      {option.label}
                    </ThemedText>
                    <ThemedText type="code" themeColor="textMuted">
                      {option.description}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.row}>
              <ThemedText type="smallBold">文字大小</ThemedText>
              <ThemedText type="code" themeColor="textMuted">
                {CHAT_FONT_SIZE_MIN}–{CHAT_FONT_SIZE_MAX}
              </ThemedText>
            </View>
            <View style={styles.sizeRow}>
              <TextInput
                value={sizeText}
                onChangeText={(value) => setSizeText(value.replace(/[^\d]/g, ''))}
                onBlur={() => {
                  commitSizeText();
                }}
                keyboardType="number-pad"
                maxLength={2}
                placeholder={String(CHAT_FONT_SIZE_MIN)}
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.sizeInput,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                    color: theme.text,
                  },
                ]}
              />
              <ThemedText themeColor="textSecondary">px</ThemedText>
            </View>
            <ThemedText
              style={{
                fontSize: previewSize,
                lineHeight: Math.round(previewSize * 1.55),
                fontFamily: resolveChatFontFamily(family),
                color: theme.textSecondary,
              }}>
              预览：宋楷各异 —— 夜色渐深，炉火仍在低语。
            </ThemedText>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onClose}>
              <ThemedText type="smallBold" themeColor="accent">
                取消
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                onSave({
                  fontFamily: family,
                  fontSize: commitSizeText(),
                });
                onClose();
              }}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.75 },
              ]}>
              <ThemedText type="smallBold" style={styles.saveText}>
                保存
              </ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </KeyboardSafeModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    backgroundColor: 'rgba(23, 18, 15, 0.28)',
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
  },
  section: {
    gap: Spacing.two,
  },
  fontOptions: {
    gap: Spacing.two,
  },
  fontOption: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  sizeInput: {
    width: 72,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.two,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.three,
  },
  saveButton: {
    borderRadius: 18,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: '#120c09',
  },
});
