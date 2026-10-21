/** Root class tokens used by built-in skins + slim model fill. */
const STATUS_BAR_ROOT_CLASS =
  'status-form|status-fill|scroll|hud|ticket|capsules|ink|neon|dossier|term';

/** Common field labels across skins (for trailing plain-line strip/extract). */
const STATUS_BAR_PLAIN_LABEL =
  '地点|时间|状态|人物|任务|目标|进度|心情|场景|线索|行动|备注|天气|血量|好感|物品|立场|关系|地|时|兆|线|LOC|T\\+|VIT|THR|OBJ|location|time|cast|quest|state|place';

const STATUS_BAR_ROOT_TAG_RE = new RegExp(
  String.raw`\s*<(?:form|article|section|div)\b[^>]*(?:class\s*=\s*["'][^"']*\b(?:${STATUS_BAR_ROOT_CLASS})\b[^"']*["']|aria-label\s*=\s*["'][^"']*状态栏[^"']*["'])[^>]*>[\s\S]*?<\/(?:form|article|section|div)>\s*$`,
  'iu',
);

const STATUS_BAR_PLAIN_LINES_RE = new RegExp(
  String.raw`\n(?:[ \t]*(?:[-*•·]\s+|\d+[.)、]\s*)?(?:${STATUS_BAR_PLAIN_LABEL}|【\s*(?:${STATUS_BAR_PLAIN_LABEL})\s*】)\s*[:：]?[^\n]*\n?){2,}\s*$`,
  'u',
);


/** True when a fragment looks like a status-bar fill / skin root. */
export function looksLikeStatusBarFragment(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }

  if (
    new RegExp(
      String.raw`<(?:form|article|section|div)\b[^>]*(?:class\s*=\s*["'][^"']*\b(?:${STATUS_BAR_ROOT_CLASS})\b|aria-label\s*=\s*["'][^"']*状态栏)`,
      'i',
    ).test(trimmed)
  ) {
    return true;
  }

  const plainHits = trimmed.match(
    new RegExp(String.raw`^(?:${STATUS_BAR_PLAIN_LABEL})\s*[:：]`, 'gmu'),
  );
  return (plainHits?.length ?? 0) >= 2;
}


/** Chinese + English route-section titles (bracket / heading / plain). */
const SUGGESTED_ROUTES_TITLE =
  '建议路线|路线规划|下一幕(?:目标)?|行动预测|suggested\\s*routes?|next\\s*(?:routes?|actions?)|action\\s*forecast';

/** Locate a suggested-routes header; used for strip + extract. */
const SUGGESTED_ROUTES_HEADER_RE = new RegExp(
  String.raw`(?:【\s*(?:${SUGGESTED_ROUTES_TITLE})\s*】|#{1,4}\s*(?:${SUGGESTED_ROUTES_TITLE})|(?:^|\n)\s*(?:${SUGGESTED_ROUTES_TITLE})\s*[:：])`,
  'iu',
);

/** List-item prefixes: 1. 1、 1) 1） - * • */
const SUGGESTED_ROUTE_LINE_PREFIX_RE = /^(?:[-*•·]\s+|\d+\s*[.)）、．.]\s*)/u;

function isSuggestedRoutesStopLine(line: string) {
  const cleaned = line.trim();
  if (!cleaned) {
    return false;
  }
  if (/^STATUS\s*\|/iu.test(cleaned)) {
    return true;
  }
  if (new RegExp(String.raw`^(?:${STATUS_BAR_PLAIN_LABEL})\s*[:：]`, 'u').test(cleaned)) {
    return true;
  }
  if (/^#{1,4}\s/.test(cleaned)) {
    return true;
  }
  if (/^【/.test(cleaned)) {
    return true;
  }
  return false;
}

/**
 * Remove「建议路线 / 路线规划 / 行动预测」blocks from an assistant reply.
 * Strips the labeled header + up to 4 route lines even when STATUS| / 地点： follow
 * (not only when the block is at absolute end). Does not remove ordinary numbered narrative lists.
 */
export function stripSuggestedRoutesFromAssistantContent(content: string) {
  let text = content.replace(/\s+$/u, '');

  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    const re = new RegExp(SUGGESTED_ROUTES_HEADER_RE.source, 'giu');
    let last: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      last = match;
    }
    if (!last) {
      break;
    }

    const afterStart = last.index + last[0].length;
    const after = text.slice(afterStart);
    let consumed = 0;
    let routeCount = 0;
    let sawRoute = false;
    let pos = 0;

    while (pos < after.length && routeCount < 4) {
      const nl = after.indexOf('\n', pos);
      const lineEnd = nl === -1 ? after.length : nl + 1;
      const line = after.slice(pos, nl === -1 ? after.length : nl);
      const cleaned = line.trim();

      if (!cleaned) {
        if (sawRoute) {
          break;
        }
        consumed = lineEnd;
        pos = lineEnd;
        continue;
      }

      if (isSuggestedRoutesStopLine(cleaned)) {
        break;
      }

      routeCount += 1;
      sawRoute = true;
      consumed = lineEnd;
      pos = lineEnd;
      if (nl === -1) {
        break;
      }
    }

    let start = last.index;
    while (start > 0 && /[ \t]/.test(text[start - 1]!)) {
      start -= 1;
    }
    if (start > 0 && text[start - 1] === '\n') {
      start -= 1;
      if (start > 0 && text[start - 1] === '\r') {
        start -= 1;
      }
    }

    text = `${text.slice(0, start)}${text.slice(afterStart + consumed)}`.replace(/\s+$/u, '');
    if (text === before) {
      break;
    }
  }

  return text.trim();
}

function parseSuggestedRouteLines(block: string): string[] {
  const routes: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    const cleaned = line
      .trim()
      .replace(SUGGESTED_ROUTE_LINE_PREFIX_RE, '')
      .replace(/^>\s+/, '');

    if (!cleaned) {
      continue;
    }
    if (/^#{1,4}\s/.test(cleaned)) {
      continue;
    }
    if (/^【/.test(cleaned)) {
      continue;
    }
    // Stop if the model appended status fields after routes.
    if (isSuggestedRoutesStopLine(cleaned)) {
      break;
    }

    routes.push(cleaned);
    if (routes.length >= 4) {
      break;
    }
  }

  return routes;
}

/**
 * Find the last suggested-routes header and return the block after it.
 * Prefers the last 2000 chars so mid-reply noise does not hide a trailing block.
 */
function findSuggestedRoutesBlock(content: string): string | null {
  const windows = content.length > 2000 ? [content.slice(-2000), content] : [content];

  for (const window of windows) {
    const re = new RegExp(SUGGESTED_ROUTES_HEADER_RE.source, 'giu');
    let last: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = re.exec(window)) !== null) {
      last = match;
    }
    if (last) {
      return window.slice(last.index + last[0].length);
    }
  }

  return null;
}

/**
 * Parse up to 4 suggested routes from a trailing「建议路线」block in an assistant reply.
 */
export function extractSuggestedRoutesFromAssistantContent(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  const block = findSuggestedRoutesBlock(trimmed);
  if (block == null) {
    return [];
  }

  return parseSuggestedRouteLines(block);
}

/** Prompt snippet: main novel model appends 4 routes after narrative. */
export function formatSuggestedRoutesPromptBlock() {
  return [
    '【建议路线要求】',
    '输出顺序：正文 → 【建议路线】。',
    '【强制】每轮必须在正文之后输出【建议路线】标题 + 恰好 4 条编号列表；缺省会导致客户端无法解析。',
    '不要把建议路线写进正文段落；不要用 HTML / 代码块包裹；不要额外说明。',
    '格式固定：',
    '【建议路线】',
    '1. 先去账房核对货单',
    '2. 盘问两名证人',
    '3. 沿潮痕搜索脚印',
    '4. 回驿站整理笔记',
    '要求：恰好 4 条；每条 12–28 字；第二人称行动句；互不重复；贴合当前剧情。',
  ].join('\n');
}

/** Strip status bar + route-planning artifacts for body export / clean reading. */
export function stripAssistantContentForExport(content: string) {
  // Routes first so trailing status plain-fields remain findable.
  return stripStatusBarFromAssistantContent(
    stripSuggestedRoutesFromAssistantContent(content),
  );
}

/**
 * Remove trailing status-bar HTML / plain blocks from an assistant reply
 * so exports keep narrative body only.
 * Suggested-route blocks are peeled first so「正文 → 建议路线 → 状态栏」still works.
 */
export function stripStatusBarFromAssistantContent(content: string) {
  let text = stripSuggestedRoutesFromAssistantContent(content).replace(/\s+$/u, '');

  for (let pass = 0; pass < 5; pass += 1) {
    const before = text;

    // Trailing fenced ```html … ``` status blocks.
    text = text.replace(/\s*```(?:html)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/iu, (match, inner) =>
      looksLikeStatusBarFragment(String(inner ?? '')) ? '' : match,
    );

    // Trailing <style>…</style> often paired with status-bar skins.
    text = text.replace(/\s*<style\b[^>]*>[\s\S]*?<\/style>\s*$/iu, '');

    // Known template roots + slim status-fill + aria-label「状态栏…」
    text = text.replace(STATUS_BAR_ROOT_TAG_RE, '');

    // Truncated / unclosed status root at the very end (still strip for narrative).
    text = text.replace(
      new RegExp(
        String.raw`\s*<(?:form|article|section|div)\b[^>]*(?:class\s*=\s*["'][^"']*\b(?:${STATUS_BAR_ROOT_CLASS})\b[^"']*["']|aria-label\s*=\s*["'][^"']*状态栏[^"']*["'])[^>]*>[\s\S]*$`,
        'iu',
      ),
      '',
    );

    // Prompt-era plain marker.
    text = text.replace(/\s*【状态栏(?:要求|模板|·|字段)?[^\n]*】[\s\S]*$/u, '');

    // Compact STATUS|地点=…|时间=… line(s).
    text = text.replace(/(?:^|\n)\s*STATUS\s*\|[^\n]*/giu, '\n');

    // Plain multi-line field list at the end (地点：… / 时间：…).
    text = text.replace(STATUS_BAR_PLAIN_LINES_RE, '');

    text = text.replace(/\s+$/u, '');
    if (text === before) {
      break;
    }
  }

  return text.trim();
}
