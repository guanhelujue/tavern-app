import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ChatSettingsAction =
  | 'saveSlots'
  | 'memory'
  | 'storyMemory'
  | 'characterDossiers'
  | 'outline'
  | 'editNovel'
  | 'archiveActions';

type MenuItem = {
  key: ChatSettingsAction;
  label: string;
  sectionStart?: boolean;
};

const NOVEL_MENU_ITEMS: MenuItem[] = [
  { key: 'saveSlots', label: '💾 记忆点' },
  { key: 'memory', label: '🪟 对话窗口' },
  { key: 'storyMemory', label: '📚 写作上下文' },
  { key: 'characterDossiers', label: '🗂️ 知识库' },
  { key: 'outline', label: '📑 写作大纲' },
  { key: 'editNovel', label: '✏️ 编辑小说', sectionStart: true },
  { key: 'archiveActions', label: '🗃️ 小说档案' },
];

type ChatSettingsGearButtonProps = {
  onPress: () => void;
};

export function ChatSettingsGearButton({ onPress }: ChatSettingsGearButtonProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.gearButton, pressed && styles.gearPressed]}
      accessibilityRole="button"
      accessibilityLabel="打开对话设置菜单">
      <ThemedText style={[styles.gearIcon, { color: theme.accent }]}>⚙️</ThemedText>
    </Pressable>
  );
}

type ChatSettingsMenuModalProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (action: ChatSettingsAction) => void;
};

export function ChatSettingsMenuModal({
  visible,
  onClose,
  onSelect,
}: ChatSettingsMenuModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const menuItems = NOVEL_MENU_ITEMS;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭菜单"
        />
        <View
          style={[
            styles.menu,
            {
              top: insets.top + 44,
              backgroundColor: theme.surface,
              borderColor: theme.border,
              shadowColor: '#17120f',
            },
          ]}>
          {menuItems.map((item, index) => (
            <Pressable
              key={item.key}
              onPress={() => {
                onClose();
                // Defer so the menu modal fully unmounts before opening the next sheet.
                requestAnimationFrame(() => onSelect(item.key));
              }}
              style={({ pressed }) => [
                styles.menuItem,
                item.sectionStart && {
                  borderTopWidth: 1,
                  borderTopColor: theme.accent,
                  marginTop: Spacing.one,
                },
                index < menuItems.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: theme.border,
                },
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <ThemedText type="smallBold" style={styles.menuLabel}>
                {item.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gearButton: {
    marginRight: Spacing.two,
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  gearPressed: {
    opacity: 0.7,
  },
  gearIcon: {
    fontSize: 20,
    lineHeight: 24,
  },
  overlay: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(23, 18, 15, 0.18)',
  },
  menu: {
    position: 'absolute',
    right: Spacing.three,
    minWidth: 168,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  menuItem: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
  },
  menuLabel: {
    fontSize: 14,
    lineHeight: 20,
  },
});
