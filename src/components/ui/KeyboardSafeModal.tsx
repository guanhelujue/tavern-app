import { KeyboardAwareScrollView as ScrollView } from '@/components/ui/KeyboardAwareScrollView';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type KeyboardSafeModalProps = {
  visible: boolean;
  onRequestClose: () => void;
  children: ReactNode;
  keyboardVerticalOffset?: number;
  scrollable?: boolean;
};

export function KeyboardSafeModal({
  visible,
  onRequestClose,
  children,
  keyboardVerticalOffset = 0,
  scrollable = false,
}: KeyboardSafeModalProps) {
  const insets = useSafeAreaInsets();
  const content = scrollable ? (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}>
        <View style={styles.content}>{content}</View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center' },
  content: { flex: 1, maxHeight: '100%', width: '100%' },
  scroll: { flex: 1 },
});
