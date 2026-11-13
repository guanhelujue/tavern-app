import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { ENABLE_QUICK_TRAVEL } from '@/config/build-features';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelImagePickerField } from '@/components/NovelImagePickerField';
import { NovelMobileNavigation } from '@/components/novel-continue/NovelMobileNavigation';
import { mobileStyles } from '@/components/mobile/MobileUI';
import { NovelVideoPickerField } from '@/components/NovelVideoPickerField';
import { QuickTravelWorldDraftEditor } from '@/components/QuickTravelWorldDraftEditor';
import { NovelCastEditor } from '@/components/novel-create/NovelCastEditor';
import { DesktopNovelSettings } from '@/components/desktop/DesktopNovelSettings';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DEFAULT_CHARACTER_CARD_APPEARANCE_ID } from '@/constants/character-card-appearances';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { useTavernStore } from '@/store/tavern-store';
import type { NovelCastCharacter, WorldPack } from '@/types/tavern';
import { DEFAULT_CHAT_BACKGROUND_OPACITY, isNovelVideoUri } from '@/utils/novel-images';
import { mergeIntroForDisplay, splitIntroForStorage } from '@/utils/novel-intro';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import {
  EMPTY_PLAYER_PROFILE_FIELDS,
  getProtagonistCast,
  mirrorProtagonistToPlayerFields,
  normalizePlayerProfileFields,
  type NovelPlayerProfileFields,
} from '@/utils/novel-player';
import { syncDossiersWithCast } from '@/utils/novel-dossiers';
import {
  buildQuickTravelCharacterContext,
  ensureQuickTravelArchive,
} from '@/utils/quick-travel';

function LegacyEditNovelScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const novels = useTavernStore((state) => state.novels);
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const novelPromptDefaults = useTavernStore((state) => state.novelPromptDefaults);
  const novel = novels.find((item) => item.id === novelId);

  const [name, setName] = useState('');
  const [workIntro, setWorkIntro] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerPersona, setPlayerPersona] = useState('');
  const [playerMotive, setPlayerMotive] = useState('');
  const [playerProfile, setPlayerProfile] = useState<NovelPlayerProfileFields>(
    EMPTY_PLAYER_PROFILE_FIELDS,
  );
  const [worldName, setWorldName] = useState('');
  const [worldEra, setWorldEra] = useState('');
  const [gameRules, setGameRules] = useState('');
  const [characterCardAppearanceId, setCharacterCardAppearanceId] = useState(DEFAULT_CHARACTER_CARD_APPEARANCE_ID);
  const [autoSuggestRoutes, setAutoSuggestRoutes] = useState(false);
  const [cast, setCast] = useState<NovelCastCharacter[]>([]);
  const [quickTravelWorlds, setQuickTravelWorlds] = useState<WorldPack[]>([]);
  const [quickTravelConfig, setQuickTravelConfig] = useState<ReturnType<typeof ensureQuickTravelArchive>['config'] | null>(null);
  const [coverImageUri, setCoverImageUri] = useState<string | undefined>();
  const [chatBackgroundUri, setChatBackgroundUri] = useState<string | undefined>();
  const [chatBackgroundOpacity, setChatBackgroundOpacity] = useState(
    DEFAULT_CHAT_BACKGROUND_OPACITY,
  );
  const [formError, setFormError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const allowLeaveRef = useRef(false);
  const leavePromptPending = useRef(false);

  const currentSnapshot = JSON.stringify({
    name, workIntro, playerName, playerPersona, playerMotive, playerProfile,
    worldName, worldEra, gameRules, characterCardAppearanceId, autoSuggestRoutes,
    cast, quickTravelWorlds, quickTravelConfig, coverImageUri, chatBackgroundUri,
    chatBackgroundOpacity,
  });
  const isDirty = hydrated && savedSnapshot !== null && currentSnapshot !== savedSnapshot;

  useEffect(() => {
    if (!novel || hydrated) {
      return;
    }

    const timer = setTimeout(() => {
      const quickArchive = ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled
        ? ensureQuickTravelArchive(novel)
        : null;
      setName(novel.name);
      setWorkIntro(mergeIntroForDisplay(novel.shortIntro, novel.detailedIntro));
      setPlayerName(novel.playerName);
      setPlayerPersona(novel.playerPersona);
      setPlayerMotive(novel.playerMotive);
      setPlayerProfile(normalizePlayerProfileFields(novel));
      setWorldName(novel.worldName);
      setWorldEra(novel.worldEra);
      setGameRules(novel.gameRules ?? '');
      setCharacterCardAppearanceId(novel.characterCardAppearanceId || DEFAULT_CHARACTER_CARD_APPEARANCE_ID);
      setAutoSuggestRoutes(Boolean(novel.autoSuggestRoutes));
      setCast(Array.isArray(novel.cast) ? novel.cast : []);
      if (ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled) {
        setQuickTravelWorlds(quickArchive?.worlds ?? []);
        setQuickTravelConfig(quickArchive?.config ?? null);
      }
      setCoverImageUri(novel.coverImageUri);
      setChatBackgroundUri(novel.chatBackgroundUri);
      setChatBackgroundOpacity(novel.chatBackgroundOpacity ?? DEFAULT_CHAT_BACKGROUND_OPACITY);
      setSavedSnapshot(JSON.stringify({
        name: novel.name,
        workIntro: mergeIntroForDisplay(novel.shortIntro, novel.detailedIntro),
        playerName: novel.playerName,
        playerPersona: novel.playerPersona,
        playerMotive: novel.playerMotive,
        playerProfile: normalizePlayerProfileFields(novel),
        worldName: novel.worldName,
        worldEra: novel.worldEra,
        gameRules: novel.gameRules ?? '',
        characterCardAppearanceId: novel.characterCardAppearanceId || DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
        autoSuggestRoutes: Boolean(novel.autoSuggestRoutes),
        cast: Array.isArray(novel.cast) ? novel.cast : [],
        quickTravelWorlds: quickArchive?.worlds ?? [],
        quickTravelConfig: quickArchive?.config ?? null,
        coverImageUri: novel.coverImageUri,
        chatBackgroundUri: novel.chatBackgroundUri,
        chatBackgroundOpacity: novel.chatBackgroundOpacity ?? DEFAULT_CHAT_BACKGROUND_OPACITY,
      }));
      setHydrated(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [hydrated, novel]);

  usePreventRemove(isDirty, ({ data }) => {
    if (allowLeaveRef.current) {
      allowLeaveRef.current = false;
      navigation.dispatch(data.action);
      return;
    }
    if (leavePromptPending.current) return;
    leavePromptPending.current = true;
    void confirmAppAction('放弃未保存修改？', '离开后当前编辑内容将丢失。', { confirmLabel: '放弃修改', cancelLabel: '继续编辑' }).then((confirmed) => {
      if (confirmed) navigation.dispatch(data.action);
    }).finally(() => {
      leavePromptPending.current = false;
    });
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || !isDirty || typeof window === 'undefined') return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty]);

  const chatBackgroundIsVideo = isNovelVideoUri(chatBackgroundUri);
  const activeQuickWorld =
    quickTravelWorlds.find((world) => world.id === novel?.quickTravel?.activeWorldId) ??
    novel?.quickTravel?.worlds.find((world) => world.id === novel.quickTravel?.activeWorldId) ??
    quickTravelWorlds[0];

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)/novels' as Href);
  }

  function handleSave() {
    if (!novelId || !novel) {
      return;
    }

    const trimmedName = name.trim();

    if (!trimmedName) {
      setFormError('请填写小说名称。');
      return;
    }

    if (!(ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled) && getProtagonistCast(cast).length === 0) {
      setFormError('请至少保留一名主角（在角色设定中打开「是否主角」）。');
      return;
    }

    const playerMirror = mirrorProtagonistToPlayerFields(cast);
    const { shortIntro, detailedIntro } = splitIntroForStorage(workIntro);

    updateNovel(novelId, {
      name: trimmedName,
      shortIntro,
      detailedIntro,
      systemPrompt: novel.systemPrompt,
      writingStyle: novel.writingStyle,
      shortTermMemoryPrompt: novel.shortTermMemoryPrompt,
      midTermMemoryPrompt: novel.midTermMemoryPrompt,
      longTermMemoryPrompt: novel.longTermMemoryPrompt,
      ...playerMirror,
      worldName,
      worldEra,
      worldConflict: novel.worldConflict,
      worldTone: novel.worldTone,
      mainPlot: novel.mainPlot,
      initialStoryState: novel.initialStoryState,
      gameRules,
      autoSuggestRoutes,
      relationGraphEnabled: novel.relationGraphEnabled,
      characterCardAppearanceId,
      cast,
      characterDossiers: syncDossiersWithCast(cast, novel.characterDossiers ?? []),
      quickTravel: ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled && quickTravelConfig
        ? {
            ...novel.quickTravel,
            config: quickTravelConfig,
            worlds: quickTravelWorlds.map((world) => {
              if (world.isMainWorld) {
                return {
                  ...world,
                  name: worldName.trim() || name.trim(),
                  worldEra: worldEra.trim(),
                  worldRules: world.worldRules,
                  protagonistIdentity: playerPersona.trim(),
                  cast,
                  characterDossiers: syncDossiersWithCast(cast, novel.characterDossiers ?? []),
                  updatedAt: new Date().toISOString(),
                };
              }
              return world.id === novel.quickTravel?.activeWorldId
                ? {
                    ...world,
                    cast,
                    characterDossiers: syncDossiersWithCast(cast, world.characterDossiers ?? []),
                    updatedAt: new Date().toISOString(),
                  }
                : world;
            }),
          }
        : novel.quickTravel,
      loreEntries: novel.loreEntries ?? [],
      relationGraphs: novel.relationGraphs,
      openingMessage: novel.openingMessage,
      coverImageUri,
      chatBackgroundUri,
      chatBackgroundOpacity,
      isDraft: false,
      createStep: 3,
    });

    setSavedSnapshot(currentSnapshot);
    allowLeaveRef.current = true;
    setFormError('');
    handleBack();
  }

  if (!novel) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="subtitle">小说不存在</ThemedText>
        <Pressable onPress={() => router.replace('/(tabs)/novels' as Href)}>
          <ThemedText type="linkPrimary">返回书架</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView decorated={Platform.OS === 'web'} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}>
          {Platform.OS !== 'web' ? <NovelMobileNavigation novelId={novel.id} title="作品设定" /> : null}
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.content, Platform.OS !== 'web' && mobileStyles.content]}>
            {Platform.OS === 'web' ? <View style={styles.header}>
              <Pressable onPress={handleBack} style={styles.backButton}>
                <ThemedText type="small" themeColor="accent">
                  返回
                </ThemedText>
              </Pressable>
              <ThemedText type="code" themeColor="accent">
                NOVEL STUDIO
              </ThemedText>
              <ThemedText type="title" style={styles.title}>
                编辑小说 / 世界
              </ThemedText>
              <ThemedText themeColor="textSecondary">
                修改基础设定与世界观后保存。不会清空聊天记录。
              </ThemedText>
            </View> : null}

            <FormSection title="基础设定">
              <NovelImagePickerField
                label="封面图"
                hint="可选。从手机相册选择一张图片作为列表封面。"
                kind="cover"
                uri={coverImageUri}
                onChangeUri={setCoverImageUri}
              />
              <SettingField
                label="小说名称"
                required
                value={name}
                placeholder="例如：雨夜旧城区"
                onChangeText={setName}
              />
              <SettingField
                label="作品介绍"
                value={workIntro}
                placeholder="题材、氛围、主线方向等。仅作展示与角色 AI 上下文，不会注入对话提示词。"
                multiline
                minHeight={160}
                onChangeText={setWorkIntro}
              />
              <ThemedText type="small" themeColor="textMuted" style={styles.fieldHelp}>
                提示词默认值在小说配置里管理；本小说沿用创建时保存的版本。
              </ThemedText>
              <Pressable
                onPress={() => {
                  if (!novelId) {
                    return;
                  }
                  void confirmAppAction('覆盖提示词', '将用「小说配置」中的当前默认覆盖本小说已保存的系统提示词与记忆提示词。', { confirmLabel: '覆盖' }).then((confirmed) => {
                    if (confirmed) {
                          updateNovel(novelId, {
                            systemPrompt: novelPromptDefaults.systemPrompt,
                            shortTermMemoryPrompt: novelPromptDefaults.shortTermMemoryPrompt,
                            midTermMemoryPrompt: novelPromptDefaults.midTermMemoryPrompt,
                            longTermMemoryPrompt: novelPromptDefaults.longTermMemoryPrompt,
                            writingStyle: '',
                          });
                      showAppAlert('已覆盖', '本小说提示词已与小说配置默认同步。');
                    }
                  });
                }}
                style={({ pressed }) => [
                  styles.syncPromptButton,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="code" themeColor="accent">
                  用小说配置默认覆盖本小说提示词
                </ThemedText>
              </Pressable>
            </FormSection>

            <FormSection title="角色设定">
              <ThemedText type="small" themeColor="textMuted">
                可勾选多名主角（如男女主）。主角人设始终带入叙事；配角在对话页知识库也可继续编辑。
              </ThemedText>
              <NovelCastEditor
                cast={activeQuickWorld?.cast ?? cast}
                novelName={name}
                intro={workIntro}
                appearanceId={characterCardAppearanceId}
                framework={{
                  playerName,
                  playerPersona,
                  playerMotive,
                  ...playerProfile,
                  worldName: activeQuickWorld?.name ?? worldName,
                  worldEra: activeQuickWorld?.worldEra ?? worldEra,
                  worldConflict: '',
                  worldTone: '',
                  mainPlot: '',
                  initialStoryState: '',
                  gameRules: activeQuickWorld?.worldRules ?? gameRules,
                }}
                worldContext={
                  ENABLE_QUICK_TRAVEL && activeQuickWorld ? buildQuickTravelCharacterContext(activeQuickWorld) : undefined
                }
                onChange={setCast}
              />
            </FormSection>

            <FormSection title={ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled ? '主世界设定' : '世界设定'}>
              <SettingField
                  label={ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled ? '主世界名称' : '世界名称'}
                value={worldName}
                placeholder="故事开展的世界 / 国家名"
                onChangeText={setWorldName}
              />
              <SettingField
                  label={ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled ? '主世界设定' : '世界设定'}
                value={worldEra}
                placeholder="例：中世纪奇幻，科技低下，魔法昌盛；力量体系与社会规则……"
                multiline
                minHeight={140}
                onChangeText={setWorldEra}
              />
              {!(ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled) ? <SettingField
                label="游玩规则"
                value={gameRules}
                placeholder="AI扮演角色时需要遵守的法则"
                multiline
                minHeight={120}
                onChangeText={setGameRules}
              /> : null}
              <View style={styles.switchRow}>
                <View style={styles.switchCopy}>
                  <ThemedText type="smallBold">行动预测</ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    开启后每轮给出行动预测（ABCD），气泡内可点选。
                  </ThemedText>
                </View>
                <Switch
                  value={autoSuggestRoutes}
                  onValueChange={setAutoSuggestRoutes}
                  trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }}
                  thumbColor={autoSuggestRoutes ? theme.accent : theme.textMuted}
                />
              </View>
            </FormSection>

            {ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled && quickTravelWorlds.length > 0 ? (
              <FormSection title="快穿系统设定">
                <SettingField
                  label="系统名称"
                  value={quickTravelConfig?.systemName ?? ''}
                  placeholder="例如：主神空间、快穿管理局"
                  onChangeText={(value) =>
                    setQuickTravelConfig((config) =>
                      config ? { ...config, systemName: value } : config,
                    )
                  }
                />
                <SettingField
                  label="全局规则"
                  value={quickTravelConfig?.globalRules ?? ''}
                  placeholder="所有小世界都必须遵守的规则"
                  multiline
                  minHeight={120}
                  onChangeText={(value) =>
                    setQuickTravelConfig((config) =>
                      config ? { ...config, globalRules: value } : config,
                    )
                  }
                />
              </FormSection>
            ) : null}

            {ENABLE_QUICK_TRAVEL && novel.quickTravel?.config.enabled && quickTravelWorlds.length > 0 ? (
              <FormSection title="快穿世界设定">
                <QuickTravelWorldDraftEditor
                  worlds={quickTravelWorlds.filter((world) => !world.isMainWorld)}
                  generatingWorldId={null}
                  onAdd={() => {
                    const base = quickTravelWorlds.find((world) => !world.isMainWorld) ?? quickTravelWorlds[0];
                    const now = new Date().toISOString();
                    setQuickTravelWorlds((worlds) => [...worlds, {
                      ...base,
                      id: `world-${Date.now()}`,
                      name: '',
                      mission: '',
                      entryScene: '',
                      originalPlot: { premise: '', knownToProtagonist: '', beats: [], originalEnding: '' },
                      runtime: { ...base.runtime, mission: '' },
                      cast: [],
                      createdAt: now,
                      updatedAt: now,
                    }]);
                  }}
                  onDelete={(id) => setQuickTravelWorlds((worlds) => worlds.filter((world) => world.id !== id || world.isMainWorld))}
                  onChange={(id, updates) => setQuickTravelWorlds((worlds) => worlds.map((world) => world.id === id ? { ...world, ...updates, updatedAt: new Date().toISOString() } : world))}
                />
              </FormSection>
            ) : null}

            <FormSection title="初始与配置">
              <NovelImagePickerField
                label="对话背景图"
                hint="可选。安卓选择后可按 9:16 裁剪，避免进入对话后画面被遮掉；可调节不透明度。"
                kind="background"
                uri={chatBackgroundIsVideo ? undefined : chatBackgroundUri}
                onChangeUri={setChatBackgroundUri}
                opacity={chatBackgroundOpacity}
                onChangeOpacity={setChatBackgroundOpacity}
              />
              <NovelVideoPickerField
                uri={chatBackgroundIsVideo ? chatBackgroundUri : undefined}
                onChangeUri={setChatBackgroundUri}
              />

            </FormSection>

            {formError ? (
              <ThemedText type="small" themeColor="accent">
                {formError}
              </ThemedText>
            ) : null}
          </ScrollView>

          <View
            style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
            <Pressable
              onPress={handleSave}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" style={styles.saveButtonText}>
                保存修改
              </ThemedText>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

    </ThemedView>
  );
}

export default function EditNovelScreen() {
  const desktop = useDesktopLayout();
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const advanced = params.advanced === '1';
  if (desktop && !advanced) {
    return <DesktopNovelSettings key={novelId} novelId={novelId} />;
  }
  return <LegacyEditNovelScreen />;
}

type FormSectionProps = {
  title: string;
  children: ReactNode;
};

function FormSection({ title, children }: FormSectionProps) {
  const theme = useTheme();

  return (
    <ThemedView type="surface" style={[styles.section, { borderColor: theme.border }, Platform.OS !== 'web' && { borderWidth: 0, borderRadius: 0, padding: 0, paddingBottom: 16, backgroundColor: 'transparent', gap: 20 }]}>
      <ThemedText style={[styles.sectionTitle, { color: theme.accent }]}>{title}</ThemedText>
      {children}
    </ThemedView>
  );
}

type SettingFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  required?: boolean;
  multiline?: boolean;
  minHeight?: number;
  onChangeText: (value: string) => void;
};

function SettingField({
  label,
  value,
  placeholder,
  required,
  multiline,
  minHeight,
  onChangeText,
}: SettingFieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {required ? <ThemedText style={styles.requiredMark}>*</ThemedText> : null}
      </View>
      <TextInput
        value={value}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        onChangeText={onChangeText}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          multiline && minHeight ? { minHeight } : null,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
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
    fontSize: 28,
    lineHeight: 36,
  },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  field: {
    gap: Spacing.two,
  },
  fieldHelp: {
    marginTop: -Spacing.one,
    lineHeight: 18,
  },
  syncPromptButton: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 40,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  requiredMark: {
    color: '#c45c3a',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 96,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#120c09',
  },
  pressed: {
    opacity: 0.75,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  switchCopy: {
    flex: 1,
    gap: 4,
  },
});
