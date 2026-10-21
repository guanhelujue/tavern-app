import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const STEPS = [
  { index: 1, label: '基础信息' },
  { index: 2, label: '大致框架' },
  { index: 3, label: '模型选项' },
] as const;

type NovelCreateStepIndicatorProps = {
  step: 1 | 2 | 3;
  /** Highest step the user has reached; unlocked steps stay tappable after going back. */
  maxReachedStep: 1 | 2 | 3;
  onStepPress?: (step: 1 | 2 | 3) => void;
};

export function NovelCreateStepIndicator({
  step,
  maxReachedStep,
  onStepPress,
}: NovelCreateStepIndicatorProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {STEPS.map((item, index) => {
        const active = item.index === step;
        const unlocked = item.index <= maxReachedStep;
        const clickable = Boolean(onStepPress) && unlocked && item.index !== step;

        return (
          <View key={item.index} style={styles.itemWrap}>
            {index > 0 ? (
              <View
                style={[
                  styles.connector,
                  {
                    backgroundColor:
                      item.index <= maxReachedStep ? theme.accent : theme.border,
                  },
                ]}
              />
            ) : null}
            <Pressable
              disabled={!clickable}
              onPress={() => onStepPress?.(item.index)}
              style={styles.item}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: unlocked ? theme.accent : theme.backgroundElement,
                    borderColor: unlocked ? theme.accent : theme.border,
                    opacity: active ? 1 : unlocked ? 0.85 : 1,
                  },
                ]}>
                <ThemedText
                  type="code"
                  style={{ color: unlocked ? theme.onPrimary : theme.textMuted }}>
                  {item.index}
                </ThemedText>
              </View>
              <ThemedText
                type="smallBold"
                themeColor={active ? 'accent' : unlocked ? 'text' : 'textMuted'}>
                {item.label}
              </ThemedText>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.one,
  },
  itemWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  connector: {
    width: 12,
    height: 2,
    marginRight: 4,
    borderRadius: 1,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
