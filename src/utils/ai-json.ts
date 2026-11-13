export type AiJsonRecoveryStatus = 'complete' | 'recovered' | 'partial' | 'failed';

export type AiJsonInspection = {
  value?: unknown;
  status: AiJsonRecoveryStatus;
  diagnostics: string[];
  rawContent: string;
  remainder?: string;
};

export class AiJsonParseError extends Error {
  readonly rawContent: string;
  readonly diagnostics: string[];
  readonly repairedContent?: string;

  constructor(rawContent: string, diagnostics: string[] = ['无法从模型回复中恢复合法 JSON'], repairedContent?: string) {
    super(diagnostics.join('；') || 'AI JSON 解析失败');
    this.name = 'AiJsonParseError';
    this.rawContent = rawContent;
    this.diagnostics = diagnostics;
    this.repairedContent = repairedContent;
  }
}

type Parsed = { value: unknown; lost: boolean };
class IncompleteValue extends Error {}

/** A small, non-evaluating reader. Only syntax is repaired; unfinished values are omitted. */
class RecoveryReader {
  index: number;
  readonly diagnostics = new Set<string>();
  constructor(readonly source: string, start: number) { this.index = start; }
  private peek() {
    return ({ '｛': '{', '｝': '}', '［': '[', '］': ']', '：': ':', '，': ',' } as Record<string, string>)[this.source[this.index]] ?? this.source[this.index];
  }
  private space() { while (this.index < this.source.length && /\s/.test(this.source[this.index])) this.index++; }
  private take() {
    const char = this.peek();
    if (char !== this.source[this.index]) this.diagnostics.add('已规范 JSON 结构标点');
    this.index++;
    return char;
  }
  private string(): string {
    const opener = this.source[this.index++];
    const closer = opener === '“' ? '”' : opener;
    if (opener !== '"') this.diagnostics.add('已规范 JSON 字符串引号');
    let value = '';
    while (this.index < this.source.length) {
      const char = this.source[this.index++];
      if (char === closer) return value;
      if (char === '\\') {
        if (this.index >= this.source.length) throw new IncompleteValue();
        const escaped = this.source[this.index++];
        if (escaped === 'u') {
          const digits = this.source.slice(this.index, this.index + 4);
          if (digits.length < 4) throw new IncompleteValue();
          if (!/^[\da-f]{4}$/i.test(digits)) throw new SyntaxError('JSON Unicode 转义无效');
          value += String.fromCharCode(parseInt(digits, 16)); this.index += 4;
        } else {
          const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (escaped === "'" && opener === "'") value += "'";
          else if (escaped in escapes) value += escapes[escaped];
          else throw new SyntaxError('JSON 字符串转义无效');
        }
      } else {
        if (char.charCodeAt(0) < 32) this.diagnostics.add('已转义字符串内换行或控制字符');
        value += char;
      }
    }
    throw new IncompleteValue();
  }
  private skipInvalidArrayEntry(start: number) {
    const stack: string[] = [];
    let quote = '';
    let escaped = false;
    for (let position = start; position < this.source.length; position++) {
      const char = this.source[position];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'" || char === '“') { quote = char === '“' ? '”' : char; continue; }
      if (!stack.length && (char === ',' || char === '，' || char === ']' || char === '］')) { this.index = position; return true; }
      if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        if (stack.pop() !== (char === '}' ? '{' : '[')) return false;
      }
    }
    return false;
  }
  read(depth = 0): Parsed {
    if (depth > 100) throw new SyntaxError('JSON 嵌套层数过多');
    this.space();
    const char = this.peek();
    if (char === undefined) throw new IncompleteValue();
    if (char === '{' || char === '[') return this.container(char === '[', depth + 1);
    if (char === '"' || char === '“' || char === "'") return { value: this.string(), lost: false };
    const start = this.index;
    while (this.index < this.source.length && !/[\s,，\]}｝］]/.test(this.source[this.index])) this.index++;
    const token = this.source.slice(start, this.index);
    try { return { value: JSON.parse(token), lost: false }; }
    catch { if (this.index === this.source.length && /^(?:tru?|fals?|n[ul]*|[-\d.eE+]+)$/.test(token)) throw new IncompleteValue(); throw new SyntaxError('JSON 值不可解析'); }
  }
  private container(array: boolean, depth: number): Parsed {
    this.take();
    const items: unknown[] = [];
    const fields: Record<string, unknown> = {};
    let lost = false;
    let expectEntry = true;
    const result = () => ({ value: array ? items : fields, lost });
    const truncate = () => {
      lost = true;
      this.diagnostics.add('模型回复末尾值不完整，已保留完整字段和条目');
      return result();
    };
    while (true) {
      this.space();
      const char = this.peek();
      if (char === undefined) {
        this.diagnostics.add('模型回复缺少 JSON 结尾括号，已补齐结构');
        return result();
      }
      if (char === (array ? ']' : '}')) {
        this.take();
        if (expectEntry && (array ? items.length : Object.keys(fields).length)) this.diagnostics.add('已移除 JSON 尾逗号');
        return result();
      }
      if (!expectEntry) {
        if (char !== ',') throw new SyntaxError('JSON 条目之间缺少分隔符');
        this.take(); expectEntry = true; continue;
      }
      let key = '';
      const entryStart = this.index;
      try {
        if (!array) {
          if (char !== '"' && char !== '“' && char !== "'") throw new SyntaxError('JSON 字段名需要引号');
          key = this.string(); this.space();
          if (this.peek() === undefined) throw new IncompleteValue();
          if (this.take() !== ':') throw new SyntaxError('JSON 字段缺少冒号');
        }
        const entry = this.read(depth);
        lost ||= entry.lost;
        // An unfinished record inside a list must not masquerade as a complete item.
        if (array) { if (!entry.lost) items.push(entry.value); }
        else if (!entry.lost || (entry.value && typeof entry.value === 'object' && Object.keys(entry.value).length)) {
          Object.defineProperty(fields, key, { value: entry.value, enumerable: true, configurable: true, writable: true });
        }
      } catch (error) {
        if (error instanceof IncompleteValue) return truncate();
        if (array && this.skipInvalidArrayEntry(entryStart)) {
          lost = true;
          this.diagnostics.add('已跳过格式损坏的条目，保留其余完整条目');
          expectEntry = false;
          continue;
        }
        throw error;
      }
      expectEntry = false;
    }
  }
}

/** Inspect only model-authored content; database and HTTP envelopes remain strict JSON. */
export function inspectAiJson(rawContent: string): AiJsonInspection {
  const raw = String(rawContent ?? '');
  const text = raw.replace(/^\uFEFF/, '').trim();
  try { return { value: JSON.parse(text), status: 'complete', diagnostics: [], rawContent: raw }; } catch { /* Recover syntax next. */ }
  let start = text.search(/[\[{｛［]/);
  while (start >= 0) {
    const proseLabel = text.slice(start).match(/^\[[^\[\]{}"\n]{1,40}\]/);
    if (proseLabel) {
      try { JSON.parse(proseLabel[0]); } catch {
        const next = text.slice(start + proseLabel[0].length).search(/[\[{｛［]/);
        start = next < 0 ? -1 : start + proseLabel[0].length + next;
        continue;
      }
    }
    const reader = new RecoveryReader(text, start);
    try {
      const parsed = reader.read();
      if (parsed.lost && (!parsed.value || typeof parsed.value !== 'object' || !Object.keys(parsed.value).length)) break;
      return { value: parsed.value, status: parsed.lost ? 'partial' : 'recovered', diagnostics: [...reader.diagnostics], rawContent: raw, remainder: text.slice(reader.index) };
    } catch {
      // Skip a prose label such as [说明], but never fall back to a child of a broken JSON root.
      const label = text.slice(start).match(/^\[[^\[\]{}"\n]{1,40}\]/);
      if (!label) break;
      const next = text.slice(start + label[0].length).search(/[\[{｛［]/);
      start = next < 0 ? -1 : start + label[0].length + next;
    }
  }
  return { status: 'failed', diagnostics: ['模型回复的 JSON 不完整，未能恢复可用字段'], rawContent: raw };
}

export function parseAiJson(content: string): unknown {
  const result = inspectAiJson(content);
  if (result.value === undefined) throw new AiJsonParseError(result.rawContent, result.diagnostics);
  return result.value;
}

export function tryParseAiJson(content: string): unknown | undefined {
  try { return parseAiJson(content); } catch { return undefined; }
}

export function extractAiJsonObject(content: string): Record<string, unknown> | null {
  const value = tryParseAiJson(content);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function extractAiJsonArray(content: string): unknown[] | null {
  const value = tryParseAiJson(content);
  return Array.isArray(value) ? value : null;
}
