import { router, type Href } from 'expo-router';
import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelImagePickerField } from '@/components/NovelImagePickerField';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing, type ThemePalette } from '@/constants/theme';
import { readNovelBlueprint, buildNovelBlueprintUpdate } from '@/features/novel-creation/legacy-novel-adapter';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';
import { confirmAppAction } from '@/utils/app-alert';

type Props = { novelId?: string };

export function DesktopNovelSettings({ novelId }: Props) {
  const theme = useTheme();
  const navigation = useNavigation();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const [name, setName] = useState('');
  const [shortIntro, setShortIntro] = useState('');
  const [detailedIntro, setDetailedIntro] = useState('');
  const [premise, setPremise] = useState('');
  const [firstChapterGoal, setFirstChapterGoal] = useState('');
  const [endingDirection, setEndingDirection] = useState('');
  const [tone, setTone] = useState('');
  const [writingStyle, setWritingStyle] = useState('');
  const [constraints, setConstraints] = useState('');
  const [coverImageUri, setCoverImageUri] = useState<string | undefined>();
  const [hydrated, setHydrated] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const leavePromptPending = useRef(false);
  const blueprint = useMemo(() => (novel ? readNovelBlueprint(novel) : null), [novel]);
  const currentSnapshot = JSON.stringify({ name, shortIntro, detailedIntro, premise, firstChapterGoal, endingDirection, tone, writingStyle, constraints, coverImageUri });
  const isDirty = hydrated && savedSnapshot !== null && currentSnapshot !== savedSnapshot;

  useEffect(() => {
    if (!novel || hydrated) return;
    const timer = setTimeout(() => {
      const next = {
        name: novel.name,
        shortIntro: novel.shortIntro ?? '',
        detailedIntro: novel.detailedIntro ?? '',
        premise: readNovelBlueprint(novel).premise,
        firstChapterGoal: readNovelBlueprint(novel).opening,
        endingDirection: readNovelBlueprint(novel).direction,
        tone: readNovelBlueprint(novel).tone,
        writingStyle: novel.writingStyle ?? '',
        constraints: readNovelBlueprint(novel).constraints.join('\n'),
        coverImageUri: novel.coverImageUri,
      };
      setName(next.name);
      setShortIntro(next.shortIntro);
      setDetailedIntro(next.detailedIntro);
      setPremise(next.premise);
      setFirstChapterGoal(next.firstChapterGoal);
      setEndingDirection(next.endingDirection);
      setTone(next.tone);
      setWritingStyle(next.writingStyle);
      setConstraints(next.constraints);
      setCoverImageUri(next.coverImageUri);
      setSavedSnapshot(JSON.stringify(next));
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [hydrated, novel]);

  usePreventRemove(isDirty, ({ data }) => {
    if (leavePromptPending.current) return;
    leavePromptPending.current = true;
    void confirmAppAction('放弃未保存修改？', '离开后当前设置将丢失。', { confirmLabel: '放弃修改', cancelLabel: '继续编辑' })
      .then((confirmed) => { if (confirmed) navigation.dispatch(data.action); })
      .finally(() => { leavePromptPending.current = false; });
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || !isDirty || typeof window === 'undefined') return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty]);

  if (!novel || !blueprint) {
    return <ThemedView style={styles.centered}><ThemedText>小说不存在</ThemedText></ThemedView>;
  }

  function handleSave() {
    const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
    if (!latest || !name.trim()) {
      setFeedback('请填写作品名称。');
      return;
    }
    const nextBlueprint = { ...readNovelBlueprint(latest), premise: premise.trim(), opening: firstChapterGoal.trim(), direction: endingDirection.trim(), tone: tone.trim(), constraints: constraints.split('\n').map((item) => item.trim()).filter(Boolean) };
    updateNovel(latest.id, {
      ...buildNovelBlueprintUpdate(latest, nextBlueprint),
      name: name.trim(),
      shortIntro: shortIntro.trim(),
      detailedIntro: detailedIntro.trim(),
      writingStyle: writingStyle.trim(),
      coverImageUri,
    });
    setSavedSnapshot(currentSnapshot);
    setFeedback(`已保存：${latest.cast?.length ?? 0} 张角色卡、${latest.chapters?.length ?? 0} 个已写章节未被自动改写。`);
  }

  return (
    <ThemedView decorated style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="返回"><ThemedText themeColor="accent">返回</ThemedText></Pressable>
            <ThemedText type="code" themeColor="accent">NOVEL STUDIO / SETTINGS</ThemedText>
            <ThemedText type="title">作品设置</ThemedText>
            <ThemedText themeColor="textSecondary">只保留会影响写作的基础信息；人物与世界设定分别进入对应工作台维护。</ThemedText>
          </View>
          <View style={[styles.panel, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <Field label="作品名称" value={name} onChangeText={setName} placeholder="例如：雨夜旧城区" theme={theme} />
            <NovelImagePickerField label="封面图" hint="可选，作为书架封面。" kind="cover" uri={coverImageUri} onChangeUri={setCoverImageUri} />
            <Field label="一句话简介" value={shortIntro} onChangeText={setShortIntro} placeholder="用一句话说清故事吸引力。" theme={theme} />
            <Field label="详细简介" value={detailedIntro} onChangeText={setDetailedIntro} placeholder="题材、背景、主线方向等。" multiline theme={theme} />
            <Field label="故事前提" value={premise} onChangeText={setPremise} placeholder="谁想做什么，核心阻力是什么？" multiline theme={theme} />
            <Field label="第一章目标" value={firstChapterGoal} onChangeText={setFirstChapterGoal} placeholder="开篇冲突、人物选择与章末钩子。" multiline theme={theme} />
            <Field label="结局方向" value={endingDirection} onChangeText={setEndingDirection} placeholder="希望故事最终走向哪里？" multiline theme={theme} />
            <Field label="叙事气质" value={tone} onChangeText={setTone} placeholder="例如：克制、悬疑、慢热、黑色幽默。" multiline theme={theme} />
            <Field label="写作要求" value={writingStyle} onChangeText={setWritingStyle} placeholder="叙事视角、语言风格、对话节奏、章节输出要求；导入资料中识别的写作要求也在这里维护。" multiline theme={theme} />
            <Field label="作者约束" value={constraints} onChangeText={setConstraints} placeholder="每行一条，例如：不要系统升级流。" multiline theme={theme} />
          </View>
          <View style={[styles.scopeNotice, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">保存影响范围</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">保存前请核对角色、世界、大纲和已写章节；这里只更新作品蓝图，不会自动重写正文。</ThemedText>
          </View>
          <View style={styles.links}>
            <Link title="人物库" description="管理人物卡、身份与目标" onPress={() => router.push(`/novel/knowledge/characters/${novel.id}` as Href)} theme={theme} />
            <Link title="世界与大纲" description="完善世界规则、剧情与章节规划" onPress={() => router.push(`/novel/world-outline/${novel.id}` as Href)} theme={theme} />
            <Link title="已有章节" description="查看已写内容与草稿" onPress={() => router.push(`/novel/chapters/${novel.id}` as Href)} theme={theme} />
            <Link title="高级配置" description="模型、媒体与提示词等完整设置" onPress={() => router.push(`/novel/edit/${novel.id}?advanced=1` as Href)} theme={theme} />
          </View>
          <View style={styles.footer}>
            <ThemedText type="small" themeColor="textMuted">{isDirty ? '有未保存修改' : feedback || '已同步'}</ThemedText>
            <Pressable onPress={handleSave} style={({ pressed }) => [styles.save, { backgroundColor: theme.accent }, pressed && { opacity: 0.75 }]} accessibilityRole="button">
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>保存设置</ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

type FieldProps = { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; theme: ThemePalette };

function Field({ label, value, onChangeText, placeholder, multiline, theme }: FieldProps) {
  return <View style={styles.field}><ThemedText type="smallBold">{label}</ThemedText><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} accessibilityLabel={label} placeholderTextColor={theme.textMuted} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }, multiline && styles.multiline]} /></View>;
}

type LinkProps = { title: string; description: string; onPress: () => void; theme: ThemePalette };

function Link({ title, description, onPress, theme }: LinkProps) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.link, { borderColor: theme.border, backgroundColor: theme.backgroundElement }, pressed && { opacity: 0.75 }]}><ThemedText type="smallBold">{title} ↗</ThemedText><ThemedText type="small" themeColor="textMuted">{description}</ThemedText></Pressable>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, safeArea: { flex: 1, maxWidth: MaxContentWidth, width: '100%', alignSelf: 'center' }, content: { padding: Spacing.five, gap: Spacing.four, paddingBottom: Spacing.six },
  header: { gap: Spacing.one, maxWidth: 840 }, panel: { maxWidth: 980, borderWidth: 1, borderRadius: 18, padding: Spacing.four, gap: Spacing.three }, field: { gap: Spacing.one }, input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.two, fontSize: 15 }, multiline: { minHeight: 112, paddingTop: Spacing.two }, scopeNotice: { maxWidth: 980, borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: Spacing.one }, links: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, maxWidth: 980 }, link: { flex: 1, minWidth: 260, minHeight: 74, borderWidth: 1, borderRadius: 12, padding: Spacing.three, gap: 4 }, footer: { maxWidth: 980, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, save: { minHeight: 48, minWidth: 140, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
