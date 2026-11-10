import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { canAutoStartLocalComfy, ensureLocalComfyReady } from '@/services/local-comfy-launcher';
import type { ImageProviderConfig } from '@/types/tavern';

export function LocalComfyServiceControl({ provider }: { provider: ImageProviderConfig }) {
  const theme = useTheme();
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  if (!canAutoStartLocalComfy(provider.baseUrl)) return null;

  async function start() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    const headers: Record<string, string> = {};
    if (provider.apiKey && provider.auth !== 'none') {
      if (provider.auth === 'x-api-key') headers['x-api-key'] = provider.apiKey;
      else headers.Authorization = `Bearer ${provider.apiKey}`;
    }
    try {
      await ensureLocalComfyReady({
        baseUrl: provider.baseUrl, headers, signal: controller.signal,
        onProgress: (progress) => { if (pending.current === controller) setMessage(progress.message ?? '正在启动…'); },
      });
      if (pending.current === controller) setMessage('ComfyUI 已就绪，可以生成图片。');
    } catch (error) {
      if (pending.current === controller) setMessage(error instanceof Error ? error.message : '启动失败，请重试。');
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return (
    <View style={styles.container}>
      <ThemedText type="small" themeColor="textMuted">
        生图时会自动检查本地服务，未运行则后台启动。启动参数已保存，无需每次输入。
      </ThemedText>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="检查并启动 ComfyUI"
          accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => void start()}
          style={({ pressed }) => [styles.button, { borderColor: theme.border }, (pressed || busy) && { opacity: 0.65 }]}>
          {busy ? <ActivityIndicator size="small" color={theme.accent} /> : null}
          <ThemedText type="smallBold" themeColor="accent">{busy ? '正在检查 / 启动…' : '检查并启动 ComfyUI'}</ThemedText>
        </Pressable>
        {busy ? <Pressable accessibilityRole="button" onPress={() => pending.current?.abort()} style={[styles.button, { borderColor: 'transparent' }]}>
          <ThemedText type="smallBold" themeColor="textMuted">停止等待</ThemedText>
        </Pressable> : null}
      </View>
      {message ? <ThemedText type="small" accessibilityLiveRegion="polite">{message}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
});
