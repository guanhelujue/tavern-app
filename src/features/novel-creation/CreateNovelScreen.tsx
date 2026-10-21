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
}: {
  blueprint: StoryBlueprint;
  onEdit: (event: CreationEvent) => void;
}) {
  const edit = (patch: Extract<CreationEvent, { type: 'edit-blueprint' }>['patch']) => {
    onEdit({ type: 'edit-blueprint', patch });
  };

  return (
    <View style={styles.blueprintSections}>
      <ThemedView type="surface" style={styles.sectionCard}>
        <ThemedText type="code" themeColor="accent">01 · 故事核心</ThemedText>
        <NovelFormField label="书名" required value={blueprint.title} placeholder="可以先用工作名" onChangeText={(title) => edit({ title })} />
        <NovelFormField label="故事前提" required multiline minHeight={120} value={blueprint.premise} placeholder="谁，在什么处境下，为了什么必须开始行动？" onChangeText={(premise) => edit({ premise })} />
      </ThemedView>

      <ThemedView type="surface" style={styles.sectionCard}>
        <ThemedText type="code" themeColor="accent">02 · 推动力</ThemedText>
        <NovelFormField label="主角身份" value={blueprint.protagonist.identity} placeholder="只写故事层面的身份，不必现在完成角色卡" onChangeText={(identity) => edit({ protagonist: { identity } })} />
        <NovelFormField label="主角最想得到什么" required multiline minHeight={96} value={blueprint.protagonist.desire} placeholder="能够持续推动整本书的欲望" onChangeText={(desire) => edit({ protagonist: { desire } })} />
        <NovelFormField label="什么在阻止主角" required multiline minHeight={96} value={blueprint.protagonist.obstacle} placeholder="外部阻力、内部缺陷，或两者同时存在" onChangeText={(obstacle) => edit({ protagonist: { obstacle } })} />
        <NovelFormField label="失败代价" multiline minHeight={88} value={blueprint.stakes} placeholder="如果失败，主角会失去什么？" onChangeText={(stakes) => edit({ stakes })} />
      </ThemedView>

      <ThemedView type="surface" style={styles.sectionCard}>
        <ThemedText type="code" themeColor="accent">03 · 从哪里开始</ThemedText>
        <NovelFormField label="世界与关键规则" multiline minHeight={110} value={blueprint.setting} placeholder="只写会影响故事的世界设定" onChangeText={(setting) => edit({ setting })} />
        <NovelFormField label="开篇场景" required multiline minHeight={110} value={blueprint.opening} placeholder="第一章发生的具体事件，以及章末钩子" onChangeText={(opening) => edit({ opening })} />
        <NovelFormField label="长期方向" multiline minHeight={96} value={blueprint.direction} placeholder="可选：大致发展或结局倾向" onChangeText={(direction) => edit({ direction })} />
        <NovelFormField label="长篇故事引擎" required multiline minHeight={120} value={blueprint.longForm.engine} placeholder="解决当前问题后，什么机制会自然产生新的选择、代价和更高层阻力？" onChangeText={(engine) => edit({ longForm: { ...blueprint.longForm, engine } })} />
        <NovelFormField label="阶段推进" required multiline minHeight={150} value={blueprint.longForm.arcs.join('\n')} placeholder={'至少三行，每行一个卷级阶段：目标、升级、不可逆转折\n第一阶段：……\n第二阶段：……\n第三阶段：……'} onChangeText={(value) => edit({ longForm: { ...blueprint.longForm, arcs: value.split('\n') } })} />
        <NovelFormField label="长期悬念与副线" required multiline minHeight={130} value={blueprint.longForm.openThreads.join('\n')} placeholder={'至少三行，安排不同速度发展的悬念、关系线或副线'} onChangeText={(value) => edit({ longForm: { ...blueprint.longForm, openThreads: value.split('\n') } })} />
        <NovelFormField label="叙事气质" value={blueprint.tone} placeholder="例如：克制、潮湿、黑色幽默、节奏明快" onChangeText={(tone) => edit({ tone })} />
        <NovelFormField label="作者约束" multiline minHeight={96} value={blueprint.constraints.join('\n')} placeholder="可选，每行一条；例如：不要系统升级流" onChangeText={(value) => edit({ constraints: value.split('\n') })} />
      </ThemedView>
    </View>
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
      const apiSettings = resolveApiSettings(providers, generationSettings, { purpose: 'utility' });
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
    void creation.open().then((next) => {
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
      router.replace(`/novel/${novelId}` as Href);
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
    <ThemedView decorated style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.topBar}>
              <Pressable onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace('/(tabs)/novels' as Href);
              }} hitSlop={12}>
                <ThemedText type="smallBold" themeColor="accent">返回</ThemedText>
              </Pressable>
              <ThemedText type="code" themeColor="textMuted">自动保存</ThemedText>
            </View>

            <View style={styles.hero}>
              <ThemedText type="code" themeColor="accent">NEW STORY</ThemedText>
              <ThemedText style={styles.title}>
                {activeBlueprint ? '把故事说清楚，\n然后开始写。' : '先找到一个\n值得写的故事。'}
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                {activeBlueprint
                  ? '这里只保留会真正影响正文的创作蓝图。封面、模型、角色卡和大纲都可以进入项目后再设置。'
                  : '不需要先选模式。写下一句话、几个意象，或者完全留空，让 AI 给出三个能够持续展开的长篇方向。'}
              </ThemedText>
            </View>

            <View style={styles.progressRow}>
              {['想法', '选择', '蓝图'].map((label, index) => {
                const active = (isSeed ? 0 : isIdeas ? 1 : 2) >= index;
                return (
                  <View key={label} style={styles.progressItem}>
                    <View style={[styles.progressDot, { backgroundColor: active ? theme.accent : theme.border }]} />
                    <ThemedText type="code" themeColor={active ? 'accent' : 'textMuted'}>{label}</ThemedText>
                  </View>
                );
              })}
            </View>

            <Pressable disabled={busyAction !== null} onPress={() => { void openPlanning(); }} style={[styles.ideaCard, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <ThemedText type="smallBold" themeColor="accent">进入创作对话 →</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">在独立对话台里慢慢完善想法，确定后再生成蓝图。构想与对话会自动保存。</ThemedText>
            </Pressable>

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
                  disabled={busyAction !== null}
                  onPress={() => { void generateIdeas(); }}
                  style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.accent }, (pressed || busyAction) && styles.dimmed]}>
                  <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                    {busyAction === 'ideas' ? '正在生成三个方向…' : '生成 3 个故事方案'}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => { void send({ type: 'start-blank' }); }} style={styles.textButton}>
                  <ThemedText type="smallBold" themeColor="textMuted">不使用 AI，直接填写蓝图</ThemedText>
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
                    <Pressable onPress={() => { void send({ type: 'choose-idea', id: idea.id }); }} style={[styles.chooseButton, { borderColor: theme.accent }]}>
                      <ThemedText type="smallBold" themeColor="accent">选择这个方向 →</ThemedText>
                    </Pressable>
                  </ThemedView>
                ))}
                <View style={styles.rowActions}>
                  <Pressable onPress={() => { void send({ type: 'back-to-seed' }); }} style={styles.textButton}>
                    <ThemedText type="smallBold" themeColor="textMuted">修改想法</ThemedText>
                  </Pressable>
                  <Pressable disabled={busyAction !== null} onPress={() => { void generateIdeas(); }} style={styles.textButton}>
                    <ThemedText type="smallBold" themeColor="accent">换一批</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {activeBlueprint ? (
              <>
                <BlueprintField blueprint={activeBlueprint} onEdit={(event) => { void send(event); }} />
                <View style={styles.finalActions}>
                  <Pressable onPress={() => { void send({ type: 'back-to-seed' }); }} style={styles.textButton}>
                    <ThemedText type="smallBold" themeColor="textMuted">重新找方向</ThemedText>
                  </Pressable>
                  <Pressable
                    disabled={busyAction !== null}
                    onPress={() => { void commit(); }}
                    style={({ pressed }) => [styles.primaryButton, { flex: 1, backgroundColor: theme.accent }, (pressed || busyAction) && styles.dimmed]}>
                    <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                      {busyAction === 'commit' ? '正在创建…' : '创建并开始写作'}
                    </ThemedText>
                  </Pressable>
                </View>
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
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: 72, gap: Spacing.four },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { gap: Spacing.two },
  title: { fontSize: 40, lineHeight: 46, fontWeight: '700', letterSpacing: -1 },
  subtitle: { lineHeight: 24, maxWidth: 540 },
  progressRow: { flexDirection: 'row', gap: Spacing.three },
  progressItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  progressDot: { width: 7, height: 7, borderRadius: 4 },
  errorCard: { borderWidth: 1, borderRadius: 14, padding: Spacing.three },
  seedCard: { borderWidth: 1, borderRadius: 24, padding: Spacing.four, gap: Spacing.three },
  primaryButton: { minHeight: 54, borderRadius: 18, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 42, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  dimmed: { opacity: 0.58 },
  ideaList: { gap: Spacing.three },
  ideaCard: { borderWidth: 1, borderRadius: 22, padding: Spacing.four, gap: Spacing.three },
  ideaHeading: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  ideaTitle: { flex: 1, fontSize: 24, lineHeight: 30, fontWeight: '700' },
  ideaFact: { gap: 4 },
  chooseButton: { minHeight: 48, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowActions: { flexDirection: 'row', justifyContent: 'space-between' },
  blueprintSections: { gap: Spacing.three },
  sectionCard: { borderRadius: 22, padding: Spacing.four, gap: Spacing.three },
  finalActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
