import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { completeAppFeedback, subscribeAppFeedback, type AppFeedbackSnapshot } from '@/utils/app-alert';
import { ThemedText } from './themed-text';

const EMPTY: AppFeedbackSnapshot = { active: null, notices: [] };

/** Native fallback. Web uses AppFeedbackHost.web.tsx so notices never open a modal. */
export function AppFeedbackHost() {
  const theme = useTheme();
  const [state, setState] = useState<AppFeedbackSnapshot>(EMPTY);
  useEffect(() => subscribeAppFeedback(setState), []);

  const active = state.active;
  return <Modal visible={Boolean(active)} transparent animationType="none" onRequestClose={() => { if (active) completeAppFeedback(active.id, null); }}>
    {active ? <View style={styles.scrim} accessibilityViewIsModal>
      <View role="dialog" accessibilityLabel={active.title} style={[styles.dialog, { backgroundColor: theme.surfaceElevated, borderColor: theme.outlineVariant }]}>
        <ThemedText type="subtitle">{active.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.message}>{active.message}</ThemedText>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={active.kind === 'confirm' ? active.cancelLabel : '取消'} onPress={() => completeAppFeedback(active.id, null)} style={[styles.button, { borderColor: theme.outlineVariant }]}><ThemedText type="smallBold">{active.kind === 'confirm' ? active.cancelLabel : '取消'}</ThemedText></Pressable>
          {active.kind === 'confirm' ? <Pressable accessibilityRole="button" accessibilityLabel={active.confirmLabel} onPress={() => completeAppFeedback(active.id, true)} style={[styles.button, { backgroundColor: theme.primary, borderColor: theme.primary }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{active.confirmLabel}</ThemedText></Pressable> : active.actions.map((action) => <Pressable key={action.id} accessibilityRole="button" accessibilityLabel={action.label} onPress={() => completeAppFeedback(active.id, action.id)} style={[styles.button, { backgroundColor: action.destructive ? theme.error : theme.primary, borderColor: action.destructive ? theme.error : theme.primary }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{action.label}</ThemedText></Pressable>)}
        </View>
      </View>
    </View> : null}
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(18, 12, 9, 0.46)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 520, borderWidth: 1, borderRadius: 16, padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  message: { lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  button: { minHeight: 44, minWidth: 88, paddingHorizontal: 16, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
