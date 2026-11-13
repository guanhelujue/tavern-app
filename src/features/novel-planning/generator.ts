import { requestCompletionWithUsage, requestPlainCompletion } from '../../services/llm';
import type { ApiSettings } from '../../types/tavern';
import { applyMemoryPatch, buildPlanningContext, type PlanningSession } from './domain';
import { parseAiJson } from '../../utils/ai-json';

const settingsFor = (apiSettings: ApiSettings, maxTokens: number) => ({ ...apiSettings, streamingEnabled: false, thinkingDisabled: true, maxTokens: Math.max(500, Math.min(Math.round(maxTokens || apiSettings.maxTokens || 2400), 6000)) });
function parseJson(content: string): unknown {
  return parseAiJson(content);
}
function asObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 返回的 JSON 必须是对象。'); return value as Record<string, unknown>; }

export async function requestPlanningReply({ apiSettings, session, prompt, context, maxTokens }: { apiSettings: ApiSettings; session: PlanningSession; prompt: string; context?: string; maxTokens: number }): Promise<string> {
  if (!prompt.trim()) throw new Error('请先输入你的构思。');
  const memory = buildPlanningContext(session);
  const system = `你是小说创作规划助手。你要和作者用自然语言讨论故事，不输出 JSON，不把候选方案擅自当成定稿。请基于当前有效构想回答本轮问题，必要时提出少量澄清问题；保持之前确认的内容，允许明确指出冲突。${context?.trim() ? `\n\n【上层设定（只读参考）】\n${context.trim()}` : ''}\n\n【当前构想】\n${memory}`;
  const reply = await requestPlainCompletion({ apiSettings: settingsFor(apiSettings, maxTokens), purpose: 'create-planning-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: prompt.trim() }] });
  if (!reply.trim()) throw new Error('模型没有返回内容，请重试。');
  return reply.trim();
}

export async function updatePlanningMemory({ apiSettings, session, prompt, reply, turnId, maxTokens }: { apiSettings: ApiSettings; session: PlanningSession; prompt: string; reply: string; turnId: string; maxTokens: number }): Promise<PlanningSession> {
  if (!prompt.trim() || !reply.trim() || !turnId.trim()) throw new Error('记忆更新参数不完整。');
  const system = `从本轮作者消息和助手回复中提取记忆变更。只提取作者明确提出或确认的内容为 confirmed；助手提出但作者未采纳的内容为 candidate；未决事项为 question。作者询问“能否改成”是探索，不是采纳；“就改成”才是修正。保留候选方案的编号、名称及具体内容，使下一轮“第二个”可被识别。被作者明确否定的内容用 discard；“不要系统”等持续限制还要记为 confirmed。保留旧条目，未提及内容不要删除。修改既有事实必须 update 对应 ID，不能只 add 一条相反事实而留下旧版。一个条目包含多个事实时，完整保留其中未改动事实；可拆成原子条目并废弃原条目。不得复活已废弃方案。同一条目每轮只能修改一次。只输出 JSON 对象：{"add":[{"id":"新的唯一英文短 ID","text":"内容","status":"confirmed|candidate|question","sourceTurnId":"${turnId}"}],"update":[{"id":"已有 ID","text":"完整的新内容","status":"confirmed|candidate|question","sourceTurnId":"${turnId}"}],"discard":["已有 ID"]}。没有变化就输出 {"add":[],"update":[],"discard":[]}。不要输出解释。\n\n【已有构想】\n${buildPlanningContext(session)}`;
  const result = await requestCompletionWithUsage({ apiSettings: settingsFor(apiSettings, maxTokens), purpose: 'utility-memory', responseFormat: 'json', validateJson: (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (!['add', 'update', 'discard', 'operations'].some((key) => Array.isArray(record[key]))) return false;
    applyMemoryPatch(session, record, session.revision);
    return true;
  }, messages: [{ role: 'system', content: system }, { role: 'user', content: `作者：${prompt.trim()}\n助手：${reply.trim()}` }] });
  const patched = applyMemoryPatch(session, asObject(parseJson(result.content)), session.revision);
  return patched;
}

export async function generatePlanningFields({ apiSettings, session, context, targetInstructions, maxTokens }: { apiSettings: ApiSettings; session: PlanningSession; context?: string; targetInstructions: string; maxTokens: number }): Promise<Record<string, unknown>> {
  if (session.pending) throw new Error('本轮记忆尚未更新，请先继续本轮。');
  const prompt = `把下面已确定的小说构想转换成目标字段。${targetInstructions}\n只输出一个合法 JSON 对象，不要 Markdown，不要解释。未确定的字段留空，不要自行补设定。${context?.trim() ? `\n\n【上层设定（只读参考）】\n${context.trim()}` : ''}\n\n【已确定构想】\n${buildPlanningContext(session, true)}`;
  const result = await requestCompletionWithUsage({ apiSettings: settingsFor(apiSettings, maxTokens), purpose: 'create-planning-fields', responseFormat: 'json', validateJson: (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value)), messages: [{ role: 'system', content: '你是小说设定结构化转换器。严格遵守目标字段定义，只输出 JSON。' }, { role: 'user', content: prompt }] });
  return asObject(parseJson(result.content));
}
