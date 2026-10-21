import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isNovelVideoUri, pickNovelBackground } from '@/utils/novel-images';
import { showAppAlert } from '@/utils/app-alert';

type Props = {
  uri?: string;
  onChangeUri: (uri: string | undefined) => void;
  label?: string;
  hint?: string;
  kind?: 'background';
};

export function NovelBackgroundPickerField({ uri, onChangeUri }: Props) {
  const theme = useTheme();
  const [isPicking, setIsPicking] = useState(false);
  const isVideo = isNovelVideoUri(uri);

  async function handlePick() {
    if (isPicking) return;
    setIsPicking(true);
    try {
      const nextUri = await pickNovelBackground();
      if (nextUri) onChangeUri(nextUri);
    } catch (error) {
      showAppAlert('无法选择背景', error instanceof Error ? error.message : '背景选择失败，请重试。');
    } finally {
      setIsPicking(false);
    }
  }

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">对话背景</ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        图片和视频共用一个选择入口；视频会循环播放并自动静音。
      </ThemedText>
      <Pressable
        onPress={handlePick}
        style={({ pressed }) => [styles.picker, {
          borderColor: theme.border,
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
        }]}>
        <ThemedText type="smallBold" themeColor="accent">
          {isPicking ? '打开中…' : uri ? `已选择${isVideo ? '视频' : '图片'}，点击更换` : '选择图片或视频'}
        </ThemedText>
      </Pressable>
      {uri ? <Pressable onPress={() => onChangeUri(undefined)} hitSlop={8}>
        <ThemedText type="code" themeColor="accent">清除背景</ThemedText>
      </Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.two },
  picker: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
