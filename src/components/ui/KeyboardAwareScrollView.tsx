import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type Ref, type RefAttributes } from 'react';
import { Keyboard, Platform, ScrollView as NativeScrollView, StyleSheet, TextInput as NativeTextInput, type ScrollViewProps, type TextInputProps } from 'react-native';
import { focusedInputScrollOffset, keyboardOverlap } from '@/utils/keyboard-layout';

type FocusContext = {
  visibleHeight: number;
  focus: (input: NativeTextInput, center?: boolean) => void;
  blur: (input: NativeTextInput) => void;
};
const InputScrollContext = createContext<FocusContext | null>(null);
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
export type KeyboardAwareScrollView = NativeScrollView;
export type KeyboardAwareScrollViewHandle = NativeScrollView;
export type KeyboardAwareTextInput = NativeTextInput;

/** Reserves only the remaining keyboard occlusion, even when an outer KAV/window already resized. */
// The type/value pair preserves native ref annotations at existing call sites.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const KeyboardAwareScrollView = forwardRef<NativeScrollView, ScrollViewProps & { scrollComponent?: ComponentType<ScrollViewProps & RefAttributes<NativeScrollView>> }>(function KeyboardAwareScrollView(
  { onLayout, onScroll, onContentSizeChange, contentContainerStyle, horizontal, scrollComponent: ScrollComponent = NativeScrollView, ...props }, forwardedRef,
) {
  const parent = useContext(InputScrollContext);
  const scroll = useRef<NativeScrollView | null>(null);
  const active = useRef<NativeTextInput | null>(null);
  const offset = useRef(0);
  const keyboardTop = useRef<number | undefined>(Keyboard.metrics?.()?.screenY);
  const viewport = useRef({ top: 0, height: 0 });
  const frame = useRef<number | null>(null);
  const [layout, setLayout] = useState({ overlap: 0, visibleHeight: 0 });
  const reveal = useCallback((center = false) => {
    if (horizontal || !active.current || !scroll.current) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const input = active.current;
      input?.measureInWindow((_x, top, _width, height) => {
        if (input !== active.current || !input?.isFocused()) return;
        const bounds = viewport.current;
        const visible = bounds.height - keyboardOverlap(bounds.top, bounds.height, keyboardTop.current);
        if (visible <= 0 || height <= 0) return;
        const next = focusedInputScrollOffset(offset.current, top, height, bounds.top, visible, center);
        if (Math.abs(next - offset.current) > 1) scroll.current?.scrollTo({ y: next, animated: false });
      });
    });
  }, [horizontal]);
  const measure = useCallback(() => {
    scroll.current?.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
      viewport.current = { top, height };
      const overlap = horizontal ? 0 : keyboardOverlap(top, height, keyboardTop.current);
      setLayout((old) => old.overlap === overlap && old.visibleHeight === height - overlap ? old : { overlap, visibleHeight: height - overlap });
      reveal();
    });
  }, [horizontal, reveal]);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => { keyboardTop.current = event.endCoordinates.screenY; measure(); });
    const change = Keyboard.addListener('keyboardWillChangeFrame', (event) => { keyboardTop.current = event.endCoordinates.screenY; measure(); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { keyboardTop.current = undefined; measure(); });
    return () => { show.remove(); change.remove(); hide.remove(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [measure]);
  const context = useMemo<FocusContext>(() => ({
    visibleHeight: layout.visibleHeight,
    focus: (input, center = false) => { active.current = input; reveal(center); },
    blur: (input) => { if (active.current === input) active.current = null; },
  }), [layout.visibleHeight, reveal]);
  const flattened = StyleSheet.flatten(contentContainerStyle);
  const basePadding = flattened?.paddingBottom ?? flattened?.paddingVertical ?? flattened?.padding ?? 0;
  return <InputScrollContext.Provider value={horizontal ? parent : context}>
    <ScrollComponent {...props} horizontal={horizontal}
      ref={(value) => { scroll.current = value; assignRef(forwardedRef, value); }}
      keyboardShouldPersistTaps={props.keyboardShouldPersistTaps ?? 'handled'}
      keyboardDismissMode={props.keyboardDismissMode ?? (Platform.OS === 'ios' ? 'interactive' : 'on-drag')}
      scrollEventThrottle={props.scrollEventThrottle ?? 16}
      contentContainerStyle={[contentContainerStyle, layout.overlap > 0 && { paddingBottom: (typeof basePadding === 'number' ? basePadding : 0) + layout.overlap }]}
      onLayout={(event) => { onLayout?.(event); measure(); }}
      onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}
      onContentSizeChange={(width, height) => { onContentSizeChange?.(width, height); reveal(); }} />
  </InputScrollContext.Provider>;
});

/** Bounds multiline controls so native caret scrolling works inside the visible form viewport. */
// eslint-disable-next-line @typescript-eslint/no-redeclare
export const KeyboardAwareTextInput = forwardRef<NativeTextInput, TextInputProps>(function KeyboardAwareTextInput(
  { onFocus, onBlur, onSelectionChange, onContentSizeChange, onLayout, style, ...props }, forwardedRef,
) {
  const context = useContext(InputScrollContext);
  const input = useRef<NativeTextInput | null>(null);
  const [focused, setFocused] = useState(false);
  const reveal = () => { if (focused && input.current) context?.focus(input.current); };
  const cap = context && context.visibleHeight > 0 ? Math.max(48, Math.min(320, context.visibleHeight * 0.6)) : 320;
  const original = StyleSheet.flatten(style);
  const bounded = focused && props.multiline && context && Platform.OS !== 'web';
  return <NativeTextInput {...props} ref={(value) => { input.current = value; assignRef(forwardedRef, value); }}
    style={[style, bounded && { maxHeight: Math.min(typeof original?.maxHeight === 'number' ? original.maxHeight : cap, cap), minHeight: Math.min(typeof original?.minHeight === 'number' ? original.minHeight : 0, cap), ...(typeof original?.height === 'number' ? { height: Math.min(original.height, cap) } : {}) }]}
    scrollEnabled={props.scrollEnabled ?? true}
    onFocus={(event) => { setFocused(true); if (input.current) context?.focus(input.current, true); onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); if (input.current) context?.blur(input.current); onBlur?.(event); }}
    onSelectionChange={(event) => { onSelectionChange?.(event); reveal(); }}
    onContentSizeChange={(event) => { onContentSizeChange?.(event); reveal(); }}
    onLayout={(event) => { onLayout?.(event); reveal(); }} />;
});
