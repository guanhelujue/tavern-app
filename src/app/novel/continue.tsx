import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
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
import { DEFAULT_CHARACTER_CARD_APPEARANCE_ID } from '@/constants/character-card-appearances';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getActiveProvider, useTavernStore } from '@/store/tavern-store';
import type { NovelChapter } from '@/types/tavern';
import { ensureNovelDossiers } from '@/utils/novel-dossiers';
import { DEFAULT_CHAT_BACKGROUND_OPACITY } from '@/utils/novel-images';
import { pickNovelTextFile, type ImportedNovelText } from '@/utils/novel-import';
import { EMPTY_PLAYER_PROFILE_FIELDS } from '@/utils/novel-player';
import { showAppAlert } from '@/utils/app-alert';

const CONTINUE_STEPS = [
  { index: 1, label: '导入小说' },
  { index: 2, label: '创建工程' },
] as const;

function ContinueStepIndicator({
  step,
  maxReachedStep,
  onStepPress,
}: {
  step: 1 | 2;
  maxReachedStep: 1 | 2;
  onStepPress?: (step: 1 | 2) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.stepRow}>
      {CONTINUE_STEPS.map((item, index) => {
        const active = item.index === step;
        const unlocked = item.index <= maxReachedStep;
        const clickable = Boolean(onStepPress) && unlocked && item.index !== step;

        return (
          <View key={item.index} style={styles.stepItemWrap}>
            {index > 0 ? (
              <View
                style={[
                  styles.stepConnector,
                  {
                    backgroundColor: item.index <= maxReachedStep ? theme.accent : theme.border,
                  },
                ]}
              />
            ) : null}
            <Pressable
              disabled={!clickable}
              onPress={() => onStepPress?.(item.index)}
              style={styles.stepItem}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor: unlocked ? theme.accent : theme.backgroundElement,
                    borderColor: unlocked ? theme.accent : theme.border,
                  },
                ]}>
                <ThemedText type="code" style={{ color: unlocked ? theme.onPrimary : theme.textMuted }}>
                  {item.index}
                </ThemedText>
              </View>
              <ThemedText
                type="smallBold"
                themeColor={active ? 'accent' : unlocked ? 'text' : 'textMuted'}>
                {item.label}
              </ThemedText>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

function countChapterChars(chapters: ImportedNovelText['chapters']): number {
  return chapters.reduce((sum, chapter) => sum + chapter.content.length, 0);
}

export default function ContinueNovelScreen() {
  const theme = useTheme();
  const providers = useTavernStore((state) => state.providers);
  const novelPromptDefaults = useTavernStore((state) => state.novelPromptDefaults);
  const createNovel = useTavernStore((state) => state.createNovel);
  const activeProvider = useMemo(() => getActiveProvider(providers), [providers]);

  const [step, setStep] = useState<1 | 2>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<1 | 2>(1);

  // Step 1 — import
  const [imported, setImported] = useState<ImportedNovelText | null>(null);
  const [bookName, setBookName] = useState('');

  // Step 2 — create
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 1) {
        setStep(1);
        setFormError('');
        return true;
      }
      return false;
    });

    return () => sub.remove();
  }, [step]);

  function handleBack() {
    if (step > 1) {
      setStep(1);
      setFormError('');
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/novels' as Href);
  }

  function goToStep(nextStep: 1 | 2) {
    if (nextStep > maxReachedStep) {
      return;
    }
    setFormError('');
    setStep(nextStep);
  }

  async function handlePickFile() {
    try {
      const result = await pickNovelTextFile();

      if (!result) {
        return;
      }

      if (result.chapters.length === 0) {
      showAppAlert('导入失败', '文件中没有可识别的正文内容。');
        return;
      }

      setImported(result);
      setBookName((current) => (current.trim() ? current : result.title));
      setFormError('');
    } catch (error) {
      console.error('导入小说文件失败', error);
      showAppAlert('导入失败', error instanceof Error ? error.message : '无法读取文件。');
    }
  }

  function handleResetImport() {
    setImported(null);
    setBookName('');
  }

  function handleCreate() {
    if (isCreating || !imported || imported.chapters.length === 0) {
      return;
    }

    const trimmedName = bookName.trim() || imported.title || '未命名小说';
    setIsCreating(true);
    setFormError('');

    try {
      const timestamp = new Date().toISOString();
      const chapters: NovelChapter[] = imported.chapters.map((chapter, index) => ({
        id: `chapter-${Date.now()}-${index}`,
        index: index + 1,
        title: chapter.title,
        summary: '',
        goal: '',
        content: chapter.content,
        status: 'final',
        createdAt: timestamp,
        updatedAt: timestamp,
      }));

      const novelId = createNovel({
        name: trimmedName,
        shortIntro: '',
        detailedIntro: '',
        systemPrompt: novelPromptDefaults.systemPrompt,
        writingStyle: '',
        shortTermMemoryPrompt: novelPromptDefaults.shortTermMemoryPrompt,
        midTermMemoryPrompt: novelPromptDefaults.midTermMemoryPrompt,
        longTermMemoryPrompt: novelPromptDefaults.longTermMemoryPrompt,
        playerName: '',
        playerPersona: '',
        playerMotive: '',
        ...EMPTY_PLAYER_PROFILE_FIELDS,
        worldName: '',
        worldEra: '',
        worldConflict: '',
        worldTone: '',
        mainPlot: '',
        initialStoryState: '',
        gameRules: '',
        autoSuggestRoutes: false,
        relationGraphEnabled: false,
        characterCardAppearanceId: DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
        cast: [],
        characterDossiers: ensureNovelDossiers({ cast: [], characterDossiers: [] }),
        loreEntries: [],
        relationGraphs: [],
        openingMessage: '',
        defaultModelId: '',
        defaultProviderId: undefined,
        coverImageUri: undefined,
        chatBackgroundUri: undefined,
        chatBackgroundOpacity: DEFAULT_CHAT_BACKGROUND_OPACITY,
        isDraft: false,
        createStep: 3,
        isContinuationProject: true,
        chapters,
      });

      showAppAlert(
        '续写工程已创建',
        `已导入 ${chapters.length} 章正文。进入工作台后将自动开始状态分析（提取世界规则 / 角色 / 伏笔 / 文风），完成后会自动同步到知识库。`,
      );
      router.replace(`/novel/workbench/${novelId}?focus=analysis&autoAnalyze=1` as Href);
    } catch (error) {
      console.error('创建续写工程失败', error);
      showAppAlert('创建失败', error instanceof Error ? error.message : '创建续写工程失败。');
      setIsCreating(false);
    }
  }

  const totalChars = imported ? countChapterChars(imported.chapters) : 0;
  const canCreate = Boolean(imported) && !isCreating;

  return (
    <ThemedView decorated style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ThemedText type="small" themeColor="accent">
                  {step === 1 ? '返回' : '上一步'}
                </ThemedText>
              </Pressable>
              <ThemedText type="code" themeColor="accent">
                NOVEL CONTINUE
              </ThemedText>
              <ThemedText type="title" style={styles.title}>
                续写小说
              </ThemedText>
              <ContinueStepIndicator
                step={step}
                maxReachedStep={maxReachedStep}
                onStepPress={goToStep}
              />
            </View>

            {step === 1 ? (
              <View style={styles.stepBlock}>
                <ThemedView type="surface" style={[styles.infoCard, { borderColor: theme.border }]}>
                  <ThemedText type="smallBold">第一步 · 导入小说</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    从本地选择 TXT / Markdown 正文文件，系统会自动按章节标题拆分。创建工程后将自动开始状态分析并提取设定，用于后续续写。
                  </ThemedText>
                </ThemedView>

                {!imported ? (
                  <Pressable
                    onPress={() => {
                      void handlePickFile();
                    }}
                    style={({ pressed }) => [
                      styles.importDropzone,
                      { borderColor: theme.accent, backgroundColor: theme.accentMuted },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="subtitle" themeColor="accent">
                      选择文本文件
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      支持 .txt / .md，可包含「第X章」或 Markdown 标题
                    </ThemedText>
                  </Pressable>
                ) : (
                  <ThemedView type="surface" style={[styles.importCard, { borderColor: theme.border }]}>
                    <View style={styles.importHeader}>
                      <View style={styles.importTitleWrap}>
                        <ThemedText type="smallBold" numberOfLines={2}>
                          {imported.fileName}
                        </ThemedText>
                        <ThemedText type="code" themeColor="accent">
                          {imported.chapters.length} 章 · {totalChars.toLocaleString()} 字
                        </ThemedText>
                      </View>
                      <Pressable
                        onPress={handleResetImport}
                        style={({ pressed }) => [
                          styles.ghostButton,
                          { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                          pressed && styles.pressed,
                        ]}>
                        <ThemedText type="code" themeColor="accent">
                          重新选择
                        </ThemedText>
                      </Pressable>
                    </View>

                    <NovelFormField
                      label="书名"
                      value={bookName}
                      placeholder="续写工程的显示名称"
                      onChangeText={setBookName}
                    />

                    <View style={styles.chapterListHeader}>
                      <ThemedText type="smallBold">章节预览</ThemedText>
                      <ThemedText type="small" themeColor="textMuted">
                        前 {Math.min(imported.chapters.length, 6)} / {imported.chapters.length}
                      </ThemedText>
                    </View>
                    {imported.chapters.slice(0, 6).map((chapter, index) => (
                      <View
                        key={`${chapter.title}-${index}`}
                        style={[
                          styles.chapterRow,
                          { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                        ]}>
                        <ThemedText type="code" themeColor="accent">
                          {String(index + 1).padStart(2, '0')}
                        </ThemedText>
                        <ThemedText type="small" numberOfLines={1} style={styles.chapterTitle}>
                          {chapter.title}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textMuted">
                          {chapter.content.length} 字
                        </ThemedText>
                      </View>
                    ))}
                  </ThemedView>
                )}
              </View>
            ) : null}

            {step === 2 ? (
              <View style={styles.stepBlock}>
                <ThemedView type="surface" style={[styles.infoCard, { borderColor: theme.border }]}>
                  <ThemedText type="smallBold">第二步 · 创建续写工程</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    将已导入的章节保存为一本新小说并加入书架。进入工作台后会立即开始状态分析，自动提取世界规则 / 角色 / 伏笔 / 文风，并同步到知识库。
                  </ThemedText>
                </ThemedView>

                <ThemedView type="surface" style={[styles.confirmCard, { borderColor: theme.border }]}>
                  <View style={styles.confirmRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      书名
                    </ThemedText>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.confirmValue}>
                      {bookName.trim() || imported?.title || '未命名小说'}
                    </ThemedText>
                  </View>
                  <View style={styles.confirmRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      章节
                    </ThemedText>
                    <ThemedText type="smallBold">{imported?.chapters.length ?? 0} 章</ThemedText>
                  </View>
                  <View style={styles.confirmRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      正文
                    </ThemedText>
                    <ThemedText type="smallBold">{totalChars.toLocaleString()} 字</ThemedText>
                  </View>
                  <View style={styles.confirmRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      模型
                    </ThemedText>
                    <ThemedText type="small" numberOfLines={1} style={styles.confirmValue}>
                      {activeProvider?.name ?? '跟随全局设置'}
                    </ThemedText>
                  </View>
                </ThemedView>

                <ThemedText type="small" themeColor="textMuted">
                  创建后自动进入续写工作台：状态分析使用「辅助小模型」逐章增量执行（可中断后继续），正文续写默认使用全局对话模型。
                </ThemedText>
              </View>
            ) : null}

            {formError ? (
              <ThemedText type="small" themeColor="accent">
                {formError}
              </ThemedText>
            ) : null}
          </ScrollView>

          <View
            style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            {step === 1 ? (
              <Pressable
                disabled={!imported}
                onPress={() => {
                  setMaxReachedStep((current) => (current < 2 ? 2 : current));
                  setStep(2);
                  setFormError('');
                }}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: theme.accent },
                  (!imported || pressed) && { opacity: 0.75 },
                ]}>
                <ThemedText type="smallBold" style={styles.saveButtonText}>
                  下一步：创建工程
                </ThemedText>
              </Pressable>
            ) : null}

            {step === 2 ? (
              <Pressable
                disabled={!canCreate}
                onPress={handleCreate}
                style={({ pressed }) => [
                  styles.saveButton,
                  { backgroundColor: theme.accent },
                  (!canCreate || pressed) && { opacity: 0.75 },
                ]}>
                <ThemedText type="smallBold" style={styles.saveButtonText}>
                  {isCreating ? '创建中…' : '创建续写工程'}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  header: {
    gap: Spacing.two,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: Spacing.two,
  },
  title: {
    fontSize: 36,
    lineHeight: 40,
  },
  stepBlock: {
    gap: Spacing.three,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.one,
  },
  stepItemWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepConnector: {
    width: 12,
    height: 2,
    marginRight: 4,
    borderRadius: 1,
  },
  stepItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  importDropzone: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 24,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  importCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  importHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  importTitleWrap: {
    flex: 1,
    gap: 2,
  },
  ghostButton: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 36,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 14,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  chapterTitle: {
    flex: 1,
  },
  confirmCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  confirmValue: {
    flex: 1,
    textAlign: 'right',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#120c09',
  },
  pressed: {
    opacity: 0.75,
  },
});
