import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { router } from 'expo-router';
import { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { Spacing } from '@/constants/theme';
import type { SceneInspirationChatMessage } from '@/features/scene-inspiration/domain';
import { isChapterContinuationIntent, requestSceneInspirationReply, type InspirationContinuity } from '@/features/scene-inspiration/generator';
import { useTheme } from '@/hooks/use-theme';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import type { Novel } from '@/types/tavern';
import { showAppAlert } from '@/utils/app-alert';

const EMPTY_INSPIRATION_MESSAGES: SceneInspirationChatMessage[] = [];
type PanelProps = { novel: Novel; onUse: (content: string, messageId?: string) => void; onContinue?: (prompt: string, messageId?: string) => void; onClose?: () => void; embedded?: boolean };

export function NovelSceneInspirationPanel({ novel, onUse, onContinue, onClose, embedded = false }: PanelProps) {
  const theme = useTheme();
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const writingExtensions = useTavernStore((state) => state.contentStyleSettings);
  const messages = useTavernStore((state) => state.novelInspirationChats[novel.id] ?? EMPTY_INSPIRATION_MESSAGES);
  const appendMessage = useTavernStore((state) => state.appendNovelInspirationMessage);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [continuity, setContinuity] = useState<InspirationContinuity>('continuous');
  const [continuationPrompt, setContinuationPrompt] = useState('');
  const [continuationMessageId, setContinuationMessageId] = useState('');
  const suggestions = ['让一个熟悉的人在雨夜突然失踪', '设计一场不靠打斗推动的冲突', '给这一章一个反常但合理的转折'];

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || isSending) return;
    if (isChapterContinuationIntent(prompt)) {
      const requestId = `${Date.now()}`;
      appendMessage(novel.id, { id: `${requestId}-user`, role: 'user', content: prompt });
      setContinuationPrompt(prompt);
      setContinuationMessageId(`${requestId}-user`);
      setInput('');
      setError('');
      return;
    }
    let apiSettings;
    try { apiSettings = resolveApiSettings(providers, generationSettings, { task: 'inspiration', purpose: 'utility' }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '请先配置灵感模型。'); return; }
    if (!apiSettings.apiKey.trim()) { setError('请先在系统设置中配置灵感模型的 API Key。'); return; }
    const requestId = `${Date.now()}`;
    appendMessage(novel.id, { id: `${requestId}-user`, role: 'user', content: prompt });
    setInput(''); setError(''); setIsSending(true);
    try {
      const reply = await requestSceneInspirationReply({ apiSettings, novel, writingExtensions, prompt, history: messages, continuity });
      appendMessage(novel.id, { id: `${requestId}-assistant`, role: 'assistant', content: reply });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '灵感请求失败，请稍后重试。'); }
    finally { setIsSending(false); }
  }
  async function copyMessage(content: string) {
    try { await Clipboard.setStringAsync(content); showAppAlert('已复制', '消息内容已复制到剪贴板。'); }
    catch { showAppAlert('复制失败', '无法复制消息，请稍后重试。'); }
  }
  function continueInChapterWorkspace(prompt: string, messageId?: string) {
    if (!messageId) return;
    if (onContinue) {
      onContinue(prompt, messageId);
      return;
    }
    const draft = (novel.chapters ?? [])
      .filter((chapter) => chapter.status === 'draft' && [chapter.title, chapter.summary, chapter.goal, chapter.content].some((value) => value.trim()))
      .sort((left, right) => left.index - right.index)[0];
    const chapterParam = draft ? `&chapterId=${encodeURIComponent(draft.id)}` : '';
    router.push(`/novel/chapters/${novel.id}?inspirationId=${encodeURIComponent(messageId)}${chapterParam}` as never);
    onClose?.();
  }
  return <View style={[styles.panel, embedded && styles.embeddedPanel]}>
    {!embedded && <View style={styles.header}><View style={styles.headerCopy}><ThemedText type="subtitle">灵感对话</ThemedText><ThemedText type="small" themeColor="textSecondary">会带入作品设定、公开角色卡、大纲、最近定稿摘要；连续模式还会带入最近对话。不会自动改正文或定稿。</ThemedText></View>{onClose ? <Pressable onPress={onClose} disabled={isSending} hitSlop={8} accessibilityRole="button" accessibilityLabel="关闭灵感对话"><ThemedText type="code" themeColor={isSending ? 'textMuted' : 'accent'}>关闭</ThemedText></Pressable> : null}</View>}
    <ScrollView style={styles.messageList} contentContainerStyle={styles.messageContent} keyboardShouldPersistTaps="handled">
      {messages.length === 0 ? <View style={styles.emptyState}>
        <ThemedText type="title" style={styles.emptyTitle}>从一个念头开始</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>把还没成形的画面、冲突或一句对白交给我。先讨论，不会改动正文。</ThemedText>
        <View style={styles.suggestionList}>
          {suggestions.map((item, index) => <Pressable key={item} onPress={() => { setInput(item); }} disabled={isSending} style={({ pressed }) => [styles.suggestion, { borderBottomColor: theme.border }, pressed && styles.pressed]} accessibilityRole="button"><ThemedText type="code" themeColor="textMuted">0{index + 1}</ThemedText><ThemedText type="small" style={styles.suggestionText}>{item}</ThemedText><ThemedText type="small" themeColor="accent">→</ThemedText></Pressable>)}
        </View>
      </View> : null}
      {messages.map((message) => { const isUser = message.role === 'user'; return <View key={message.id} style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}><Pressable onLongPress={() => void copyMessage(message.content)} accessibilityRole="button" accessibilityLabel={`${isUser ? '我的消息' : '灵感回复'}，长按复制`} style={({ pressed }) => [styles.bubble, { backgroundColor: isUser ? theme.accentMuted : theme.surface, borderColor: isUser ? theme.accent : theme.border }, pressed && styles.pressed]}><ThemedText type="small">{message.content}</ThemedText></Pressable>{embedded && <Pressable onPress={() => void copyMessage(message.content)} accessibilityRole="button" accessibilityLabel="复制消息" style={styles.useButton}><ThemedText type="small" themeColor="textSecondary">复制</ThemedText></Pressable>}{!isUser ? <Pressable onPress={() => onUse(message.content, message.id)} accessibilityRole="button" style={({ pressed }) => [styles.useButton, { borderColor: theme.border }, pressed && styles.pressed]}><ThemedText type="code" themeColor="accent">{embedded ? '用作章节提示词' : '写入续写指令'}</ThemedText></Pressable> : null}</View>; })}
      {isSending ? <View style={[styles.bubble, styles.loadingBubble, { backgroundColor: theme.surface, borderColor: theme.border }]}><ThemedText type="small" themeColor="textMuted">正在请求灵感…</ThemedText></View> : null}
      {error ? <ThemedText type="small" style={styles.error} accessibilityRole="alert">{error}</ThemedText> : null}
    </ScrollView>
    {Boolean(continuationPrompt) && <View style={[styles.continuationCard, { backgroundColor: theme.primaryContainer, borderColor: theme.border }]}><View style={styles.noticeText}><ThemedText type="smallBold">去正式章节工作区续写</ThemedText><ThemedText type="small" themeColor="textSecondary">“{continuationPrompt}”会作为下一章提示词带入，不会自动生成重复正文。</ThemedText></View><Pressable onPress={() => continueInChapterWorkspace(continuationPrompt, continuationMessageId)} accessibilityRole="button" style={[styles.useButton, { borderColor: theme.primary }]}><ThemedText type="smallBold" themeColor="accent">去写下一章</ThemedText></Pressable></View>}
    <View style={[styles.composer, { backgroundColor: theme.surface, borderColor: theme.outlineVariant }]}>
      <TextInput accessibilityLabel="灵感问题" value={input} onChangeText={setInput} editable={!isSending} multiline
        placeholder="写下你的问题，或选一个开场…" placeholderTextColor={theme.textMuted}
        style={[styles.input, { color: theme.text }]} />
      <View style={styles.composerToolbar}>
        <View style={styles.modeRow}>
          <TaskModelSelector task="inspiration" disabled={isSending} />
          <Pressable onPress={() => setContinuity(continuity === 'continuous' ? 'single' : 'continuous')}
            disabled={isSending} accessibilityRole="button" accessibilityLabel="切换灵感上下文模式"
            style={({ pressed }) => [styles.modeButton, { backgroundColor: pressed ? theme.surfaceVariant : 'transparent' }]}>
            <View style={[styles.contextDot, { backgroundColor: continuity === 'continuous' ? theme.primary : theme.outline }]} />
            <ThemedText type="small" themeColor="textSecondary">{continuity === 'continuous' ? '连续讨论' : '仅本次'}</ThemedText>
          </Pressable>
        </View>
        <Pressable onPress={() => void handleSend()} disabled={isSending || !input.trim()}
          accessibilityRole="button" accessibilityLabel="发送灵感问题"
          style={({ pressed }) => [styles.sendButton, { backgroundColor: isSending || !input.trim() ? theme.surfaceVariant : theme.primary }, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={{ color: isSending || !input.trim() ? theme.textMuted : theme.onPrimary }}>{isSending ? '思考中…' : '发送 ↑'}</ThemedText>
        </Pressable>
      </View>
    </View>
  </View>;
}

type Props = { visible: boolean; novel: Novel; onUse: (content: string, messageId?: string) => void; onContinue?: (prompt: string, messageId?: string) => void; onClose: () => void };
export function NovelSceneInspirationModal({ visible, novel, onUse, onContinue, onClose }: Props) {
  const theme = useTheme();
  return <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}><KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="关闭灵感对话" /><View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}><NovelSceneInspirationPanel novel={novel} onUse={onUse} onContinue={onContinue} onClose={onClose} /></View></KeyboardAvoidingView></Modal>;
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(18, 12, 9, 0.52)' }, sheet: { height: '88%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, overflow: 'hidden' }, panel: { flex: 1 }, embeddedPanel: { maxWidth: 900, width: '100%', alignSelf: 'center', paddingBottom: 24 }, header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three, padding: Spacing.four }, headerCopy: { flex: 1, gap: 4 }, messageList: { flex: 1 }, messageContent: { paddingHorizontal: 0, paddingTop: 32, paddingBottom: 24, gap: Spacing.three, maxWidth: 960, width: '100%', alignSelf: 'center' }, emptyState: { flex: 1, minHeight: 280, paddingHorizontal: 4, paddingTop: 20, justifyContent: 'center', alignItems: 'flex-start' }, emptyTitle: { fontSize: 32, lineHeight: 39, letterSpacing: -0.5, marginBottom: Spacing.one }, emptyCopy: { maxWidth: 480, lineHeight: 22, marginBottom: Spacing.four }, suggestionList: { width: '100%', maxWidth: 620 }, suggestion: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.two }, suggestionText: { flex: 1 }, continuationCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two }, noticeText: { flex: 1, gap: 4 }, messageRow: { width: '100%', gap: Spacing.one }, userRow: { alignItems: 'flex-end' }, assistantRow: { alignItems: 'flex-start' }, bubble: { maxWidth: '88%', borderWidth: 1, borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two }, loadingBubble: { alignSelf: 'flex-start' }, useButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 6, minHeight: 36, justifyContent: 'center' }, contextDot: { width: 6, height: 6, borderRadius: 3 }, modeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one }, modeButton: { minHeight: 44, borderRadius: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, composer: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12, boxShadow: '0 4px 20px rgba(28,22,18,0.04)' }, composerToolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, input: { minHeight: 88, maxHeight: 160, paddingHorizontal: 6, paddingVertical: 8, fontSize: 16, lineHeight: 25, textAlignVertical: 'top' }, sendButton: { minHeight: 44, borderRadius: 8, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' }, error: { color: '#b54a3c' }, pressed: { opacity: 0.7 }, disabled: { opacity: 0.45 },
});
