import { Alert, Platform } from 'react-native';

export type AppAction = { id: string; label: string; destructive?: boolean };
export type AppFeedbackRequest = { id: string; kind: 'confirm'; title: string; message: string; confirmLabel: string; cancelLabel: string; resolve: (value: boolean) => void } | { id: string; kind: 'actions'; title: string; message: string; actions: AppAction[]; resolve: (value: string | null) => void };
export type AppFeedbackNotice = { id: string; title: string; message: string; persistent: boolean };
export type AppFeedbackSnapshot = { active: AppFeedbackRequest | null; notices: AppFeedbackNotice[] };
type AppFeedbackListener = (snapshot: AppFeedbackSnapshot) => void;

let nextId = 1;
let active: AppFeedbackRequest | null = null;
const requestQueue: AppFeedbackRequest[] = [];
const notices: AppFeedbackNotice[] = [];
const listeners = new Set<AppFeedbackListener>();
const snapshot = (): AppFeedbackSnapshot => ({ active, notices: [...notices] });
const publish = () => { const current = snapshot(); listeners.forEach((listener) => listener(current)); };
const advance = () => { if (!active) active = requestQueue.shift() ?? null; publish(); };

export function subscribeAppFeedback(listener: AppFeedbackListener): () => void {
  listeners.add(listener); listener(snapshot()); advance();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    const pending = active ? [active, ...requestQueue] : [...requestQueue];
    active = null; requestQueue.length = 0; notices.length = 0;
    pending.forEach((request) => request.kind === 'confirm' ? request.resolve(false) : request.resolve(null));
  };
}

export function completeAppFeedback(id: string, value: boolean | string | null) {
  if (!active || active.id !== id) return;
  const current = active; active = null;
  if (current.kind === 'confirm') current.resolve(value === true);
  else {
    if (typeof value === 'string' && !current.actions.some((action) => action.id === value)) {
      active = current;
      return;
    }
    current.resolve(typeof value === 'string' ? value : null);
  }
  advance();
}

export function dismissAppNotice(id: string) {
  const index = notices.findIndex((notice) => notice.id === id);
  if (index < 0) return; notices.splice(index, 1); publish();
}

function enqueueRequest(request: AppFeedbackRequest): boolean {
  if (listeners.size === 0) return false;
  requestQueue.push(request); advance(); return true;
}

/**
 * Cross-platform confirm. Web uses the mounted, non-blocking feedback host.
 */
export function confirmAppAction(
  title: string,
  message: string,
  options?: { confirmLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  if (Platform.OS === 'web') return new Promise((resolve) => {
    const request: AppFeedbackRequest = { id: `confirm-${nextId++}`, kind: 'confirm', title, message, confirmLabel: options?.confirmLabel ?? '确定', cancelLabel: options?.cancelLabel ?? '取消', resolve };
    if (!enqueueRequest(request)) resolve(false);
  });

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

/** Web notices do not interrupt generation or keyboard input. */
export function showAppAlert(title: string, message: string): void {
  if (Platform.OS === 'web') {
    notices.push({ id: `notice-${nextId++}`, title, message, persistent: /失败|错误|警告|无法|异常/.test(title) });
    if (listeners.size > 0) publish();
    return;
  }

  Alert.alert(title, message);
}

/** Web action pickers use labelled buttons instead of a numbered prompt. */
export function chooseAppAction(
  title: string,
  message: string,
  actions: AppAction[],
): Promise<string | null> {
  if (actions.length === 0) return Promise.resolve(null);
  if (Platform.OS === 'web') return new Promise((resolve) => {
    const request: AppFeedbackRequest = { id: `actions-${nextId++}`, kind: 'actions', title, message, actions, resolve };
    if (!enqueueRequest(request)) resolve(null);
  });
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
