import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type NovelActionMenuItem = {
  id: string;
  label: string;
  detail: string;
  destructive?: boolean;
  selected?: boolean;
};

type NovelActionMenuModalProps = {
  visible: boolean;
  eyebrow: string;
  title: string;
  description: string;
  items: NovelActionMenuItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
};

export function NovelActionMenuModal({
  visible,
  eyebrow,
  title,
  description,
  items,
  onClose,
  onSelect,
}: NovelActionMenuModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={[styles.overlay, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭选项"
        />
        <View
          style={[
            styles.panel,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              shadowColor: '#17120f',
            },
          ]}>
          <View style={styles.header}>
            <View style={[styles.signal, { backgroundColor: theme.accent }]} />
            <View style={styles.headerCopy}>
              <ThemedText type="code" style={[styles.eyebrow, { color: theme.accent }]}>
                {eyebrow}
              </ThemedText>
              <ThemedText style={styles.title}>{title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
                {description}
              </ThemedText>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeButton,
                { borderColor: theme.border },
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="关闭选项">
              <ThemedText type="code" themeColor="accent">ESC ×</ThemedText>
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.options}>
            {items.map((item, index) => (
              <Pressable
                key={item.id}
                onPress={() => {
                  onClose();
                  requestAnimationFrame(() => onSelect(item.id));
                }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: item.selected ? theme.accent : theme.border,
                    backgroundColor: item.selected ? theme.accentMuted : theme.backgroundElement,
                  },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: item.selected }}>
                <ThemedText type="code" style={[styles.optionIndex, { color: theme.accent }]}>
                  {String(index + 1).padStart(2, '0')}
                </ThemedText>
                <View style={styles.optionCopy}>
                  <ThemedText
                    type="smallBold"
                    style={item.destructive ? { color: theme.accent } : undefined}>
                    {item.label}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.optionDetail}>
                    {item.detail}
                  </ThemedText>
                </View>
                <ThemedText type="code" style={[styles.optionMark, { color: theme.accent }]}>
                  {item.selected ? 'ACTIVE' : '↗'}
                </ThemedText>
              </Pressable>
            ))}
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
    backgroundColor: 'rgba(8, 7, 6, 0.62)',
  },
  panel: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '82%',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 22,
    overflow: 'hidden',
    shadowOpacity: 0.3,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.four,
    paddingBottom: Spacing.three,
  },
  signal: {
    width: 3,
    height: 54,
    borderRadius: 2,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.2,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 26,
    lineHeight: 32,
  },
  description: {
    lineHeight: 20,
  },
  closeButton: {
    minWidth: 52,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
  option: {
    minHeight: 74,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  optionIndex: {
    width: 24,
    fontSize: 10,
    letterSpacing: 1,
  },
  optionCopy: {
    flex: 1,
    gap: 3,
  },
  optionDetail: {
    lineHeight: 18,
  },
  optionMark: {
    fontSize: 9,
    letterSpacing: 0.8,
  },
  pressed: {
    opacity: 0.72,
  },
});
