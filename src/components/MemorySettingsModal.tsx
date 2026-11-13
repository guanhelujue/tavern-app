import { KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import {
  clampContextLength,
  DEFAULT_CONTEXT_LENGTH,
  MAX_CONTEXT_LENGTH,
  MIN_CONTEXT_LENGTH,
} from '@/constants/session-config';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';

type MemorySettingsModalProps = {
  visible: boolean;
  value: number;
  onClose: () => void;
  onSave: (contextLength: number) => void;
  /** Novel chats: clarify this is raw dialogue window length, not auto LTM/STM. */
  variant?: 'default' | 'window';
};

export function MemorySettingsModal({
  visible,
  value,
  onClose,
  onSave,
  variant = 'default',
}: MemorySettingsModalProps) {
  const theme = useTheme();
  const [draftText, setDraftText] = useState(String(value || DEFAULT_CONTEXT_LENGTH));
  const isWindow = variant === 'window';

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => setDraftText(String(value || DEFAULT_CONTEXT_LENGTH)), 0);
      return () => clearTimeout(timer);
    }
  }, [value, visible]);

  function parseDraft() {
    const parsed = Number.parseInt(draftText, 10);
    return Number.isFinite(parsed) ? parsed : DEFAULT_CONTEXT_LENGTH;
  }

  function step(delta: number) {
    const next = clampContextLength(parseDraft() + delta);
    setDraftText(String(next));
  }

  function handleChangeText(next: string) {
    // Allow empty while typing; digits only.
    if (next === '' || /^\d+$/.test(next)) {
      setDraftText(next);
    }
  }

  function handleBlur() {
    setDraftText(String(clampContextLength(parseDraft())));
  }

  function handleSave() {
    onSave(clampContextLength(parseDraft()));
    onClose();
  }

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={onClose} scrollable>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              {isWindow ? '对话窗口' : '记忆设定'}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
              <ThemedText themeColor="textMuted">✕</ThemedText>
            </Pressable>
          </View>

          <View style={styles.tips}>
            {isWindow ? (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  I. 控制每次请求携带的最近原文对话条数（与自动记忆阶梯无关）。
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  II. 建议偶数：用户一句 + AI 一句合计两条。
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  III. 窗口过长会增加 Token；长剧情摘要请用「记忆阶梯」。
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  IV. 范围 {MIN_CONTEXT_LENGTH}–{MAX_CONTEXT_LENGTH}，默认 {DEFAULT_CONTEXT_LENGTH}。
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  I. 建议使用偶数：用户一句 + AI 一句合计两条记录。
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  II. 记忆过长会增加 Token 消耗，建议 6–10。
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  III. 若作品本身已有完整设定，可适当减小长度。
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  IV. 当前范围 {MIN_CONTEXT_LENGTH}–{MAX_CONTEXT_LENGTH}，默认{' '}
                  {DEFAULT_CONTEXT_LENGTH}。
                </ThemedText>
              </>
            )}
          </View>

          <View style={styles.stepperRow}>
            <Pressable
              onPress={() => step(-1)}
              style={({ pressed }) => [
                styles.stepButton,
                { borderColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="accent">
                ‹
              </ThemedText>
            </Pressable>
            <TextInput
              value={draftText}
              onChangeText={handleChangeText}
              onBlur={handleBlur}
              keyboardType="number-pad"
              selectTextOnFocus
              style={[
                styles.valueInput,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.background,
                  color: theme.text,
                },
              ]}
            />
            <Pressable
              onPress={() => step(1)}
              style={({ pressed }) => [
                styles.stepButton,
                { borderColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="accent">
                ›
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.cancelButton}>
              <ThemedText type="smallBold" themeColor="accent">
                取消
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={styles.saveText}>
                保存
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardSafeModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
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
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tips: {
    gap: Spacing.two,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueInput: {
    minWidth: 72,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.three,
  },
  cancelButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
  pressed: {
    opacity: 0.75,
  },
});
