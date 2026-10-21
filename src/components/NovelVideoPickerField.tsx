import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { pickNovelVideo } from '@/utils/novel-images';
import { showAppAlert } from '@/utils/app-alert';

type NovelVideoPickerFieldProps = {
  uri?: string;
  onChangeUri: (uri: string | undefined) => void;
};

export function NovelVideoPickerField({ uri, onChangeUri }: NovelVideoPickerFieldProps) {
  const theme = useTheme();
  const [isPicking, setIsPicking] = useState(false);

  async function handlePick() {
    if (isPicking) {
      return;
    }

    setIsPicking(true);
    try {
      const nextUri = await pickNovelVideo();
      if (nextUri) {
        onChangeUri(nextUri);
      }
    } catch (error) {
      showAppAlert('无法选择视频', error instanceof Error ? error.message : '视频选择失败，请重试。');
    } finally {
      setIsPicking(false);
    }
  }

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">视频背景</ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        可选。视频会静音、循环播放，并自动铺满小说聊天页。
      </ThemedText>
      <Pressable
        onPress={handlePick}
        style={({ pressed }) => [
          styles.picker,
          {
            borderColor: theme.border,
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          },
        ]}>
        <ThemedText type="smallBold" themeColor="accent">
          {isPicking ? '打开中…' : uri ? '已选择视频，点击更换' : '从相册选择视频'}
        </ThemedText>
      </Pressable>
      {uri ? (
        <Pressable onPress={() => onChangeUri(undefined)} hitSlop={8}>
          <ThemedText type="code" themeColor="accent">
            清除视频背景
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.two,
  },
  picker: {
    minHeight: 84,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
