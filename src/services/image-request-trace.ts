import {
  recordDebugSnapshot,
  updateDebugSnapshot,
  type DebugRequestStep,
} from './debug-request-history';

export type ImageTraceSettings = {
  baseUrl: string;
  apiKey?: string;
  providerId?: string;
  providerName?: string;
  debugPromptInspectorEnabled?: boolean;
  debugTrace?: ImageRequestTrace;
};

const MAX_STEPS = 60;
const MAX_RESPONSE_CHARS = 32_000;
const secretKey = /^(?:api[-_]?key|key|authorization|x-api-key|x-goog-api-key|access_token|token|password|secret|signature|sig)$/i;

/** Keep workflow JSON readable without retaining credentials or image payloads. */
export function formatImageDebugValue(value: unknown, apiKey = ''): string {
  const redactText = (text: string) => {
    let safe = text.replace(/data:image\/[^\s"']+/gi, '[image data omitted]')
      .replace(/([?&](?:key|api[_-]?key|token|access_token|signature|sig)=)[^&#\s"']*/gi, '$1<REDACTED>')
      .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1<REDACTED>@');
    if (apiKey) {
      for (const secret of [apiKey, encodeURIComponent(apiKey)]) safe = safe.split(secret).join('<REDACTED>');
    }
    return safe;
  };
  const clean = (item: unknown, key = '', parent?: Record<string, unknown>): unknown => {
    if (secretKey.test(key)) return '<REDACTED>';
    if (typeof item === 'string') {
      if (/^(?:base64|b64_json|b64Json)$/.test(key) || key === 'data'
        || (key === 'result' && parent?.type === 'image_generation_call')) {
        return `[image data omitted: ${item.length} chars]`;
      }
      return redactText(item);
    }
    if (Array.isArray(item)) return item.map((entry) => clean(entry));
    if (item && typeof item === 'object') {
      if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return '[binary data omitted]';
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.entries(record).map(([name, entry]) => [name, clean(entry, name, record)]));
    }
    return item;
  };
  return typeof value === 'string' ? redactText(value) : JSON.stringify(clean(value), null, 2) ?? '';
}

export function formatImageDebugStep(step: DebugRequestStep): string {
  return [
    `${step.at} · ${step.label} · ${step.status}${step.count > 1 ? ` · 第 ${step.count} 次（显示最近一次）` : ''}`,
    step.url ? `${step.method} ${step.url}` : undefined,
    step.httpStatus !== undefined ? `HTTP ${step.httpStatus}` : undefined,
    step.durationMs !== undefined ? `${step.durationMs} ms` : undefined,
    step.requestBody !== undefined ? `## request\n${step.requestBody}` : undefined,
    step.responseBody !== undefined ? `## response\n${step.responseBody}` : undefined,
    step.error ? `## error\n${step.error}` : undefined,
  ].filter((line) => line !== undefined).join('\n');
}

type HttpDetails = { label: string; url: string; method?: string; body?: unknown };
type ReportResponse = (status: number, body?: unknown) => void;

export class ImageRequestTrace {
  private readonly id: string;
  private readonly startedAt = Date.now();
  private steps: DebugRequestStep[] = [];
  private nextStepId = 0;

  constructor(private readonly settings: ImageTraceSettings, model: string, purpose: string, prompt?: string) {
    this.id = recordDebugSnapshot({
      model, baseUrl: this.format(settings.baseUrl), providerId: settings.providerId,
      providerName: settings.providerName, streaming: false, purpose: `image-${purpose}`,
      messages: prompt ? [{ role: 'user', content: this.format(prompt) }] : [],
      status: 'pending', phase: '准备生图请求', steps: [],
    });
  }

  private format(value: unknown) { return formatImageDebugValue(value, this.settings.apiKey?.trim()); }

  progress(message: string, promptId?: string) {
    updateDebugSnapshot(this.id, { phase: this.format(message), ...(promptId ? { promptId } : {}) });
  }

  async request<T>(details: HttpDetails, run: (report: ReportResponse) => Promise<T>): Promise<T> {
    const started = Date.now();
    const method = details.method ?? 'GET';
    const url = this.format(details.url);
    // Retain submission/upload steps; repeated polling updates its own row.
    const previous = method === 'GET' ? this.steps.find((step) => step.method === method && step.url === url) : undefined;
    const id = previous?.id ?? ++this.nextStepId;
    const step: DebugRequestStep = {
      id, at: new Date().toISOString(), label: details.label, method, url, status: 'pending',
      requestBody: details.body === undefined ? undefined : this.format(details.body), count: (previous?.count ?? 0) + 1,
    };
    this.steps = previous ? this.steps.map((entry) => entry.id === id ? step : entry) : [...this.steps, step].slice(-MAX_STEPS);
    const update = (patch: Partial<DebugRequestStep>) => {
      this.steps = this.steps.map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
      updateDebugSnapshot(this.id, { steps: this.steps });
    };
    update({});
    this.progress(details.label);
    try {
      const result = await run((httpStatus, body) => {
        const formatted = body === undefined ? undefined : this.format(body);
        update({ httpStatus, responseBody: formatted && formatted.length > MAX_RESPONSE_CHARS
          ? `${formatted.slice(0, MAX_RESPONSE_CHARS)}\n[response truncated]` : formatted });
      });
      const current = this.steps.find((entry) => entry.id === id);
      update({ status: current?.httpStatus && current.httpStatus >= 400 ? 'error' : 'success', durationMs: Date.now() - started });
      return result;
    } catch (error) {
      update({ status: error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error',
        error: this.format(error instanceof Error ? error.message : String(error)), durationMs: Date.now() - started });
      throw error;
    }
  }

  finish(result: unknown) {
    updateDebugSnapshot(this.id, { status: 'success', phase: '已完成', durationMs: Date.now() - this.startedAt,
      responseContent: this.format(result) });
  }

  fail(error: unknown) {
    const cancelled = error instanceof Error && error.name === 'AbortError';
    updateDebugSnapshot(this.id, { status: cancelled ? 'cancelled' : 'error', phase: cancelled ? '已停止等待' : '失败',
      error: this.format(error instanceof Error ? error.message : String(error)), durationMs: Date.now() - this.startedAt });
  }
}

export function traceImageRequest<T>(trace: ImageRequestTrace | undefined, details: HttpDetails,
  run: (report: ReportResponse) => Promise<T>): Promise<T> {
  return trace ? trace.request(details, run) : run(() => {});
}

/** Nested calls reuse the outer task so one generation has one archive entry. */
export async function withImageRequestTrace<T>(settings: ImageTraceSettings, model: string, purpose: string,
  prompt: string | undefined, run: (trace: ImageRequestTrace | undefined) => Promise<T>): Promise<T> {
  if (settings.debugTrace) return run(settings.debugTrace);
  if (settings.debugPromptInspectorEnabled === false) return run(undefined);
  const trace = new ImageRequestTrace(settings, model, purpose, prompt);
  try {
    const result = await run(trace);
    trace.finish(result);
    return result;
  } catch (error) {
    trace.fail(error);
    throw error;
  }
}
