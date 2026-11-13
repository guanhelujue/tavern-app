import { describe, expect, it } from 'vitest';
import { keyboardOverlap, focusedInputScrollOffset } from './keyboard-layout';

describe('keyboard visibility geometry', () => {
  it('adds only occlusion that has not already been removed by window/KAV resizing', () => {
    expect(keyboardOverlap(100, 700, 500)).toBe(300);
    expect(keyboardOverlap(100, 400, 500)).toBe(0);
    expect(keyboardOverlap(100, 700, undefined)).toBe(0);
  });
  it('centers a newly focused bottom field above the keyboard', () => {
    expect(focusedInputScrollOffset(0, 650, 100, 100, 400, true)).toBe(400);
  });
  it('keeps visible typing still, but scrolls an obscured field into view', () => {
    expect(focusedInputScrollOffset(100, 180, 100, 100, 400, false)).toBe(100);
    expect(focusedInputScrollOffset(100, 440, 100, 100, 400, false)).toBe(160);
  });
  it('can scroll back to an earlier field and never requests a negative offset', () => {
    expect(focusedInputScrollOffset(400, 80, 100, 100, 400, false)).toBe(360);
    expect(focusedInputScrollOffset(0, 80, 100, 100, 400, false)).toBe(0);
  });
});
