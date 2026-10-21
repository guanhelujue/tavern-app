export type PlanningScope = { kind: 'creation' | 'world' | 'lore' | 'volume'; id: string };
export type PlanningItemStatus = 'confirmed' | 'candidate' | 'question' | 'discarded';

export type PlanningItem = {
  id: string;
  text: string;
  status: PlanningItemStatus;
  sourceTurnId: string;
};

export type PlanningMessage = { id: string; role: 'user' | 'assistant'; content: string };
export type PlanningHistoryEntry = { revision: number; items: PlanningItem[]; at: string };
export type PlanningSession = {
  version: 1;
  scope: PlanningScope;
  baseSeed?: string;
  revision: number;
  items: PlanningItem[];
  messages: PlanningMessage[];
  pending?: { id: string; prompt: string; reply?: string };
  generated?: { revision: number; content: Record<string, unknown> };
  history: PlanningHistoryEntry[];
};

export type PlanningMemoryPatch = {
  add?: (Partial<PlanningItem> & Pick<PlanningItem, 'text'>)[];
  update?: (Pick<PlanningItem, 'id'> & Partial<Omit<PlanningItem, 'id'>>)[];
  discard?: string[];
  operations?: { op: 'add' | 'update' | 'discard'; id?: string; text?: string; status?: PlanningItemStatus; sourceTurnId?: string }[];
};

const statuses = new Set<PlanningItemStatus>(['confirmed', 'candidate', 'question', 'discarded']);
const kinds = new Set<PlanningScope['kind']>(['creation', 'world', 'lore', 'volume']);

function cloneItems(items: PlanningItem[]) { return items.map((item) => ({ ...item })); }
function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 不能为空。`);
}
function assertItem(value: unknown): asserts value is PlanningItem {
  if (!value || typeof value !== 'object') throw new Error('构想条目格式无效。');
  const item = value as Record<string, unknown>;
  assertText(item.id, '构想条目 ID'); assertText(item.text, '构想内容'); assertText(item.sourceTurnId, '来源回合');
  if (!statuses.has(item.status as PlanningItemStatus)) throw new Error('构想条目状态无效。');
}

export function validatePlanningSession(value: unknown): PlanningSession {
  if (!value || typeof value !== 'object') throw new Error('规划会话格式无效。');
  const raw = value as Record<string, unknown>;
  const scope = raw.scope as Record<string, unknown>;
  if (raw.version !== 1 || !scope || !kinds.has(scope.kind as PlanningScope['kind'])) throw new Error('规划会话版本或范围无效。');
  assertText(scope.id, '规划范围 ID');
  if (raw.baseSeed !== undefined && typeof raw.baseSeed !== 'string') throw new Error('规划起点格式无效。');
  if (!Number.isInteger(raw.revision) || (raw.revision as number) < 0) throw new Error('规划会话版本号无效。');
  if (!Array.isArray(raw.items) || !Array.isArray(raw.messages) || !Array.isArray(raw.history)) throw new Error('规划会话内容不完整。');
  const ids = new Set<string>();
  for (const item of raw.items) { assertItem(item); if (ids.has(item.id)) throw new Error('规划条目 ID 重复。'); ids.add(item.id); }
  for (const message of raw.messages) {
    if (!message || typeof message !== 'object') throw new Error('规划消息格式无效。');
    const m = message as Record<string, unknown>; assertText(m.id, '消息 ID'); assertText(m.content, '消息内容');
    if (m.role !== 'user' && m.role !== 'assistant') throw new Error('规划消息角色无效。');
  }
  if (raw.pending !== undefined) {
    const pending = raw.pending as Record<string, unknown>;
    if (!pending || typeof pending !== 'object') throw new Error('待处理回合格式无效。');
    assertText(pending.id, '待处理回合 ID'); assertText(pending.prompt, '待处理回合问题');
    if (pending.reply !== undefined) assertText(pending.reply, '待处理回合回复');
  }
  if (raw.generated !== undefined) {
    const generated = raw.generated as Record<string, unknown>;
    if (!generated || typeof generated !== 'object' || !Number.isInteger(generated.revision) || !generated.content || typeof generated.content !== 'object' || Array.isArray(generated.content)) throw new Error('生成结果格式无效。');
  }
  for (const entry of raw.history) {
    if (!entry || typeof entry !== 'object' || !Number.isInteger((entry as Record<string, unknown>).revision) || !Array.isArray((entry as Record<string, unknown>).items)) throw new Error('规划历史格式无效。');
    for (const item of (entry as Record<string, unknown>).items as unknown[]) assertItem(item);
  }
  return JSON.parse(JSON.stringify(value)) as PlanningSession;
}

export function createPlanningSession(scope: PlanningScope, seed = ''): PlanningSession {
  if (!kinds.has(scope.kind) || !scope.id.trim()) throw new Error('规划范围无效。');
  const normalizedSeed = seed.trim();
  const seedParts = normalizedSeed.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const items = seedParts.map((text, index) => ({ id: seedParts.length === 1 ? 'seed' : `seed-${index + 1}`, text, status: 'confirmed' as const, sourceTurnId: 'seed' }));
  return { version: 1, scope: { ...scope }, baseSeed: seed, revision: 0, items, messages: [], history: [] };
}

function assertPatch(value: unknown): PlanningMemoryPatch {
  if (!value || typeof value !== 'object') throw new Error('记忆 patch 格式无效。');
  const patch = value as PlanningMemoryPatch;
  for (const key of Object.keys(patch)) if (!['add', 'update', 'discard', 'operations'].includes(key)) throw new Error(`记忆 patch 含未知字段：${key}`);
  for (const key of ['add', 'update', 'discard', 'operations'] as const) if (patch[key] !== undefined && !Array.isArray(patch[key])) throw new Error(`记忆 patch 的 ${key} 必须是数组。`);
  if (patch.operations) {
    const add = patch.add ? [...patch.add] : []; const update = patch.update ? [...patch.update] : []; const discard = patch.discard ? [...patch.discard] : [];
    const touched = new Set<string>();
    for (const operation of patch.operations) {
      if (!operation || !['add', 'update', 'discard'].includes(operation.op)) throw new Error('记忆 patch 操作无效。');
      const allowed = operation.op === 'discard' ? ['op', 'id'] : ['op', 'id', 'text', 'status', 'sourceTurnId'];
      for (const key of Object.keys(operation)) if (!allowed.includes(key)) throw new Error(`记忆 patch 操作含未知字段：${key}`);
      if (operation.op === 'discard') { if (!operation.id) throw new Error('废弃操作缺少条目 ID。'); if (touched.has(operation.id)) throw new Error('同一 patch 不能重复修改同一条目。'); touched.add(operation.id); discard.push(operation.id); }
      else if (operation.op === 'add') {
        if (!operation.text) throw new Error('新增操作缺少内容。');
        add.push({ id: operation.id, text: operation.text, status: operation.status, sourceTurnId: operation.sourceTurnId });
      } else {
        if (!operation.id) throw new Error('更新操作缺少条目 ID。');
        update.push({ id: operation.id, text: operation.text, status: operation.status, sourceTurnId: operation.sourceTurnId });
      }
    }
    return { add, update, discard };
  }
  return patch;
}

export function applyMemoryPatch(session: PlanningSession, rawPatch: unknown, expectedRevision: number): PlanningSession {
  if (session.revision !== expectedRevision) throw new Error('规划记忆已更新，请刷新后重试。');
  const patch = assertPatch(rawPatch);
  const touched = new Set<string>();
  for (const id of [...(patch.add ?? []).map((item) => item?.id), ...(patch.update ?? []).map((item) => item?.id), ...(patch.discard ?? [])]) {
    if (!id) continue;
    assertText(id, '条目 ID');
    if (touched.has(id)) throw new Error('同一 patch 不能重复修改同一条目。');
    touched.add(id);
  }
  const assertFields = (value: object, allowed: string[]) => { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`记忆条目含未知字段：${key}`); };
  const items = cloneItems(session.items); const byId = new Map(items.map((item) => [item.id, item]));
  for (const raw of patch.add ?? []) {
    assertFields(raw, ['id', 'text', 'status', 'sourceTurnId']);
    assertText(raw.text, '新增构想内容');
    const id = raw.id?.trim() || `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (byId.has(id)) throw new Error(`构想条目 ID 已存在：${id}`);
    const status = raw.status ?? 'candidate';
    if (!statuses.has(status) || status === 'discarded') throw new Error('新增条目状态无效。');
    const sourceTurnId = raw.sourceTurnId?.trim() || 'manual';
    items.push({ id, text: raw.text.trim(), status, sourceTurnId }); byId.set(id, items[items.length - 1]);
  }
  for (const raw of patch.update ?? []) {
    assertFields(raw, ['id', 'text', 'status', 'sourceTurnId']);
    assertText(raw.id, '更新条目 ID'); const item = byId.get(raw.id);
    if (!item) throw new Error(`找不到构想条目：${raw.id}`);
    if (raw.text !== undefined) { assertText(raw.text, '更新构想内容'); item.text = raw.text.trim(); }
    if (raw.status !== undefined) { if (!statuses.has(raw.status)) throw new Error('更新条目状态无效。'); item.status = raw.status; }
    if (raw.sourceTurnId !== undefined) { assertText(raw.sourceTurnId, '来源回合'); item.sourceTurnId = raw.sourceTurnId.trim(); }
  }
  for (const id of patch.discard ?? []) { assertText(id, '废弃条目 ID'); const item = byId.get(id); if (!item) throw new Error(`找不到构想条目：${id}`); item.status = 'discarded'; }
  const changed = items.length !== session.items.length || items.some((item, index) => JSON.stringify(item) !== JSON.stringify(session.items[index]));
  if (!changed) return session;
  return { ...session, items, revision: session.revision + 1, history: [...session.history, { revision: session.revision, items: cloneItems(session.items), at: new Date().toISOString() }], generated: undefined };
}

export function undoPlanningMemory(session: PlanningSession): PlanningSession {
  const previous = session.history.at(-1); if (!previous) return session;
  return { ...session, items: cloneItems(previous.items), revision: session.revision + 1, history: session.history.slice(0, -1), generated: undefined };
}

export function buildPlanningContext(session: PlanningSession, confirmedOnly = false): string {
  const items = session.items.filter((item) => item.status !== 'discarded' && (!confirmedOnly || item.status === 'confirmed'));
  return items.length ? items.map((item) => `- ${item.id} [${item.status}] ${item.text}`).join('\n') : '（当前还没有已记录的构想。）';
}
