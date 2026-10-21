import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ImmersiveTocEntry } from '@/utils/immersive-toc';

type ImmersiveTocModalProps = {
  visible: boolean;
  entries: ImmersiveTocEntry[];
  onClose: () => void;
  onSelect: (messageId: string) => void;
};

export function ImmersiveTocModal({
  visible,
  entries,
  onClose,
  onSelect,
}: ImmersiveTocModalProps) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              目录
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
              <ThemedText themeColor="textMuted">✕</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textMuted">
            {entries.some((entry) => entry.hasChapterTitle)
              ? '有章节名的条目按章节跳转；其余按回复跳转。'
              : '尚未识别到章节名，按每次 AI 回复跳转。'}
          </ThemedText>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {entries.length === 0 ? (
              <ThemedText type="small" themeColor="textMuted">
                暂无可跳转的回复。
              </ThemedText>
            ) : (
              entries.map((entry, index) => (
                <Pressable
                  key={entry.messageId}
                  onPress={() => {
                    onClose();
                    requestAnimationFrame(() => onSelect(entry.messageId));
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderColor: theme.border,
                      backgroundColor: pressed ? theme.backgroundSelected : theme.background,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`跳转到 ${entry.label}`}>
                  <ThemedText type="code" themeColor="textMuted" style={styles.index}>
                    {index + 1}
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    numberOfLines={2}
                    style={[styles.label, entry.hasChapterTitle && { color: theme.accent }]}>
                    {entry.label}
                  </ThemedText>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
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
    maxHeight: '80%',
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
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
  index: {
    minWidth: 22,
  },
  label: {
    flex: 1,
    lineHeight: 20,
  },
});
