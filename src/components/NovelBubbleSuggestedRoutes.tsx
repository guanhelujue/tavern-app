import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { extractSuggestedRoutesFromAssistantContent } from '@/utils/status-bar-html';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

type NovelBubbleSuggestedRoutesProps = {
  content: string;
  /**
   * Optional override (e.g. sessionMeta.suggestedRoutes from utility fallback).
   * When non-empty, options use these instead of parsing `content`.
   */
  routes?: string[];
  /** True while store utility fallback is still generating routes. */
  isSuggesting?: boolean;
  disabled?: boolean;
  onSelect: (route: string) => void;
};

/**
 * Multiple-choice style suggested routes (A/B/C/D) inside the assistant bubble.
 * `content` must be the raw message body (not route-stripped).
 */
export function NovelBubbleSuggestedRoutes({
  content,
  routes: routesProp,
  isSuggesting = false,
  disabled = false,
  onSelect,
}: NovelBubbleSuggestedRoutesProps) {
  const theme = useTheme();
  const fromProp = (routesProp ?? []).map((route) => route.trim()).filter(Boolean).slice(0, 4);
  const fromContent = extractSuggestedRoutesFromAssistantContent(content);
  const routes = fromProp.length > 0 ? fromProp : fromContent;

  if (routes.length === 0) {
    let emptyHint = '本轮未解析到行动预测';
    if (isSuggesting) {
      emptyHint = '正在生成行动预测…';
    } else if (
      routesProp !== undefined &&
      fromContent.length === 0 &&
      fromProp.length === 0
    ) {
      emptyHint = '本轮未解析到行动预测（正文无【建议路线】块，辅助生成也未返回）';
    }

    return (
      <View style={styles.wrap}>
        <ThemedText type="code" themeColor="textMuted">
          {emptyHint}
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        行动预测
      </ThemedText>
      <View style={styles.list}>
        {routes.map((route, index) => {
          const letter = OPTION_LETTERS[index] ?? String(index + 1);
          // Avoid "A. A. xxx" when model already prefixed the option.
          const label = route
            .replace(/^[A-Da-d][\.．、\)）]\s*/u, '')
            .replace(/^[一二三四][\.．、\)）]\s*/u, '')
            .replace(/^\d+[\.．、\)）]\s*/u, '')
            .trim() || route;

          return (
            <Pressable
              key={`${letter}-${route}`}
              disabled={disabled}
              onPress={() => onSelect(label)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: pressed ? theme.accent : theme.border,
                  backgroundColor: theme.background,
                  opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`选项 ${letter}：${label}`}>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: theme.accent,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.badgeText}>
                  {letter}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="text" style={styles.optionText} numberOfLines={4}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
    marginTop: Spacing.three,
    width: '100%',
  },
  list: {
    gap: Spacing.two,
    width: '100%',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    width: '100%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 18,
  },
  optionText: {
    flex: 1,
    lineHeight: 22,
    paddingTop: 3,
  },
});
