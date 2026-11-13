import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import { ensureQuickTravelArchive } from '@/utils/quick-travel';

type WorldDraft = {
  name: string;
  generationBrief: string;
  worldEra: string;
  worldRules: string;
  protagonistIdentity: string;
  entryScene: string;
  mission: string;
  premise: string;
  knownToProtagonist: string;
  originalEnding: string;
};

type KeyedWorldDraft = { worldId: string; value: WorldDraft };

function toDraft(world: {
  name: string;
  generationBrief?: string;
  worldEra: string;
  worldRules: string;
  protagonistIdentity: string;
  entryScene: string;
  mission: string;
  originalPlot: { premise: string; knownToProtagonist: string; originalEnding: string };
}): WorldDraft {
  return {
    name: world.name,
    generationBrief: world.generationBrief ?? '',
    worldEra: world.worldEra,
    worldRules: world.worldRules,
    protagonistIdentity: world.protagonistIdentity,
    entryScene: world.entryScene,
    mission: world.mission,
    premise: world.originalPlot.premise,
    knownToProtagonist: world.originalPlot.knownToProtagonist,
    originalEnding: world.originalPlot.originalEnding,
  };
}

export default function QuickTravelWorldEditScreen() {
  const { novelId: rawNovelId, worldId: rawWorldId } = useLocalSearchParams<{
    novelId?: string;
    worldId?: string;
  }>();
  const novelId = Array.isArray(rawNovelId) ? rawNovelId[0] : rawNovelId;
  const worldId = Array.isArray(rawWorldId) ? rawWorldId[0] : rawWorldId;
  const theme = useTheme();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const archive = useMemo(() => (novel ? ensureQuickTravelArchive(novel) : null), [novel]);
  const world = archive?.worlds.find((item) => item.id === worldId);
  const [draftState, setDraftState] = useState<KeyedWorldDraft | null>(null);
  const draft = world && draftState?.worldId === world.id ? draftState.value : world ? toDraft(world) : null;

  if (!novel || !archive || !world || !draft) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
        <View style={styles.invalidState}>
          <ThemedText type="subtitle">找不到指定的小世界</ThemedText>
          <ThemedText type="small" themeColor="textMuted">小说或世界链接已失效，请返回后重新选择。</ThemedText>
          <Pressable onPress={() => router.back()} style={[styles.secondary, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" themeColor="accent">返回</ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }
  const currentNovel = novel;
  const currentArchive = archive;
  const currentWorld = world;
  const currentDraft = draft;

  function update(field: keyof WorldDraft, value: string) {
    setDraftState({
      worldId: currentWorld.id,
      value: { ...currentDraft, [field]: value },
    });
  }

  function save(returnAfterSave = true) {
    const updatedAt = new Date().toISOString();
    updateNovel(currentNovel.id, {
      quickTravel: {
        ...currentArchive,
        worlds: currentArchive.worlds.map((item) =>
          item.id === currentWorld.id
            ? {
                ...item,
                name: currentDraft.name.trim() || item.name,
                generationBrief: currentDraft.generationBrief.trim(),
                worldEra: currentDraft.worldEra.trim(),
                worldRules: currentDraft.worldRules.trim(),
                protagonistIdentity: currentDraft.protagonistIdentity.trim(),
                entryScene: currentDraft.entryScene.trim(),
                mission: currentDraft.mission.trim(),
                originalPlot: {
                  ...item.originalPlot,
                  premise: currentDraft.premise.trim(),
                  knownToProtagonist: currentDraft.knownToProtagonist.trim(),
                  originalEnding: currentDraft.originalEnding.trim(),
                },
                updatedAt,
              }
            : item,
        ),
      },
    });
    setDraftState(null);
    if (returnAfterSave) router.back();
  }

  const fields: { key: keyof WorldDraft; label: string; hint: string; tall?: boolean }[] = [
    { key: 'name', label: '世界名称', hint: '例如：双生镇的秘密' },
    { key: 'generationBrief', label: '创作梗概', hint: '交给 AI 补全这个小世界时使用', tall: true },
    { key: 'worldEra', label: '时代与背景', hint: '时间、地点、社会环境', tall: true },
    { key: 'worldRules', label: '本世界规则', hint: '限制、能力体系、禁忌或特殊机制', tall: true },
    { key: 'protagonistIdentity', label: '主角身份', hint: '主角进入本世界后的身份', tall: true },
    { key: 'mission', label: '世界任务', hint: '本世界需要完成的目标', tall: true },
    { key: 'entryScene', label: '进入场景', hint: '本世界的开场位置与状态', tall: true },
    { key: 'premise', label: '原定剧情', hint: '原剧情的核心前提与发展', tall: true },
    { key: 'knownToProtagonist', label: '主角已知剧情', hint: '主角进入时掌握的信息', tall: true },
    { key: 'originalEnding', label: '原定结局', hint: '原剧情原本的结局', tall: true },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <Stack.Screen options={{ title: '编辑小世界', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ThemedText type="title">{currentWorld.name}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">修改只作用于当前小世界，不会改动整本小说或其他世界。</ThemedText>
        </View>
        {fields.map((field) => (
          <View key={field.key} style={styles.field}>
            <ThemedText type="smallBold">{field.label}</ThemedText>
            <TextInput
              value={currentDraft[field.key]}
              onChangeText={(value) => update(field.key, value)}
              placeholder={field.hint}
              placeholderTextColor={theme.textMuted}
              multiline={field.tall}
              style={[
                styles.input,
                field.tall && styles.tallInput,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface },
              ]}
            />
          </View>
        ))}
        <Pressable onPress={() => { if (draftState) save(false); router.push({ pathname: '/novel/planning', params: { kind: 'world', novelId: currentNovel.id, worldId: currentWorld.id } } as Href); }} style={[styles.secondary, { borderColor: theme.accent }]}>
          <ThemedText type="smallBold" themeColor="accent">进入 AI 世界规划台</ThemedText>
        </Pressable>
        <View style={styles.actions}>
          <Pressable onPress={() => router.back()} style={[styles.secondary, { borderColor: theme.border }]}>
            <ThemedText type="smallBold" themeColor="accent">取消</ThemedText>
          </Pressable>
          <Pressable onPress={() => save()} style={[styles.primary, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>保存世界设定</ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  invalidState: { flex: 1, padding: Spacing.four, gap: Spacing.two, justifyContent: 'center' },
  header: { gap: Spacing.one, marginBottom: Spacing.one },
  field: { gap: Spacing.one },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: Spacing.three, textAlignVertical: 'top' },
  tallInput: { minHeight: 112 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  secondary: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primary: { flex: 2, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
