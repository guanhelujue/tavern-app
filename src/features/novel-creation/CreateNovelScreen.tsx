import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelFormField } from '@/components/novel-create/NovelFormField';
import { MobilePageHeader, mobileStyles } from '@/components/mobile/MobileUI';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { showAppAlert } from '@/utils/app-alert';

import { generateBlueprintProposals } from './blueprint-generator';
import { applyCreationEdit, createNovelCreation } from './creation';
import { asyncStorageCreationDrafts } from './draft-repository';
import type { CreationEvent, CreationSession, StoryBlueprint } from './domain';
import { buildLegacyNovelInput } from './legacy-novel-adapter';

function BlueprintField({
  blueprint,
  onEdit,
  editable,
}: {
  blueprint: StoryBlueprint;
  onEdit: (event: CreationEvent) => void;
  editable: boolean;
}) {
  const edit = (patch: Extract<CreationEvent, { type: 'edit-blueprint' }>['patch']) => {
    onEdit({ type: 'edit-blueprint', patch });
  };

  return (
    <ThemedView type="surface" style={[styles.sectionCard, Platform.OS !== 'web' && { backgroundColor: 'transparent', padding: 0, gap: 24 }]}>
      <NovelFormField label="世界名称" required editable={editable} value={blueprint.title} placeholder="给这个世界起个名字，也可以先用暂定名" onChangeText={(title) => edit({ title })} />
      <NovelFormField label="世界内容" required editable={editable} multiline minHeight={200} value={blueprint.setting} placeholder="写下这个世界的背景、规则，或你想写的一段故事。暂时想到多少，就写多少。" onChangeText={(setting) => edit({ setting })} />
    </ThemedView>
  );
}

export default function NewNovelCreationScreen() {
  const theme = useTheme();
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const promptDefaults = useTavernStore((state) => state.novelPromptDefaults);
  const createNovel = useTavernStore((state) => state.createNovel);
  const [session, setSession] = useState<CreationSession | null>(null);
  const sessionRef = useRef<CreationSession | null>(null);
  const transitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const editVersionRef = useRef(0);
  const [busyAction, setBusyAction] = useState<'ideas' | 'commit' | null>(null);

  const creation = useMemo(() => createNovelCreation({
    drafts: asyncStorageCreationDrafts,
    generateBlueprints: async (seed) => {
      const apiSettings = resolveApiSettings(providers, generationSettings, { task: 'creation', purpose: 'utility' });
      if (!apiSettings.apiKey.trim()) throw new Error('请先在系统设置中配置默认模型或辅助模型 Key。');
      return generateBlueprintProposals({
        apiSettings,
        seed,
        maxTokens: generationSettings.novelCreateMaxTokens,
      });
    },
    commitNovel: (blueprint) => createNovel(buildLegacyNovelInput({
      blueprint,
      promptDefaults,
    })),
  }), [createNovel, generationSettings, promptDefaults, providers]);

  useFocusEffect(useCallback(() => {
    let active = true;
    void creation.open().then(async (opened) => {
      const next = opened.step === 'seed'
        ? await creation.transition(opened, { type: 'resume-blueprint' })
        : opened;
      if (!active) return;
      sessionRef.current = next;
      setSession(next);
    });
    return () => { active = false; };
  }, [creation]));

  async function openPlanning() {
    try {
      await transitionQueueRef.current;
      const current = sessionRef.current;
      if (!current) return;
      await asyncStorageCreationDrafts.save(current);
      router.push({ pathname: '/novel/planning', params: { kind: 'creation', creationId: current.id } } as Href);
    } catch {
      showAppAlert('草稿保存失败', '请重试后再进入创作对话。');
    }
  }

  function send(event: CreationEvent): Promise<void> {
    if (event.type === 'edit-seed' || event.type === 'edit-blueprint') {
      const current = sessionRef.current;
      if (!current) return Promise.resolve();
      const next = applyCreationEdit(current, event);
      sessionRef.current = next;
      setSession(next);
      const editVersion = ++editVersionRef.current;

      transitionQueueRef.current = transitionQueueRef.current.then(async () => {
        const saved = await creation.saveDraft(next);
        if (saved.error && editVersion === editVersionRef.current) {
          const latest = sessionRef.current;
          if (latest?.id === next.id) {
            const failed = { ...latest, error: saved.error };
            sessionRef.current = failed;
            setSession(failed);
          }
        }
      });
      return transitionQueueRef.current;
    }

    transitionQueueRef.current = transitionQueueRef.current.then(async () => {
      const current = sessionRef.current;
      if (!current) return;
      const next = await creation.transition(current, event);
      sessionRef.current = next;
      setSession(next);
    });
    return transitionQueueRef.current;
  }

  async function generateIdeas() {
    setBusyAction('ideas');
    try {
      await send({ type: 'generate-ideas' });
    } finally {
      setBusyAction(null);
    }
  }

  async function commit() {
    const current = sessionRef.current;
    if (!current) return;
    setBusyAction('commit');
    try {
      await transitionQueueRef.current;
      const latest = sessionRef.current;
      if (!latest) return;
      const novelId = await creation.commit(latest);
      router.replace(`/novel/workbench/${novelId}` as Href);
    } catch (error) {
      showAppAlert('还不能创建', error instanceof Error ? error.message : '创建小说失败。');
    } finally {
      setBusyAction(null);
    }
  }

  if (!session) {
    return (
      <ThemedView decorated style={styles.container}>
        <SafeAreaView style={styles.loading}><ThemedText themeColor="textMuted">正在恢复创作草稿…</ThemedText></SafeAreaView>
      </ThemedView>
    );
  }

  const isSeed = session.step === 'seed';
  const isIdeas = session.step === 'ideas';
  const activeBlueprint = session.step === 'blueprint' ? session.blueprint : undefined;

  return (
    <ThemedView decorated={Platform.OS === 'web'} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          {Platform.OS !== 'web' ? <MobilePageHeader title={activeBlueprint ? '创建作品' : '故事构思'} onBack={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/novels'); }} action={<ThemedText type="small" themeColor="textMuted">自动保存</ThemedText>} /> : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, Platform.OS !== 'web' && mobileStyles.content]}>
            {Platform.OS === 'web' ? <View style={styles.topBar}>
              <Pressable accessibilityRole="button" onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/(tabs)/novels' as Href);
              }} hitSlop={12}>
                <ThemedText type="smallBold" themeColor="accent">返回</ThemedText>
              </Pressable>
              <ThemedText type="code" themeColor="textMuted">自动保存</ThemedText>
            </View> : null}

            <View style={styles.hero}>
              {Platform.OS === 'web' ? <ThemedText type="code" themeColor="accent">NEW STORY</ThemedText> : null}
              <ThemedText style={styles.title}>
                {activeBlueprint ? '故事，从这里开始' : '找一点灵感'}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                {activeBlueprint
                  ? '先定下世界，随时可以继续完善。'
                  : '写下一句话或几个意象，让 AI 帮你寻找故事方向。'}
              </ThemedText>
            </View>

            {session.error ? (
              <ThemedView type="surface" style={[styles.errorCard, { borderColor: theme.error }]}> 
                <ThemedText type="small" style={{ color: theme.error }}>{session.error}</ThemedText>
              </ThemedView>
            ) : null}

            {isSeed ? (
              <ThemedView type="surface" style={[styles.seedCard, { borderColor: theme.border }]}> 
                <NovelFormField
                  label="你现在有的东西"
                  multiline
                  minHeight={180}
                  value={session.seed}
                  placeholder="例如：潮湿海港、一个每天都会被全城忘记的人、成年人的克制感……\n\n也可以完全留空。"
                  onChangeText={(seed) => { void send({ type: 'edit-seed', seed }); }}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={busyAction !== null}
                  onPress={() => { void generateIdeas(); }}
                  style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.accent }, (pressed || busyAction) && styles.dimmed]}>
                  <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                    {busyAction === 'ideas' ? '正在生成三个方向…' : '生成 3 个故事方案'}
                  </ThemedText>
                </Pressable>
                <TaskModelSelector task="creation" disabled={busyAction !== null} />
                <Pressable accessibilityRole="button" disabled={busyAction !== null} onPress={() => { void send({ type: 'resume-blueprint' }); }} style={styles.textButton}>
                  <ThemedText type="smallBold" themeColor="textMuted">返回世界创建</ThemedText>
                </Pressable>
              </ThemedView>
            ) : null}

            {isIdeas ? (
              <View style={styles.ideaList}>
                {session.proposals.map((idea, index) => (
                  <ThemedView key={idea.id} type="surface" style={[styles.ideaCard, { borderColor: theme.border }]}> 
                    <View style={styles.ideaHeading}>
                      <ThemedText type="code" themeColor="accent">0{index + 1}</ThemedText>
                      <ThemedText style={styles.ideaTitle}>{idea.title}</ThemedText>
                    </View>
                    <ThemedText themeColor="textSecondary">{idea.premise}</ThemedText>
                    <View style={styles.ideaFact}>
                      <ThemedText type="code" themeColor="textMuted">欲望</ThemedText>
                      <ThemedText type="small">{idea.protagonist.desire}</ThemedText>
                    </View>
                    <View style={styles.ideaFact}>
                      <ThemedText type="code" themeColor="textMuted">开篇</ThemedText>
                      <ThemedText type="small">{idea.opening}</ThemedText>
                    </View>
                    <View style={styles.ideaFact}>
                      <ThemedText type="code" themeColor="textMuted">长篇引擎 · {idea.longForm.arcs.length} 个阶段</ThemedText>
                      <ThemedText type="small">{idea.longForm.engine}</ThemedText>
                    </View>
                    <Pressable accessibilityRole="button" onPress={() => { void send({ type: 'choose-idea', id: idea.id }); }} style={[styles.chooseButton, { borderColor: theme.accent }]}>
                      <ThemedText type="smallBold" themeColor="accent">选择这个方向 →</ThemedText>
                    </Pressable>
                  </ThemedView>
                ))}
                <View style={styles.rowActions}>
                  <Pressable accessibilityRole="button" disabled={busyAction !== null} onPress={() => { void send({ type: 'back-to-seed' }); }} style={styles.textButton}>
                    <ThemedText type="smallBold" themeColor="textMuted">修改想法</ThemedText>
                  </Pressable>
                  <Pressable accessibilityRole="button" disabled={busyAction !== null} onPress={() => { void generateIdeas(); }} style={styles.textButton}>
                    <ThemedText type="smallBold" themeColor="accent">换一批</ThemedText>
                  </Pressable>
                </View>
                <Pressable accessibilityRole="button" disabled={busyAction !== null} onPress={() => { void send({ type: 'resume-blueprint' }); }} style={styles.textButton}>
                  <ThemedText type="smallBold" themeColor="textMuted">返回世界创建</ThemedText>
                </Pressable>
              </View>
            ) : null}

            {activeBlueprint ? (
              <>
                {Platform.OS !== 'web' ? <TaskModelSelector task="creation" disabled={busyAction !== null} /> : null}
                <BlueprintField blueprint={activeBlueprint} editable={busyAction === null} onEdit={(event) => { void send(event); }} />
                <View style={[styles.finalActions, Platform.OS !== 'web' && { flexDirection: 'column', flexWrap: 'nowrap', alignItems: 'stretch', width: '100%' }]}>
                  <Pressable accessibilityRole="button" disabled={busyAction !== null} onPress={() => { void send({ type: 'back-to-seed' }); }} style={styles.textButton}>
                    <ThemedText type="smallBold" themeColor="textMuted">让 AI 帮我构思</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyAction !== null}
                    onPress={() => { void commit(); }}
                    style={({ pressed }) => [styles.primaryButton, { flex: Platform.OS === 'web' ? 1 : undefined, backgroundColor: theme.accent }, (pressed || busyAction) && styles.dimmed]}>
                    <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                      {busyAction === 'commit' ? '正在创建…' : '创建并开始写作'}
                    </ThemedText>
                  </Pressable>
                </View>
                <Pressable accessibilityRole="button" disabled={busyAction !== null} onPress={() => { void openPlanning(); }} style={styles.planningLink}>
                  <ThemedText type="small" themeColor="textSecondary">还想聊聊想法？进入灵感对话 →</ThemedText>
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: Math.min(MaxContentWidth, 880) },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: 72, gap: Spacing.three },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { lineHeight: 24, maxWidth: 540 },
  errorCard: { borderWidth: 1, borderRadius: 14, padding: Spacing.three },
  seedCard: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.three },
  primaryButton: { minHeight: 48, borderRadius: 12, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 48, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.58 },
  ideaList: { gap: Spacing.three },
  ideaCard: { borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.three },
  ideaHeading: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  ideaTitle: { flex: 1, fontSize: 20, lineHeight: 28, fontWeight: '700' },
  ideaFact: { gap: 4 },
  chooseButton: { minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowActions: { flexDirection: 'row', justifyContent: 'space-between' },
  planningLink: { alignItems: 'center', padding: Spacing.two },
  sectionCard: { borderRadius: 12, padding: Spacing.three, gap: Spacing.three },
  finalActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
});
