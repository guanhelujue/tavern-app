/** Trim persisted / draft writing-style text. Built-in presets were removed. */
export function normalizeWritingStyle(value?: string | null): string {
  return value?.trim() ?? '';
}
