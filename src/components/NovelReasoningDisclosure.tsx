import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type NovelReasoningDisclosureProps = {
  content?: string;
  isStreaming?: boolean;
};

/** Keeps provider reasoning visible to the author without mixing it into novel prose. */
export function NovelReasoningDisclosure({
  content,
  isStreaming = false,
}: NovelReasoningDisclosureProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(isStreaming);
  const normalized = content?.trim() ?? '';

  if (!normalized) return null;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        <View style={styles.headerCopy}>
          <ThemedText type="code" themeColor="accent">
            {expanded ? '▲' : '▼'}
          </ThemedText>
          <ThemedText type="smallBold">
            {isStreaming ? '模型正在思考' : '模型思考过程'}
          </ThemedText>
        </View>
        <ThemedText type="code" themeColor="textMuted">
          {expanded ? '收起' : '展开'}
        </ThemedText>
      </Pressable>
      {expanded ? (
        <ThemedText selectable type="small" themeColor="textSecondary" style={styles.content}>
          {normalized}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 10,
    overflow: 'hidden',
  },
  header: {
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.72,
  },
});
