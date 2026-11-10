// The web-only resolver keeps this import out of native bundles; this project intentionally has no @types/react-dom dependency.
// @ts-expect-error react-dom is available from the Expo web runtime without a local declaration package.
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { completeAppFeedback, dismissAppNotice, subscribeAppFeedback, type AppFeedbackSnapshot } from '@/utils/app-alert';
import { ThemedText } from './themed-text';

const EMPTY: AppFeedbackSnapshot = { active: null, notices: [] };
const TABBABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
const noticePortalStyle: CSSProperties = {
  position: 'fixed',
  top: 24,
  right: 24,
  width: 'min(92vw, 420px)',
  zIndex: 2147483000,
  pointerEvents: 'none',
};

export function AppFeedbackHost() {
  const theme = useTheme();
  const [state, setState] = useState<AppFeedbackSnapshot>(EMPTY);
  const dialogRef = useRef<React.ElementRef<typeof View> | null>(null);
  const focusOriginRef = useRef<HTMLElement | null>(null);
  const activeId = state.active?.id;

  useEffect(() => subscribeAppFeedback(setState), []);

  useEffect(() => {
    if (!activeId) {
      const previous = focusOriginRef.current;
      focusOriginRef.current = null;
      if (previous) window.setTimeout(() => { if (previous.isConnected) previous.focus(); }, 0);
      return;
    }
    if (!focusOriginRef.current) {
      const current = document.activeElement;
      focusOriginRef.current = current instanceof HTMLElement ? current : null;
    }
    const getDialogElement = (): HTMLElement | null => dialogRef.current ? dialogRef.current as unknown as HTMLElement : null;
    const timer = window.setTimeout(() => getDialogElement()?.querySelector<HTMLElement>(TABBABLE)?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      // Modal handles Escape on keyup. Closing here on keydown would expose
      // the underlying editor to the same keyup and reopen its close prompt.
      if (event.key !== 'Tab') return;
      const dialog = getDialogElement();
      const focusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE)) : [];
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKeyDown); };
  }, [activeId]);

  useEffect(() => {
    const timers = state.notices.filter((notice) => !notice.persistent).map((notice) => window.setTimeout(() => dismissAppNotice(notice.id), 5200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [state.notices]);

  const active = state.active;
  const noticePortal = state.notices.length > 0 && typeof document !== 'undefined' && document.body
    ? createPortal(
      <div style={noticePortalStyle}>
        <View pointerEvents="none" style={styles.noticeStack}>
          {state.notices.map((notice) => <View key={notice.id} pointerEvents="auto" style={[styles.notice, { backgroundColor: theme.surfaceElevated, borderColor: notice.persistent ? theme.error : theme.outlineVariant }]} accessibilityRole="alert">
            <View style={styles.copy}><ThemedText type="smallBold">{notice.title}</ThemedText><ThemedText type="small" themeColor="textSecondary">{notice.message}</ThemedText></View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭通知" onPress={() => dismissAppNotice(notice.id)} style={styles.close}><ThemedText type="smallBold" themeColor="primary">关闭</ThemedText></Pressable>
          </View>)}
        </View>
      </div>,
      document.body,
    )
    : null;

  return <>
    {noticePortal}
    {active && <Modal visible transparent animationType="none" onRequestClose={() => completeAppFeedback(active.id, null)}>
      {active ? <View style={styles.scrim} accessibilityViewIsModal>
        <View ref={dialogRef} role="dialog" accessibilityLabel={active.title} style={[styles.dialog, { backgroundColor: theme.surfaceElevated, borderColor: theme.outlineVariant }]}>
          <ThemedText type="subtitle">{active.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>{active.message}</ThemedText>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={active.kind === 'confirm' ? active.cancelLabel : '取消'} onPress={() => completeAppFeedback(active.id, null)} style={[styles.button, { borderColor: theme.outlineVariant }]}><ThemedText type="smallBold">{active.kind === 'confirm' ? active.cancelLabel : '取消'}</ThemedText></Pressable>
            {active.kind === 'confirm' ? <Pressable accessibilityRole="button" accessibilityLabel={active.confirmLabel} onPress={() => completeAppFeedback(active.id, true)} style={[styles.button, { backgroundColor: theme.primary, borderColor: theme.primary }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{active.confirmLabel}</ThemedText></Pressable> : active.actions.map((action) => <Pressable key={action.id} accessibilityRole="button" accessibilityLabel={action.label} onPress={() => completeAppFeedback(active.id, action.id)} style={[styles.button, { backgroundColor: action.destructive ? theme.error : theme.primary, borderColor: action.destructive ? theme.error : theme.primary }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{action.label}</ThemedText></Pressable>)}
          </View>
        </View>
      </View> : null}
    </Modal>}
  </>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(18, 12, 9, 0.46)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 520, borderWidth: 1, borderRadius: 16, padding: 24, gap: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  message: { lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  button: { minHeight: 44, minWidth: 88, paddingHorizontal: 16, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  noticeStack: { width: '100%', gap: 10 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  copy: { flex: 1, gap: 4 },
  close: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
});
