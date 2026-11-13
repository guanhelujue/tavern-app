import { KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { NovelStoryMemoryModal } from '@/components/NovelStoryMemoryModal';
import { WorkbenchPanel } from '@/components/novel-continue/WorkbenchPanel';
import { ThemedText } from '@/components/themed-text';
import { NOVEL_CONTEXT_MAX_CHARS, NOVEL_LOOKBACK_MAX } from '@/constants/novel-continuation';
import { useTheme } from '@/hooks/use-theme';
import { resolveContinuationSettings } from '@/services/novel-continuation-pipeline';
import { useTavernStore } from '@/store/tavern-store';

/** Chapter context and legacy conversation memory have separate consumers. */
export function NovelContextPanel({ novelId }: { novelId: string }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const mobile = width < 600;
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const meta = useTavernStore((state) => state.novelConversationMeta[novelId]);
  const settings = novel ? resolveContinuationSettings(novel) : undefined;
  const [lookback, setLookback] = useState(String(settings?.lookbackChapters ?? 3));
  const [budget, setBudget] = useState(String(settings?.maxContextChars ?? 6000));
  const [feedback, setFeedback] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  if (!novel) return null;
  const finalChapters = [...(novel.chapters ?? [])].filter((chapter) => chapter.status === 'final').sort((a, b) => a.index - b.index);
  const included = settings?.lookbackChapters ? finalChapters.slice(-settings.lookbackChapters) : [];
  const inputStyle = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }];

  function save() {
    const lookbackChapters = Number(lookback);
    const maxContextChars = Number(budget);
    if (!lookback.trim() || !Number.isInteger(lookbackChapters) || lookbackChapters < 0 || lookbackChapters > NOVEL_LOOKBACK_MAX) {
      setFeedback(`回看章数需为 0–${NOVEL_LOOKBACK_MAX} 的整数。`); return;
    }
    if (!budget.trim() || !Number.isInteger(maxContextChars) || maxContextChars < 1000 || maxContextChars > NOVEL_CONTEXT_MAX_CHARS) {
      setFeedback(`上下文预算需为 1000–${NOVEL_CONTEXT_MAX_CHARS} 的整数。`); return;
    }
    useTavernStore.getState().updateNovelContinuationSettings(novelId, { lookbackChapters, maxContextChars });
    setFeedback('已保存，下次章节生成时生效。');
  }

  return <View style={styles.stack}>
    <WorkbenchPanel title="章节写作上下文" subtitle="这些设置用于章节创作。修改后从下一次生成开始生效。">
      <ThemedText type="smallBold">回看已定稿正文（0–{NOVEL_LOOKBACK_MAX} 章）</ThemedText>
      <TextInput accessibilityLabel="回看已定稿章数" value={lookback} onChangeText={setLookback} keyboardType="number-pad" style={[inputStyle, mobile && styles.mobileInput]} />
      <ThemedText type="small" themeColor="textMuted">0 表示不附加近期多章正文片段；上一章衔接、摘要、人物与剧情状态仍会参与生成。</ThemedText>
      <ThemedText type="smallBold">剧情上下文预算（字符）</ThemedText>
      <TextInput accessibilityLabel="剧情上下文字符预算" value={budget} onChangeText={setBudget} keyboardType="number-pad" style={[inputStyle, mobile && styles.mobileInput]} />
      <ThemedText type="small" themeColor="textMuted">用于裁剪剧情上下文，不是整个请求的 token 上限；人物与作品设定另行注入。</ThemedText>
      <Pressable accessibilityRole="button" onPress={save} style={[styles.button, mobile && styles.mobileButton, { backgroundColor: theme.primary }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>保存章节上下文设置</ThemedText></Pressable>
      {feedback ? <ThemedText accessibilityLiveRegion="polite" type="small">{feedback}</ThemedText> : null}
    </WorkbenchPanel>

    <WorkbenchPanel title="当前写作资料" subtitle="以下按已保存的回看设置展示；实际发送内容还会受预算裁剪。">
      <ThemedText type="small">近期正文：{included.length ? included.map((chapter) => `第 ${chapter.index} 章《${chapter.title}》`).join('、') : '不附加近期多章正文片段'}</ThemedText>
      <ThemedText type="small">正文衔接：{finalChapters.length ? `第 ${finalChapters.at(-1)!.index} 章结尾` : '尚无定稿章节'}</ThemedText>
      <ThemedText type="small" themeColor="textMuted">作品要求、人物与世界设定、当前章纲、剧情状态和未回收伏笔也会用于构建写作上下文。</ThemedText>
      <View style={styles.links}>
        {[
          ['作品设定', `/novel/edit/${novelId}`],
          ['故事大纲', `/novel/world-outline/${novelId}`],
          ['剧情资料', `/novel/workbench/${novelId}?focus=knowledge`],
        ].map(([label, href]) => <Pressable key={label} accessibilityRole="button" onPress={() => router.push(href as Parameters<typeof router.push>[0])} style={[styles.button, { borderColor: theme.border, borderWidth: 1 }]}><ThemedText type="small">{label}</ThemedText></Pressable>)}
      </View>
    </WorkbenchPanel>

    <WorkbenchPanel title="小说对话记忆" subtitle="原上下文调度台：管理小说对话的注入来源与 8 → 5 → 1 记忆。此处的开关不控制章节写作。">
      <Pressable accessibilityRole="button" onPress={() => setMemoryOpen(true)} style={[styles.button, { borderWidth: 1, borderColor: theme.border }]}><ThemedText type="smallBold">打开上下文调度台</ThemedText></Pressable>
    </WorkbenchPanel>
    {memoryOpen && <NovelStoryMemoryModal
      visible longTermMemory={meta?.longTermMemory ?? ''} midTermMemories={meta?.midTermMemories ?? []} shortTermMemories={meta?.shortTermMemories ?? []}
      injectionToggles={meta?.injectionToggles} memorySystemEnabled={meta?.memorySystemEnabled !== false} lastMemoryError={meta?.lastMemoryError} isMerging={merging}
      onClose={() => setMemoryOpen(false)}
      onSave={(next) => useTavernStore.getState().updateNovelStoryMemories(novelId, next)}
      onInjectionTogglesChange={(toggles) => useTavernStore.getState().updateNovelInjectionToggles(novelId, toggles)}
      onMemorySystemToggle={(enabled) => useTavernStore.getState().updateNovelMemorySystemToggle(novelId, enabled)}
      onMergeNow={async () => { setMerging(true); try { await useTavernStore.getState().mergeNovelShortTermMemories(novelId); } finally { setMerging(false); } }}
    />}
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: 20 }, input: { borderWidth: 1, borderRadius: 6, padding: 12, minHeight: 44, maxWidth: 320 },
  mobileInput: { minHeight: 48, borderRadius: 12, fontSize: 16 },
  button: { minHeight: 44, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 12, alignSelf: 'flex-start', justifyContent: 'center' },
  mobileButton: { minHeight: 48, borderRadius: 12 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
