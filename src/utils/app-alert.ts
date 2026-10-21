import { Alert, Platform } from 'react-native';

/**
 * Cross-platform confirm.
 * RN Web's Alert.alert with buttons often shows nothing — use window.confirm there.
 */
export function confirmAppAction(
  title: string,
  message: string,
  options?: { confirmLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof globalThis.confirm === 'function' &&
        globalThis.confirm(`${title}\n\n${message}`),
    );
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        {
          text: options?.cancelLabel ?? '取消',
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: options?.confirmLabel ?? '确定',
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Cross-platform info alert (no buttons / OK only). */
export function showAppAlert(title: string, message: string): void {
  if (Platform.OS === 'web') {
    if (typeof globalThis.alert === 'function') {
      globalThis.alert(`${title}\n\n${message}`);
    }
    return;
  }

  Alert.alert(title, message);
}

export type AppAction = { id: string; label: string; destructive?: boolean };

/** Cross-platform action picker. Web uses a numbered prompt with explicit cancel. */
export function chooseAppAction(
  title: string,
  message: string,
  actions: AppAction[],
): Promise<string | null> {
  if (actions.length === 0) return Promise.resolve(null);
  if (Platform.OS === 'web') {
    if (typeof globalThis.prompt !== 'function') return Promise.resolve(null);
    const choice = globalThis.prompt(
      `${title}\n\n${message}\n\n${actions.map((action, index) => `${index + 1}. ${action.label}`).join('\n')}\n\n输入编号，取消请留空：`,
    );
    const index = Number.parseInt(choice ?? '', 10) - 1;
    return Promise.resolve(index >= 0 && index < actions.length ? actions[index].id : null);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: '取消', style: 'cancel', onPress: () => resolve(null) },
        ...actions.map((action) => ({
          text: action.label,
          style: action.destructive ? ('destructive' as const) : ('default' as const),
          onPress: () => resolve(action.id),
        })),
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
