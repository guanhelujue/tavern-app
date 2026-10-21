import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { SceneInspirationChatMessage } from '@/features/scene-inspiration/domain';
import { requestSceneInspirationReply } from '@/features/scene-inspiration/generator';
import { useTheme } from '@/hooks/use-theme';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import type { Novel } from '@/types/tavern';
import { showAppAlert } from '@/utils/app-alert';

const EMPTY_INSPIRATION_MESSAGES: SceneInspirationChatMessage[] = [];

type Props = {
  visible: boolean;
  novel: Novel;
  onUse: (content: string) => void;
  onClose: () => void;
};

export function NovelSceneInspirationModal({
  visible,
  novel,
  onUse,
  onClose,
}: Props) {
  const theme = useTheme();
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const writingExtensions = useTavernStore((state) => state.contentStyleSettings);
  const messages = useTavernStore(
    (state) => state.novelInspirationChats[novel.id] ?? EMPTY_INSPIRATION_MESSAGES,
  );
  const appendMessage = useTavernStore((state) => state.appendNovelInspirationMessage);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || isSending) return;

    const apiSettings = resolveApiSettings(providers, generationSettings, {
      purpose: 'utility',
    });
    if (!apiSettings.apiKey.trim()) {
      setError('请先在系统设置中配置小模型或默认厂商的 API Key。');
      return;
    }

    const requestId = `${Date.now()}`;
    appendMessage(novel.id, {
      id: `${requestId}-user`,
      role: 'user',
      content: prompt,
    });
    setInput('');
    setError('');
    setIsSending(true);
    try {
      const reply = await requestSceneInspirationReply({
        apiSettings,
        novel,
        writingExtensions,
        prompt,
      });
      appendMessage(novel.id, {
        id: `${requestId}-assistant`,
        role: 'assistant',
        content: reply,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '灵感请求失败，请稍后重试。');
    } finally {
      setIsSending(false);
    }
  }

  function requestClose() {
    if (!isSending) onClose();
  }

  async function copyMessage(content: string) {
    try {
      await Clipboard.setStringAsync(content);
      showAppAlert('已复制', '消息内容已复制到剪贴板。');
    } catch {
      showAppAlert('复制失败', '无法复制消息，请稍后重试。');
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={requestClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={styles.backdrop}
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel="关闭灵感对话"
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <ThemedText type="subtitle">灵感对话</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                自动带入世界观与已启用的破限词、MOD；问答会保存，但每次只发送当前输入。
              </ThemedText>
            </View>
            <Pressable onPress={requestClose} disabled={isSending} hitSlop={8}>
              <ThemedText type="code" themeColor={isSending ? 'textMuted' : 'accent'}>
                关闭
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView
            style={styles.messageList}
            contentContainerStyle={styles.messageContent}
            keyboardShouldPersistTaps="handled">
            {messages.length === 0 ? (
              <View style={[styles.emptyCard, { borderColor: theme.border }]}> 
                <ThemedText type="smallBold">直接说你要什么</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  例如某类剧情走向、秘境玩法、亲密场景、姿势或具体写法。这里不套用固定模板。
                </ThemedText>
                <ThemedText type="code" themeColor="textMuted">
                  上方问答只在本地显示，不作为下一次请求的对话历史。
                </ThemedText>
              </View>
            ) : null}

            {messages.map((message) => {
              const isUser = message.role === 'user';
              return (
                <View
                  key={message.id}
                  style={[
                    styles.messageRow,
                    isUser ? styles.userRow : styles.assistantRow,
                  ]}>
                  <Pressable
                    onLongPress={() => void copyMessage(message.content)}
                    accessibilityRole="button"
                    accessibilityHint="长按复制整条消息"
                    style={({ pressed }) => [
                      styles.bubble,
                      {
                        backgroundColor: isUser ? theme.accentMuted : theme.surface,
                        borderColor: isUser ? theme.accent : theme.border,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="small">{message.content}</ThemedText>
                  </Pressable>
                  {!isUser ? (
                    <Pressable
                      onPress={() => onUse(message.content)}
                      style={({ pressed }) => [
                        styles.useButton,
                        { borderColor: theme.border },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="code" themeColor="accent">写入续写指令</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}

            {isSending ? (
              <View style={[styles.bubble, styles.loadingBubble, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <ThemedText type="small" themeColor="textMuted">正在请求灵感…</ThemedText>
              </View>
            ) : null}
            {error ? (
              <ThemedText type="small" style={styles.error} accessibilityRole="alert">
                {error}
              </ThemedText>
            ) : null}
          </ScrollView>

          <View style={[styles.composer, { borderTopColor: theme.border }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              editable={!isSending}
              multiline
              placeholder="描述你现在想要的灵感…"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
            />
            <Pressable
              onPress={() => void handleSend()}
              disabled={isSending || !input.trim()}
              style={({ pressed }) => [
                styles.sendButton,
                { backgroundColor: theme.accent },
                (pressed || isSending || !input.trim()) && styles.disabled,
              ]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                发送
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(18, 12, 9, 0.52)' },
  sheet: {
    height: '88%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  headerCopy: { flex: 1, gap: 4 },
  messageList: { flex: 1 },
  messageContent: { padding: Spacing.four, gap: Spacing.three },
  emptyCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  messageRow: { width: '100%', gap: Spacing.one },
  userRow: { alignItems: 'flex-end' },
  assistantRow: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '88%',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  loadingBubble: { alignSelf: 'flex-start' },
  useButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  sendButton: {
    minHeight: 44,
    borderRadius: 16,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: '#b54a3c' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
