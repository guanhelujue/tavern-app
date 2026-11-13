import { AiJsonParseError, inspectAiJson, type AiJsonInspection } from '@/utils/ai-json';

export type StructuredJsonRecovery = {
  status: 'recovered' | 'repaired' | 'partial';
  rawContent: string;
  diagnostics: string[];
};

export type StructuredResponseOptions<T> = {
  repair: (prompt: string, signal?: AbortSignal) => Promise<T>;
  validate?: (value: unknown) => boolean;
  signal?: AbortSignal;
  repairPrompt?: string;
  /** When false, a syntactically recovered but semantically incomplete value must be repaired. */
  allowPartial?: boolean;
};

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error('结构化回复修复已取消');
    error.name = 'AbortError';
    throw error;
  }
}

function isUsable(value: unknown, validate?: (value: unknown) => boolean) {
  if (value === undefined || value === null) return false;
  try { return validate ? validate(value) : (typeof value === 'object'); } catch { return false; }
}

function withCombinedUsage<T extends { content: string }>(first: T, second: T): T {
  const combined = { ...second };
  for (const key of ['promptTokens', 'completionTokens'] as const) {
    const initial = (first as Record<string, unknown>)[key];
    const next = (second as Record<string, unknown>)[key];
    if (typeof initial === 'number' || typeof next === 'number') {
      (combined as Record<string, unknown>)[key] = (typeof initial === 'number' ? initial : 0) + (typeof next === 'number' ? next : 0);
    }
  }
  return combined;
}

function resultWithRecovery<T extends { content: string }>(response: T, recovery: StructuredJsonRecovery): T & { jsonRecovery: StructuredJsonRecovery } {
  return { ...response, jsonRecovery: recovery };
}

/**
 * Parse a structured model response, repairing syntax locally before making one
 * bounded repair request. A usable partial response is retained if that request
 * fails; no semantic content is invented locally.
 */
export async function recoverStructuredResponse<T extends { content: string }>(
  first: T,
  options: StructuredResponseOptions<T>,
): Promise<T & { jsonRecovery: StructuredJsonRecovery }> {
  checkAbort(options.signal);
  const initial = inspectAiJson(first.content);
  const initialParsed = initial.value !== undefined;
  const initialUsable = isUsable(initial.value, options.validate);
  const allowPartial = options.allowPartial !== false;
  if (initialUsable && (allowPartial || initial.status !== 'partial')) {
    if (initial.status === 'complete' && !initial.diagnostics.length) {
      return resultWithRecovery(first, { status: 'recovered', rawContent: first.content, diagnostics: [] });
    }
    return resultWithRecovery({ ...first, content: JSON.stringify(initial.value) }, {
      status: initial.status === 'partial' ? 'partial' : 'recovered', rawContent: first.content, diagnostics: initial.diagnostics,
    });
  }

  const diagnostics = initial.diagnostics.length ? initial.diagnostics : ['结构化回复未通过校验'];
  const boundedRaw = first.content.slice(0, 12000);
  const prompt = options.repairPrompt ?? [
    '请修复上一条结构化 JSON 回复。只输出完整合法 JSON，不要 Markdown 或解释。',
    '保留原回复中已经存在的有效字段和条目；只补齐语法或缺失结构，不要编造新的事实，不要重复已有条目。',
    `诊断：${diagnostics.join('；')}`,
    `原始回复（可能截断，最多 12000 字）：\n${boundedRaw}`,
  ].join('\n\n');
  checkAbort(options.signal);
  let repaired: T;
  try {
    repaired = await options.repair(prompt, options.signal);
  } catch (error) {
    checkAbort(options.signal);
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (initialParsed && allowPartial && initialUsable) {
      return resultWithRecovery(first, { status: 'partial', rawContent: first.content, diagnostics: [...diagnostics, error instanceof Error ? error.message : '修复请求失败'] });
    }
    throw new AiJsonParseError(first.content, [...diagnostics, error instanceof Error ? error.message : '修复请求失败']);
  }
  checkAbort(options.signal);
  const repairInspection = inspectAiJson(repaired.content);
  if (isUsable(repairInspection.value, options.validate) && (allowPartial || repairInspection.status !== 'partial')) {
    return resultWithRecovery({ ...withCombinedUsage(first, repaired), content: JSON.stringify(repairInspection.value) }, {
      status: repairInspection.status === 'partial' ? 'partial' : 'repaired', rawContent: first.content, diagnostics: [...diagnostics, ...repairInspection.diagnostics],
    });
  }
  if (initialParsed && allowPartial && initialUsable) {
    return resultWithRecovery(first, { status: 'partial', rawContent: first.content, diagnostics: [...diagnostics, ...repairInspection.diagnostics] });
  }
  throw new AiJsonParseError(first.content, [...diagnostics, ...repairInspection.diagnostics], repaired.content);
}

export function structuredInspection(response: { content: string }): AiJsonInspection {
  return inspectAiJson(response.content);
}
