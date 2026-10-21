import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import Slider from '@react-native-community/slider';

import { NovelBackgroundPickerField } from '@/components/NovelBackgroundPickerField';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { clampBubbleOpacity } from '@/constants/session-config';
import {
  clampChatBackgroundOpacity,
  MAX_CHAT_BACKGROUND_OPACITY,
  MIN_CHAT_BACKGROUND_OPACITY,
} from '@/utils/novel-images';

type PageSettingsModalProps = {
  visible: boolean;
  backgroundEnabled: boolean;
  backgroundUri?: string;
  backgroundOpacity: number;
  bubbleOpacity: number;
  showBackgroundControls?: boolean;
  onClose: () => void;
  onSave: (next: {
    backgroundEnabled: boolean;
    backgroundOpacity: number;
    bubbleOpacity: number;
    backgroundUri?: string;
  }) => void;
};

export function PageSettingsModal({
  visible,
  backgroundEnabled,
  backgroundUri,
  backgroundOpacity,
  bubbleOpacity,
  showBackgroundControls = true,
  onClose,
  onSave,
}: PageSettingsModalProps) {
  const theme = useTheme();
  const [enabled, setEnabled] = useState(backgroundEnabled);
  const [selectedBackgroundUri, setSelectedBackgroundUri] = useState(backgroundUri);
  const [bgOpacity, setBgOpacity] = useState(backgroundOpacity);
  const [customOpacity, setCustomOpacity] = useState(true);
  const [bubble, setBubble] = useState(bubbleOpacity);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        setEnabled(backgroundEnabled);
        setSelectedBackgroundUri(backgroundUri);
        setBgOpacity(backgroundOpacity);
        setBubble(bubbleOpacity);
        setCustomOpacity(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [backgroundEnabled, backgroundOpacity, backgroundUri, bubbleOpacity, visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
          onPress={() => undefined}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              背景图设置
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <ThemedText themeColor="textMuted">✕</ThemedText>
            </Pressable>
          </View>

          {showBackgroundControls ? (
            <>
              <NovelBackgroundPickerField
                label="对话背景图片"
                hint="可选；选择图片后会替换当前视频背景。"
                uri={selectedBackgroundUri}
                onChangeUri={setSelectedBackgroundUri}
              />
              <View style={styles.row}>
                <ThemedText type="smallBold">开启背景图</ThemedText>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  trackColor={{ false: theme.border, true: theme.accentMuted }}
                  thumbColor={enabled ? theme.accent : theme.textMuted}
                />
              </View>

              <View style={styles.row}>
                <ThemedText type="smallBold">自定义背景透明度</ThemedText>
                <Switch
                  value={customOpacity}
                  onValueChange={setCustomOpacity}
                  trackColor={{ false: theme.border, true: theme.accentMuted }}
                  thumbColor={customOpacity ? theme.accent : theme.textMuted}
                />
              </View>

              <View style={[styles.sliderBlock, !customOpacity && styles.disabled]}>
                <View style={styles.row}>
                  <ThemedText type="smallBold">背景不透明度</ThemedText>
                  <ThemedText type="code" themeColor="textMuted">
                    {Math.round(bgOpacity * 100)}%
                  </ThemedText>
                </View>
                <Slider
                  disabled={!customOpacity || !enabled}
                  value={bgOpacity}
                  minimumValue={MIN_CHAT_BACKGROUND_OPACITY}
                  maximumValue={MAX_CHAT_BACKGROUND_OPACITY}
                  step={0.01}
                  onValueChange={setBgOpacity}
                  minimumTrackTintColor={theme.accent}
                  maximumTrackTintColor={theme.border}
                  thumbTintColor={theme.accent}
                />
              </View>
            </>
          ) : null}

          <View style={styles.sliderBlock}>
            <View style={styles.row}>
              <ThemedText type="smallBold">气泡不透明度</ThemedText>
              <ThemedText type="code" themeColor="textMuted">
                {Math.round(bubble * 100)}%
              </ThemedText>
            </View>
            <Slider
              value={bubble}
              minimumValue={0.2}
              maximumValue={1}
              step={0.01}
              onValueChange={setBubble}
              minimumTrackTintColor={theme.accent}
              maximumTrackTintColor={theme.border}
              thumbTintColor={theme.accent}
            />
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
                  backgroundEnabled: enabled,
                  backgroundOpacity: clampChatBackgroundOpacity(bgOpacity),
                  bubbleOpacity: clampBubbleOpacity(bubble),
                  backgroundUri: selectedBackgroundUri,
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
    </Modal>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  sliderBlock: {
    gap: Spacing.one,
  },
  disabled: {
    opacity: 0.45,
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
