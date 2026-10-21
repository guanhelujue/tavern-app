import AsyncStorage from '@react-native-async-storage/async-storage';
import { validatePlanningSession, type PlanningScope, type PlanningSession } from './domain';

const PREFIX = 'novel-planning-v1';
const queues = new Map<string, Promise<void>>();
export function planningStorageKey(scope: PlanningScope) { return `${PREFIX}:${scope.kind}:${encodeURIComponent(scope.id)}`; }

function queueFor<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  queues.set(key, result.then(() => undefined, () => undefined));
  return result;
}

export async function loadPlanningSession(scope: PlanningScope): Promise<PlanningSession | null> {
  const raw = await AsyncStorage.getItem(planningStorageKey(scope));
  if (!raw) return null;
  const session = validatePlanningSession(JSON.parse(raw));
  if (session.scope.kind !== scope.kind || session.scope.id !== scope.id) throw new Error('规划会话范围不匹配。');
  return session;
}

export async function savePlanningSession(session: PlanningSession, expected?: PlanningSession | null): Promise<void> {
  const valid = validatePlanningSession(session);
  const key = planningStorageKey(valid.scope);
  await queueFor(key, async () => {
    const raw = await AsyncStorage.getItem(key);
    if (expected === null && raw !== null) throw new Error('规划会话已存在，请刷新后重试。');
    if (expected !== undefined && expected !== null && raw === null) throw new Error('规划会话已被删除，请刷新后重试。');
    if (raw !== null) {
      const current = validatePlanningSession(JSON.parse(raw));
      if (expected !== undefined && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('规划记忆已更新，请刷新后重试。');
      if (expected === undefined && current.revision > valid.revision) throw new Error('规划记忆已更新，请刷新后重试。');
    }
    await AsyncStorage.setItem(key, JSON.stringify(valid));
  });
}

export async function clearPlanningSession(scope: PlanningScope): Promise<void> {
  await queueFor(planningStorageKey(scope), () => AsyncStorage.removeItem(planningStorageKey(scope)));
}
