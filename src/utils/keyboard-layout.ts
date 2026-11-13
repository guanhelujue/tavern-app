export function keyboardOverlap(top: number, height: number, keyboardTop?: number) {
  return keyboardTop === undefined ? 0 : Math.min(height, Math.max(0, top + height - keyboardTop));
}

export function focusedInputScrollOffset(offset: number, top: number, height: number, viewportTop: number, viewportHeight: number, center: boolean) {
  const margin = 20;
  const visibleTop = viewportTop + margin;
  const visibleBottom = viewportTop + viewportHeight - margin;
  if (center && height <= viewportHeight - margin * 2) {
    return Math.max(0, offset + top + height / 2 - viewportTop - viewportHeight / 2);
  }
  if (top < visibleTop) return Math.max(0, offset + top - visibleTop);
  if (top + height > visibleBottom) return Math.max(0, offset + top + height - visibleBottom);
  return offset;
}
