import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextProps } from 'react-native';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const palettes = {
  light: { background: '#F7F4EF', surface: '#FFFCF8', subtle: '#F0E0D2', text: '#211C18', muted: '#625B55', border: '#D9D1C8', accent: '#79543A', accentMuted: '#F0E0D2', onAccent: '#FFFFFF', error: '#B3261E' },
  dark: { background: '#12100F', surface: '#1A1816', subtle: '#553924', text: '#EEE9E4', muted: '#C8C0B8', border: '#4D4640', accent: '#D5AE8C', accentMuted: '#553924', onAccent: '#3F2717', error: '#FFB4AB' },
};

export function usePlanningPalette() { return palettes[useColorScheme()]; }

export function PlanningText({ muted = false, style, ...props }: TextProps & { muted?: boolean }) {
  const colors = usePlanningPalette();
  return <Text {...props} style={[ui.text, { color: muted ? colors.muted : colors.text }, style]} />;
}

export function PlanningButton({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const colors = usePlanningPalette();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [ui.button, { borderColor: primary ? colors.text : colors.border, backgroundColor: primary ? colors.text : colors.surface }, (disabled || pressed) && ui.dim]}>
    <PlanningText numberOfLines={1} style={[ui.buttonLabel, { color: primary ? colors.background : colors.text }]}>{label}</PlanningText>
  </Pressable>;
}

export function PlanningComposer({ value, onChange, onSend, onOpenMemory, disabled, busy, memoryCount, empty }: {
  value: string; onChange: (text: string) => void; onSend: () => void; onOpenMemory: () => void;
  disabled: boolean; busy: boolean; memoryCount: number; empty: boolean;
}) {
  const colors = usePlanningPalette();
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(54);
  const canSend = !disabled && Boolean(value.trim());
  return <View style={[ui.composer, { backgroundColor: colors.surface, borderColor: focused ? colors.accent : colors.border }]}>
    <TextInput
      accessibilityLabel="你的创作想法"
      multiline
      editable={!disabled}
      value={value}
      onChangeText={onChange}
      placeholder={empty ? '说说你的想法，我们一起完善。' : '继续聊聊，或修改之前的设定…'}
      placeholderTextColor={colors.muted}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onContentSizeChange={(event) => setInputHeight(Math.max(54, Math.min(180, event.nativeEvent.contentSize.height)))}
      onKeyPress={(event) => {
        if (Platform.OS !== 'web') return;
        const key = event.nativeEvent as unknown as { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
        if (key.key === 'Enter' && !key.shiftKey && !key.isComposing && key.keyCode !== 229) {
          event.preventDefault();
          if (canSend) onSend();
        }
      }}
      style={[ui.composerInput, { color: colors.text, height: inputHeight }]}
    />
    <View style={ui.composerTools}>
      <Pressable accessibilityRole="button" accessibilityLabel="打开构想记忆" onPress={onOpenMemory} style={({ pressed }) => [ui.memoryLink, { backgroundColor: pressed ? colors.subtle : colors.accentMuted }]}>
        <PlanningText style={[ui.memoryLabel, { color: colors.accent }]}>构想记忆{memoryCount ? `  ${memoryCount}` : ''}</PlanningText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={busy ? '正在回复' : '发送消息'} disabled={!canSend} onPress={onSend} style={({ pressed }) => [ui.send, { backgroundColor: canSend || busy ? colors.accent : colors.subtle }, pressed && ui.dim]}>
        {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : <PlanningText style={[ui.sendGlyph, { color: canSend ? colors.onAccent : colors.muted }]}>↑</PlanningText>}
      </Pressable>
    </View>
  </View>;
}

const ui = StyleSheet.create({
  text: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 24, fontWeight: '400' },
  button: { minHeight: 40, paddingHorizontal: 15, paddingVertical: 8, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  buttonLabel: { fontSize: 13, lineHeight: 22, fontWeight: '500' }, dim: { opacity: 0.45 },
  composer: { width: '100%', borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, boxShadow: '0 6px 24px rgba(64, 40, 24, 0.06)' },
  composerInput: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 25, paddingHorizontal: 5, paddingTop: 4, paddingBottom: 4, textAlignVertical: 'top', outlineWidth: 0 },
  composerTools: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  memoryLink: { minHeight: 34, borderRadius: 18, paddingHorizontal: 12, justifyContent: 'center' },
  memoryLabel: { fontSize: 12, lineHeight: 20 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sendGlyph: { fontSize: 26, lineHeight: 32, fontWeight: '500' },
});
