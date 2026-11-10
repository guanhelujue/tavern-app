import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import type { Novel } from '@/types/tavern';
import { buildNovelBlueprintUpdate, readNovelBlueprint } from '@/features/novel-creation/legacy-novel-adapter';
import type { StoryBlueprint } from '@/features/novel-creation/domain';
import { ThemedText } from '@/components/themed-text';
import { confirmAppAction } from '@/utils/app-alert';

export function NovelStoryPlanningPanel({ novel }: { novel: Novel }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const currentNovel = useTavernStore((state) => state.novels.find((item) => item.id === novel.id)) ?? novel;
  const navigation = useNavigation();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<StoryBlueprint>(() => readNovelBlueprint(novel));
  const [baseline, setBaseline] = useState<StoryBlueprint>(() => readNovelBlueprint(novel));
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  usePreventRemove(dirty, ({ data }) => {
    void confirmAppAction('离开设定', '当前设定有未保存的修改，确定放弃修改并离开？').then((confirmed) => {
      if (confirmed) navigation.dispatch(data.action);
    });
  });
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function updateDraft(field: 'title' | 'setting', value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  function save() {
    const latest = readNovelBlueprint(currentNovel);
    const merged = { ...latest, title: draft.title, setting: draft.setting };
    updateNovel(currentNovel.id, buildNovelBlueprintUpdate(currentNovel, merged));
    setDraft(merged);
    setBaseline(merged);
    setSaved(true);
  }

  function cancel() {
    setDraft(readNovelBlueprint(novel));
    setBaseline(readNovelBlueprint(novel));
    setSaved(false);
    setExpanded(false);
  }

  const field = (label: string, value: string, onChangeText: (value: string) => void, multiline = false) => (
    <View style={[styles.field, width < 700 && styles.mobileField]} key={label}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline} placeholder="选填" placeholderTextColor={theme.textMuted} style={[styles.input, multiline && styles.multiline, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} />
    </View>
  );

  return (
    <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => { if (!expanded && !dirty) { const next = readNovelBlueprint(currentNovel); setDraft(next); setBaseline(next); } setExpanded((current) => !current); }} style={styles.header}>
        <View style={styles.headerCopy}><ThemedText type="smallBold" themeColor="accent">世界背景</ThemedText><ThemedText type="small" themeColor="textMuted">设定可以边写边补充，全部选填。</ThemedText></View>
        <ThemedText type="code" themeColor="accent">{expanded ? '收起 ↑' : '展开 ↓'}</ThemedText>
      </Pressable>
      {expanded ? <View style={styles.body}>
        <View style={styles.group}><ThemedText type="smallBold" themeColor="accent">世界基础</ThemedText><View style={styles.grid}>
          {field('世界名称', draft.title, (value) => updateDraft('title', value))}
          {field('世界内容', draft.setting, (value) => updateDraft('setting', value), true)}
        </View></View>
        <View style={styles.actions}><Pressable accessibilityRole="button" onPress={cancel} style={[styles.secondary, { borderColor: theme.border }]}><ThemedText type="smallBold">取消</ThemedText></Pressable><Pressable accessibilityRole="button" onPress={save} style={[styles.primary, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{saved ? '已保存' : '保存设定'}</ThemedText></Pressable></View>
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 10, padding: Spacing.three, gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  headerCopy: { flex: 1, gap: Spacing.one },
  body: { gap: Spacing.three },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  group: { gap: Spacing.two },
  field: { flexGrow: 1, flexBasis: '46%', minWidth: 0, width: '100%', gap: Spacing.one },
  mobileField: { flexBasis: '100%' },
  input: { minHeight: 42, width: '100%', minWidth: 0, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  multiline: { minHeight: 76, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  secondary: { minHeight: 42, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 42, borderRadius: 8, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
});
