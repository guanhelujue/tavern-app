import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  MAX_CHAT_BACKGROUND_OPACITY,
  MIN_CHAT_BACKGROUND_OPACITY,
  pickNovelImage,
  resolveNovelImageUri,
} from '@/utils/novel-images';
import { showAppAlert } from '@/utils/app-alert';

type NovelImagePickerFieldProps = {
  label: string;
  hint: string;
  kind: 'cover' | 'background';
  uri?: string;
  onChangeUri: (uri: string | undefined) => void;
  opacity?: number;
  onChangeOpacity?: (opacity: number) => void;
};

export function NovelImagePickerField({
  label,
  hint,
  kind,
  uri,
  onChangeUri,
  opacity,
  onChangeOpacity,
}: NovelImagePickerFieldProps) {
  const theme = useTheme();
  const [isPicking, setIsPicking] = useState(false);
  const showOpacity = kind === 'background' && typeof opacity === 'number' && onChangeOpacity;

  async function handlePick() {
    if (isPicking) {
      return;
    }

    setIsPicking(true);

    try {
      const nextUri = await pickNovelImage(kind);

      if (nextUri) {
        onChangeUri(nextUri);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择图片失败。';
      showAppAlert('无法选择图片', message);
    } finally {
      setIsPicking(false);
    }
  }

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        {hint}
      </ThemedText>

      <Pressable
        onPress={handlePick}
        style={({ pressed }) => [
          styles.picker,
          kind === 'cover' ? styles.coverPicker : styles.backgroundPicker,
          {
            borderColor: theme.border,
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          },
        ]}>
        {uri ? (
          <Image
            source={{ uri: resolveNovelImageUri(uri) ?? uri }}
            style={[styles.preview, showOpacity ? { opacity } : null]}
            contentFit={kind === 'background' ? 'contain' : 'cover'}
            contentPosition="center"
          />
        ) : (
          <View style={styles.placeholder}>
            <ThemedText type="smallBold" themeColor="accent">
              {isPicking ? '打开中…' : '+ 从相册选择'}
            </ThemedText>
          </View>
        )}
      </Pressable>

      {uri ? (
        <Pressable onPress={() => onChangeUri(undefined)} hitSlop={8}>
          <ThemedText type="code" themeColor="accent">
            清除图片
          </ThemedText>
        </Pressable>
      ) : null}

      {showOpacity ? (
        <View style={styles.opacityBlock}>
          <View style={styles.opacityHeader}>
            <ThemedText type="smallBold">背景不透明度</ThemedText>
            <ThemedText type="code" themeColor="textMuted">
              {Math.round(opacity * 100)}%
            </ThemedText>
          </View>
          <Slider
            value={opacity}
            minimumValue={MIN_CHAT_BACKGROUND_OPACITY}
            maximumValue={MAX_CHAT_BACKGROUND_OPACITY}
            step={0.01}
            onValueChange={onChangeOpacity}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.accent}
          />
          <ThemedText type="small" themeColor="textMuted">
            数值越低，背景越淡，对话文字越易读
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  picker: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  coverPicker: {
    height: 168,
    width: '56%',
    alignSelf: 'flex-start',
  },
  backgroundPicker: {
    height: 140,
    width: '100%',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  opacityBlock: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  opacityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
