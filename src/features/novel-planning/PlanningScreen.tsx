import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import { Fonts } from '@/constants/theme';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { buildChatMarkdownStyles } from '@/utils/chat-markdown-styles';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { applyMemoryPatch, createPlanningSession, undoPlanningMemory, type PlanningSession, type PlanningItem } from './domain';
import { loadPlanningSession, savePlanningSession } from './repository';
import { requestPlanningReply, updatePlanningMemory, generatePlanningFields } from './generator';
import { resolvePlanningTarget, type PlanningTarget } from './targets';
import { resolveCreationPlanningTarget } from './creation-target';
import { completePlanningTurn } from './turn';
import { PlanningButton, PlanningComposer, PlanningText, usePlanningPalette } from './chat-ui';

const statusLabels = { confirmed: '已确定', candidate: '候选', question: '待解决', discarded: '已废弃' };

export default function PlanningScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const key = JSON.stringify(Object.fromEntries(Object.entries(params).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value])));
  const theme = usePlanningPalette();
  const { width, height } = useWindowDimensions();
  const compact = width < 600;
  const markdownStyles = useMemo(() => buildChatMarkdownStyles({ color: theme.text, secondaryColor: theme.muted, fontSize: 16, fontFamily: 'system' }), [theme.text, theme.muted]);
  const providers = useTavernStore((state) => state.providers);
  const settings = useTavernStore((state) => state.generationSettings);
  const [target, setTarget] = useState<PlanningTarget | null>(null);
  const [session, setSession] = useState<PlanningSession | null>(null);
  const current = useRef<PlanningSession | null>(null);
  const mounted = useRef(true);
  const lock = useRef(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<'memory' | 'preview'>('memory');
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Record<string, string> | null>(null);
  const [previewRevision, setPreviewRevision] = useState(-1);
  const messagesView = useRef<ScrollView>(null);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void (async () => {
      try {
        const route = JSON.parse(key);
        const resolved = route.kind === 'creation'
          ? await resolveCreationPlanningTarget(route.creationId)
          : resolvePlanningTarget(route);
        const saved = await loadPlanningSession(resolved.scope);
        const next = saved ?? createPlanningSession(resolved.scope, resolved.seed);
        if (!saved) await savePlanningSession(next, null);
        if (!active) return;
        setTarget(resolved);
        current.current = next;
        setSession(next);
        if (next.generated?.revision === next.revision) {
          setPreview(readFields(resolved, next.generated.content));
          setPreviewRevision(next.revision);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '读取构想失败，请返回重试。');
      }
    })();
    return () => { active = false; mounted.current = false; };
  }, [key]);

  async function persist(next: PlanningSession) {
    await savePlanningSession(next, current.current);
    current.current = next;
    if (mounted.current) setSession(next);
  }

  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError('');
    try { await action(); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { lock.current = false; if (mounted.current) setBusy(''); }
  }

  function api() {
    const apiSettings = resolveApiSettings(providers, settings, { task: 'outline', purpose: 'utility' });
    if (!apiSettings.apiKey.trim()) throw new Error('请先在系统设置中配置辅助模型或默认模型。');
    return apiSettings;
  }

  async function completeTurn() {
    const state = current.current;
    if (!state?.pending || !target) return;
    const apiSettings = api();
    const maxTokens = settings.novelCreateMaxTokens;
    await completePlanningTurn(state, {
      reply: (session, prompt) => requestPlanningReply({ apiSettings, session, prompt, context: target.context, maxTokens }),
      remember: (session, prompt, reply, turnId) => {
        if (mounted.current) setBusy('正在记住本轮修改…');
        return updatePlanningMemory({ apiSettings, session, prompt, reply, turnId, maxTokens });
      },
      save: persist,
    });
  }

  function send() {
    const prompt = input.trim();
    if (!prompt || !current.current || current.current.pending) return;
    void run('正在一起构思…', async () => {
      api();
      const state = current.current!;
      const id = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await persist({ ...state, pending: { id, prompt }, messages: [...state.messages, { id: `${id}-user`, role: 'user', content: prompt }] });
      setInput('');
      await completeTurn();
    });
  }

  function editMemory(item?: PlanningItem, status?: PlanningItem['status']) {
    if (!current.current || current.current.pending) return;
    if (!status) { setEditing({ id: item?.id, text: item?.text ?? '' }); setTab('memory'); return; }
    void run('正在保存构想…', async () => {
      const state = current.current!;
      const updated = applyMemoryPatch(state, { operations: [{ op: 'update', id: item!.id, text: item!.text, status, sourceTurnId: 'manual' }] }, state.revision);
      await persist(updated);
    });
  }

  function saveMemory() {
    if (!editing?.text.trim() || !current.current || current.current.pending) return;
    void run('正在保存构想…', async () => {
      const state = current.current!;
      const updated = applyMemoryPatch(state, { operations: [{ op: editing.id ? 'update' : 'add', id: editing.id ?? `manual-${Date.now()}`, text: editing.text.trim(), status: 'confirmed', sourceTurnId: 'manual' }] }, state.revision);
      await persist(updated);
      setEditing(null);
    });
  }

  function generate() {
    if (!target || !current.current || current.current.pending || editing) return;
    void run('正在整理成设定草稿…', async () => {
      const state = current.current!;
      if (!state.items.some((item) => item.status === 'confirmed')) throw new Error('先聊聊你的想法，或在“当前构想”中采纳一些内容。');
      const content = await generatePlanningFields({ apiSettings: api(), session: state, context: target.context, targetInstructions: target.targetInstructions, maxTokens: settings.novelCreateMaxTokens });
      const fields = readFields(target, content);
      await persist({ ...state, generated: { revision: state.revision, content: fields } });
      setPreview(fields);
      setPreviewRevision(state.revision);
      setTab('preview');
      setPanelOpen(true);
    });
  }

  function reconcileBase(replace: boolean) {
    if (!target || !current.current || current.current.pending) return;
    void run('正在同步构想…', async () => {
      const state = current.current!;
      const fresh = createPlanningSession(state.scope, target.seed);
      await persist({
        ...state, baseSeed: target.seed, revision: state.revision + 1, generated: undefined,
        items: replace ? fresh.items : state.items,
        history: [...state.history, { revision: state.revision, items: state.items, at: new Date().toISOString() }],
      });
      setEditing(null);
    });
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/novel/create' as Href);
  }

  const changedBase = Boolean(session && target && (session.baseSeed ?? '') !== target.seed);
  const disabled = Boolean(busy) || Boolean(session?.pending) || changedBase;
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }];
  const empty = !session?.messages.length;
  const memoryCount = session?.items.filter((item) => item.status === 'confirmed').length ?? 0;
  const composer = <PlanningComposer value={input} onChange={setInput} onSend={send} onOpenMemory={() => { setTab('memory'); setPanelOpen(true); }} disabled={disabled || !session} busy={Boolean(busy)} memoryCount={memoryCount} empty={empty} />;

  async function applyPreview() {
    if (!target || !preview) return;
    if (!current.current || previewRevision !== current.current.revision || current.current.pending) throw new Error('请根据最新构想重新生成。');
    await persist({ ...current.current, generated: { revision: previewRevision, content: preview } });
    await target.apply(preview);
    try {
      const route = JSON.parse(key);
      const appliedTarget = route.kind === 'creation' ? await resolveCreationPlanningTarget(route.creationId) : resolvePlanningTarget(route);
      const state = current.current!;
      const appliedMemory = createPlanningSession(state.scope, appliedTarget.seed);
      await persist({ ...state, baseSeed: appliedTarget.seed, items: appliedMemory.items, revision: state.revision + 1, generated: undefined, history: [...state.history, { revision: state.revision, items: state.items, at: new Date().toISOString() }] });
    } catch { /* Applied successfully; offer reconciliation next visit if bookkeeping failed. */ }
    back();
  }

  const memory = (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.section}>
      <PlanningText muted>已确定的内容会用于生成完整设定。你可以在这里采纳、修改或废弃构想。</PlanningText>
      <View style={styles.row}>
        <PlanningButton label="补充一条" onPress={() => editMemory()} disabled={disabled} />
        <PlanningButton label="撤销上次修改" onPress={() => { void run('正在恢复…', async () => { await persist(undoPlanningMemory(current.current!)); }); }} disabled={disabled || !session?.history.length} />
      </View>
      {editing ? <View style={[styles.card, { borderColor: theme.accent }]}>
        <TextInput accessibilityLabel="编辑构想" multiline value={editing.text} onChangeText={(text) => setEditing({ ...editing, text })} style={inputStyle} editable={!busy} />
        <View style={styles.row}><PlanningButton label="保存为已确定" onPress={saveMemory} disabled={disabled || !editing.text.trim()} primary /><PlanningButton label="取消" onPress={() => setEditing(null)} disabled={Boolean(busy)} /></View>
      </View> : null}
      {session?.items.filter((item) => item.status !== 'discarded').map((item) => <View key={item.id} style={[styles.memoryItem, { borderColor: theme.border }]}>
        <PlanningText style={[styles.caption, { color: item.status === 'confirmed' ? theme.accent : theme.muted }]}>{statusLabels[item.status]}</PlanningText>
        <PlanningText selectable>{item.text}</PlanningText>
        <View style={styles.row}>
          {item.status !== 'confirmed' ? <PlanningButton label="采纳" onPress={() => editMemory(item, 'confirmed')} disabled={disabled} /> : null}
          <PlanningButton label="修改" onPress={() => editMemory(item)} disabled={disabled} />
          <PlanningButton label="废弃" onPress={() => editMemory(item, 'discarded')} disabled={disabled} />
        </View>
      </View>)}
      {!session?.items.some((item) => item.status !== 'discarded') ? <PlanningText muted>聊聊你想写什么，构想会逐步记录在这里。</PlanningText> : null}
    </ScrollView>
  );

  return <View style={[styles.root, { backgroundColor: theme.background }]}>
    <Stack.Screen options={{ headerShown: false }} />
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, compact && styles.compactHeader]}>
          <View style={styles.headerIdentity}>
            <Pressable accessibilityRole="button" accessibilityLabel="返回创建或设定页面" onPress={back} disabled={Boolean(busy)} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.subtle }]}><PlanningText style={styles.backGlyph}>‹</PlanningText></Pressable>
            <View style={styles.headerTitle}><PlanningText numberOfLines={1} style={styles.brand}>创作对话</PlanningText>{!compact ? <PlanningText numberOfLines={1} muted style={styles.caption}>{target?.title ?? '正在恢复对话'}</PlanningText> : null}</View>
          </View>
          <View style={styles.headerActions}>
            <TaskModelSelector task="outline" disabled={disabled} />
            {preview ? <Pressable accessibilityRole="button" onPress={() => { setTab('preview'); setPanelOpen(true); }} style={styles.textButton}><PlanningText muted style={styles.caption}>草稿</PlanningText></Pressable> : null}
            <PlanningButton label="生成完整设定" onPress={generate} disabled={disabled || !session || Boolean(editing)} />
          </View>
        </View>
        {error || changedBase || (session?.pending && !busy) ? <View style={[styles.notice, { backgroundColor: theme.subtle }]}>
          {error ? <PlanningText accessibilityLiveRegion="polite" style={{ color: theme.error }}>{error}</PlanningText> : null}
          {changedBase ? <View style={styles.noticeContent}>
            <PlanningText>原页面的设定已有更新。载入最新设定，或保留当前构想继续讨论。</PlanningText>
            <View style={styles.row}><PlanningButton label="载入最新设定" onPress={() => reconcileBase(true)} disabled={Boolean(busy) || Boolean(session?.pending)} /><PlanningButton label="保留当前构想" onPress={() => reconcileBase(false)} disabled={Boolean(busy) || Boolean(session?.pending)} /></View>
          </View> : null}
          {session?.pending && !busy ? <View style={styles.row}><PlanningText muted>本轮尚未完成。</PlanningText><PlanningButton label="继续本轮" onPress={() => { void run('正在继续本轮…', completeTurn); }} /></View> : null}
        </View> : null}
        {empty ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.emptyStage, { paddingBottom: height < 640 ? 28 : 100 }]}>
          <View style={styles.chatWidth}>
            <PlanningText style={[styles.greeting, compact && styles.compactGreeting]}>{session ? '想写一个怎样的故事？' : '正在恢复你的构想…'}</PlanningText>
            {composer}
            {busy ? <PlanningText accessibilityLiveRegion="polite" muted style={styles.composerHint}>{busy}</PlanningText> : null}
            <View style={styles.suggestions}>
              {['我有一个模糊的想法，帮我找到故事方向', '一起完善这个世界的规则和背景', '帮我梳理当前构想里还没确定的部分'].map((prompt) => <Pressable key={prompt} disabled={disabled || !session} onPress={() => setInput(prompt)} style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: theme.subtle }]}><PlanningText muted style={styles.suggestionText}>{prompt}</PlanningText></Pressable>)}
            </View>
          </View>
        </ScrollView> : <View style={styles.flex}>
          <ScrollView ref={messagesView} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.messagesContent} onContentSizeChange={() => messagesView.current?.scrollToEnd({ animated: true })}>
            <View style={[styles.chatWidth, styles.messages]}>
              {session?.messages.map((message) => <View key={message.id} style={[styles.message, message.role === 'user' ? [styles.userMessage, { backgroundColor: theme.subtle }] : styles.assistantMessage]}>
                {message.role === 'user' ? <PlanningText selectable style={styles.messageText}>{message.content}</PlanningText> : <Markdown style={markdownStyles}>{message.content}</Markdown>}
              </View>)}
              {busy ? <PlanningText accessibilityLiveRegion="polite" muted style={styles.caption}>{busy}</PlanningText> : null}
            </View>
          </ScrollView>
          <View style={styles.composerDock}><View style={styles.chatWidth}>{composer}<PlanningText muted style={styles.composerHint}>{Platform.OS === 'web' && !compact ? 'Enter 发送，Shift + Enter 换行' : '对话与构想自动保存'}</PlanningText></View></View>
        </View>}
        <Modal visible={panelOpen} transparent animationType="fade" onRequestClose={() => setPanelOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.modalOverlay, compact && styles.compactOverlay]}>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭面板" style={styles.modalBackdrop} onPress={() => setPanelOpen(false)} />
            <View accessibilityViewIsModal style={[styles.panel, { backgroundColor: theme.background, borderColor: theme.border }, compact && styles.compactPanel]}>
              <View style={[styles.panelHeader, { borderColor: theme.border }]}>
                <PlanningText style={styles.panelTitle}>{tab === 'memory' ? '构想记忆' : '完整设定预览'}</PlanningText>
                <Pressable accessibilityRole="button" accessibilityLabel="返回聊天" onPress={() => setPanelOpen(false)} style={styles.iconButton}><PlanningText style={styles.closeGlyph}>×</PlanningText></Pressable>
              </View>
              {error ? <PlanningText style={[styles.panelError, { color: theme.error }]}>{error}</PlanningText> : null}
              {tab === 'memory' ? memory : preview && target ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.section}>
                <PlanningText muted>应用到{target.title}。可以先修改；尚未确定的内容保留为空。</PlanningText>
                {previewRevision !== session?.revision ? <PlanningText style={{ color: theme.error }}>构想已经修改，请关闭预览并重新生成完整设定。</PlanningText> : null}
                {target.fields.map((field) => <View key={field.key} style={styles.previewField}>
                  <PlanningText style={styles.fieldLabel}>{field.label}</PlanningText>
                  <TextInput accessibilityLabel={field.label} multiline editable={!busy} value={preview[field.key]} onChangeText={(text) => setPreview({ ...preview, [field.key]: text })} style={inputStyle} />
                </View>)}
                <View style={styles.row}>
                  <PlanningButton label="保存草稿修改" onPress={() => { void run('正在保存草稿…', async () => { await persist({ ...current.current!, generated: { revision: previewRevision, content: preview } }); }); }} disabled={disabled || previewRevision !== session?.revision} />
                  <PlanningButton label="应用并返回" onPress={() => { void run('正在应用…', applyPreview); }} disabled={disabled || previewRevision !== session?.revision} primary />
                </View>
              </ScrollView> : null}
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </View>;
}

function readFields(target: PlanningTarget, content: Record<string, unknown>): Record<string, string> {
  if (Object.keys(content).some((key) => !target.fields.some((field) => field.key === key))) throw new Error('生成结果包含范围外字段，请重试。');
  const result: Record<string, string> = {};
  for (const field of target.fields) {
    const value = content[field.key];
    if (typeof value !== 'string') throw new Error('生成结果字段不完整，请重试。');
    result[field.key] = value;
  }
  return result;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, safe: { flex: 1, width: '100%' }, flex: { flex: 1 },
  header: { minHeight: 72, paddingHorizontal: 28, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  compactHeader: { minHeight: 64, paddingHorizontal: 12, gap: 6 },
  headerIdentity: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }, headerTitle: { flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, brand: { fontSize: 15, fontWeight: '600' },
  iconButton: { width: 38, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  backGlyph: { fontSize: 30, lineHeight: 34 }, closeGlyph: { fontSize: 26, lineHeight: 32 },
  textButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 }, caption: { fontSize: 12, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  section: { padding: 24, gap: 20, paddingBottom: 40 },
  card: { borderWidth: 1, borderColor: 'transparent', borderRadius: 14, padding: 14, gap: 12 },
  input: { minHeight: 90, maxHeight: 220, borderWidth: 1, borderRadius: 12, padding: 14, textAlignVertical: 'top', fontFamily: Fonts.sans, fontSize: 15, lineHeight: 24 },
  chatWidth: { width: '100%', maxWidth: 800, alignSelf: 'center' },
  emptyStage: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: 30 },
  greeting: { fontSize: 28, lineHeight: 40, fontWeight: '600', textAlign: 'center', marginBottom: 30 }, compactGreeting: { fontSize: 23, lineHeight: 34, marginBottom: 24 },
  suggestions: { marginTop: 22, paddingHorizontal: 10, gap: 3 }, suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10 }, suggestionText: { fontSize: 14, lineHeight: 22 },
  notice: { width: '92%', maxWidth: 800, alignSelf: 'center', padding: 14, borderRadius: 12, gap: 10, marginBottom: 12 }, noticeContent: { gap: 12 },
  messagesContent: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 32 }, messages: { gap: 28 },
  message: { maxWidth: '100%' }, userMessage: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 22 },
  assistantMessage: { alignSelf: 'stretch', paddingHorizontal: 4 }, messageText: { fontSize: 16, lineHeight: 27 },
  composerDock: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8 }, composerHint: { textAlign: 'center', fontSize: 11, lineHeight: 18, marginTop: 10 },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, compactOverlay: { padding: 10, paddingTop: 32 },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(10, 12, 20, 0.3)' },
  panel: { width: '100%', maxWidth: 720, height: '90%', borderRadius: 22, borderWidth: 1, overflow: 'hidden' }, compactPanel: { height: '96%', borderRadius: 18 },
  panelHeader: { paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, panelTitle: { fontSize: 19, fontWeight: '600' }, panelError: { paddingHorizontal: 24, paddingTop: 12 },
  memoryItem: { paddingVertical: 14, gap: 12, borderBottomWidth: 1 }, previewField: { gap: 8 }, fieldLabel: { fontSize: 14, fontWeight: '500' },
});
