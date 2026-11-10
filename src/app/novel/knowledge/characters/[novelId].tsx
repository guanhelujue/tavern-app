import { Stack, useLocalSearchParams, router, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { ENABLE_QUICK_TRAVEL } from '@/config/build-features';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  GestureHandlerRootView,
  RectButton,
  ScrollView,
  Swipeable,
} from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CharacterCardAppearancePicker } from '@/components/CharacterCardAppearancePicker';
import { CharacterOperationsModal } from '@/components/character-operations/CharacterOperationsModal';
import { NovelCastCharacterModal } from '@/components/novel-create/NovelCastCharacterModal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  CHARACTER_CARD_APPEARANCES,
  DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
  getCharacterCardAppearance,
  normalizeCharacterCardAppearanceId,
} from '@/constants/character-card-appearances';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  mergeCastCharacters,
  normalizeCharacterWorkspace,
} from '@/features/character-operations/model';
import { useTheme } from '@/hooks/use-theme';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { createEmptyCastCharacter } from '@/services/novel-create-ai';
import { formatKnowledgeSyncReport } from '@/services/novel-knowledge-sync';
import { createEmptyStoryAnalysis } from '@/constants/novel-story-state';
import { useTavernStore } from '@/store/tavern-store';
import { mergeIntroForDisplay } from '@/utils/novel-intro';
import type { NovelCastCharacter, NovelCharacterDossier } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { resolveCharacterCardUiTheme } from '@/utils/character-card-ui-theme';
import { castFromDossier, ensureNovelDossiers } from '@/utils/novel-dossiers';
import { normalizePlayerProfileFields } from '@/utils/novel-player';
import { readNovelBlueprint } from '@/features/novel-creation/legacy-novel-adapter';
import { resolvePortraitDisplayUri } from '@/utils/character-card-portraits';
import {
  detectPortraitFocus,
  getPortraitContentPosition,
  type PortraitFocus,
} from '@/utils/portrait-focus';
import {
  buildQuickTravelCharacterContext,
  getActiveQuickTravelWorld,
} from '@/utils/quick-travel';

const DELETE_ACTION_BG = '#b54a3c';
const DELETE_ACTION_WIDTH = 88;
// Android's native image view applies `contentPosition` correctly, but its
// cover crop is visually looser than the browser's crop for these very wide
// ghost cards. A fixed transform keeps the detected eyes centered while
// making the portrait read as a face detail instead of a torso silhouette.
const ANDROID_PORTRAIT_GHOST_ZOOM = 1.55;

type PortraitRenderMetrics = {
  sourceWidth: number;
  sourceHeight: number;
  containerWidth: number;
  containerHeight: number;
};

function formatCharacterMeta(parts: (string | undefined)[]) {
  const cleaned = parts.map((part) => part?.trim() ?? '').filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(' · ') : '暂无摘要';
}

function resolveCastHeight(
  dossier: NovelCharacterDossier,
  castList: NovelCastCharacter[],
): string | undefined {
  const linked =
    (dossier.castId ? castList.find((item) => item.id === dossier.castId) : undefined) ??
    castList.find(
      (item) => item.name.trim().toLowerCase() === dossier.name.trim().toLowerCase(),
    );
  const height = linked?.height?.trim() || castFromDossier(dossier).height.trim();
  return height || undefined;
}

export default function NovelCharacterKnowledgeScreen() {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const novels = useTavernStore((state) => state.novels);
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const updateNovelCastCharacters = useTavernStore((state) => state.updateNovelCastCharacters);
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const syncNovelKnowledgeBase = useTavernStore((state) => state.syncNovelKnowledgeBase);
  const enrichNovelCharacters = useTavernStore((state) => state.enrichNovelCharacters);
  const generateNovelSupportingCharacters = useTavernStore((state) => state.generateNovelSupportingCharacters);
  const updateNovelCharacterDossiers = useTavernStore(
    (state) => state.updateNovelCharacterDossiers,
  );
  const updateNovelCharacterCardAppearanceId = useTavernStore(
    (state) => state.updateNovelCharacterCardAppearanceId,
  );
  const inferNovelCharacterRelations = useTavernStore(
    (state) => state.inferNovelCharacterRelations,
  );
  const deleteNovelKnowledgeCharacter = useTavernStore(
    (state) => state.deleteNovelKnowledgeCharacter,
  );
  const novel = novels.find((item) => item.id === novelId);
  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  const dossiers = useMemo(
    () => (novel ? ensureNovelDossiers(novel) : []),
    [novel],
  );
  const activeQuickWorld = novel ? getActiveQuickTravelWorld(novel) : undefined;
  const cast = useMemo(
    () => activeQuickWorld?.cast ?? novel?.cast ?? [],
    [activeQuickWorld, novel?.cast],
  );
  const analyzedCharacters = novel?.novelStoryAnalysis?.characters ?? [];
  const missingCharacterCount = new Set(
    analyzedCharacters
      .filter((character) => character.name.trim() && !cast.some(
        (item) => item.name.trim().toLowerCase() === character.name.trim().toLowerCase(),
      ))
      .map((character) => character.name.trim().toLowerCase()),
  ).size;
  const runningJob = novel?.novelGenerationJobs?.find((job) => job.status === 'running');
  const legacyProtagonistIdea = useMemo(() => {
    if (!novel || cast.some((item) => item.isProtagonist === true)) {
      return null;
    }
    const protagonist = readNovelBlueprint(novel).protagonist;
    const identity = protagonist.identity.trim();
    const desire = protagonist.desire.trim();
    return identity || desire ? { identity, desire } : null;
  }, [cast, novel]);
  const appearanceId = normalizeCharacterCardAppearanceId(
    novel?.characterCardAppearanceId ?? DEFAULT_CHARACTER_CARD_APPEARANCE_ID,
  );
  const activeAppearance = useMemo(
    () => getCharacterCardAppearance(appearanceId),
    [appearanceId],
  );
  const chrome = useMemo(
    () => resolveCharacterCardUiTheme(appearanceId),
    [appearanceId],
  );

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAppearancePickerOpen, setIsAppearancePickerOpen] = useState(false);
  const [isOperationsOpen, setIsOperationsOpen] = useState(false);
  const [isInferringRelations, setIsInferringRelations] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [visibleCharacterCount, setVisibleCharacterCount] = useState(30);
  const [editingDossier, setEditingDossier] = useState<NovelCharacterDossier | null>(null);
  const [editingCast, setEditingCast] = useState<NovelCastCharacter | null>(null);
  const [portraitRenderMetrics, setPortraitRenderMetrics] = useState<
    Record<string, PortraitRenderMetrics>
  >({});
  // Portraits selected before automatic focus detection was added do not have
  // metadata yet. Keep a screen-local result immediately, then persist it for
  // regular novels so reopening the knowledge base does not run detection again.
  const [autoPortraitFocus, setAutoPortraitFocus] = useState<Record<string, PortraitFocus>>({});
  const [archiveReveal] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));
  const attemptedPortraitDetection = useRef(new Set<string>());

  useEffect(() => {
    archiveReveal.stopAnimation();
    if (!motionEnabled) {
      archiveReveal.setValue(1);
      return;
    }
    archiveReveal.setValue(0);
    Animated.spring(archiveReveal, {
      toValue: 1,
      damping: 19,
      stiffness: 190,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [archiveReveal, motionEnabled]);

  useEffect(() => {
    if (!novelId) {
      return;
    }

    let cancelled = false;

    for (const character of cast) {
      const storedUri = character.portraitUri?.trim();
      // A focus saved by Android's ML Kit is valid, but let the browser run
      // its own OpenCV/YuNet pass once so web-created and migrated cards do
      // not keep an old native/fallback anchor forever.
      const needsDetection =
        !character.portraitFocus ||
        (Platform.OS === 'web' && character.portraitFocus.detector !== 'opencv');
      if (!storedUri || !needsDetection) {
        continue;
      }

      const displayUri = resolvePortraitDisplayUri(storedUri, character.gender);
      if (!displayUri) {
        continue;
      }

      const detectionKey = `${novelId}:${character.id}:${storedUri}`;
      if (attemptedPortraitDetection.current.has(detectionKey)) {
        continue;
      }
      attemptedPortraitDetection.current.add(detectionKey);

      void detectPortraitFocus(displayUri, character.gender).then((focus) => {
        if (cancelled || !focus) {
          return;
        }

        setAutoPortraitFocus((current) => ({ ...current, [detectionKey]: focus }));

        // The active quick-travel world has its own cast list; keep this
        // migration local there rather than replacing that world's roster.
        const latestNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
        if (!latestNovel || latestNovel.quickTravel?.config.enabled) {
          return;
        }

        const latestCharacter = latestNovel.cast.find(
          (item) => item.id === character.id && item.portraitUri?.trim() === storedUri,
        );
        const alreadySavedByCurrentDetector =
          Platform.OS === 'web'
            ? latestCharacter?.portraitFocus?.detector === 'opencv'
            : Boolean(latestCharacter?.portraitFocus);
        if (!latestCharacter || alreadySavedByCurrentDetector) {
          return;
        }

        updateNovelCastCharacters(
          novelId,
          latestNovel.cast.map((item) =>
            item.id === character.id ? { ...item, portraitFocus: focus } : item,
          ),
        );
      });
    }

    return () => {
      cancelled = true;
    };
  }, [cast, novelId, updateNovelCastCharacters]);

  const framework = useMemo(
    () => ({
      playerName: novel?.playerName ?? '',
      playerPersona: novel?.playerPersona ?? '',
      playerMotive: novel?.playerMotive ?? '',
      ...normalizePlayerProfileFields(novel),
      worldName: novel?.worldName ?? '',
      worldEra: novel?.worldEra ?? '',
      worldConflict: '',
      worldTone: '',
      mainPlot: '',
      initialStoryState: '',
      gameRules: novel?.gameRules ?? '',
    }),
    [novel],
  );

  function closeSwipeable(dossierId: string) {
    swipeableRefs.current[dossierId]?.close();
  }

  function clearSwipeableRef(dossierId: string) {
    closeSwipeable(dossierId);
    delete swipeableRefs.current[dossierId];
  }

  function closeOtherSwipeables(exceptId: string) {
    for (const [id, ref] of Object.entries(swipeableRefs.current)) {
      if (id !== exceptId) {
        ref?.close();
      }
    }
  }

  function openCreate() {
    if (!novel) {
      return;
    }

    setEditingDossier(null);
    setEditingCast(createEmptyCastCharacter());
    setIsModalOpen(true);
  }

  function openLegacyProtagonistIdea() {
    if (!legacyProtagonistIdea) {
      return;
    }
    setEditingDossier(null);
    setEditingCast({
      ...createEmptyCastCharacter(),
      profession: legacyProtagonistIdea.identity,
      motive: legacyProtagonistIdea.desire,
      isProtagonist: true,
    });
    setIsModalOpen(true);
  }

  function openCandidate(candidate: NovelCastCharacter) {
    setIsOperationsOpen(false);
    setEditingDossier(null);
    setEditingCast(candidate);
    setIsModalOpen(true);
  }

  function openEdit(dossier: NovelCharacterDossier) {
    if (!novel) {
      return;
    }

    closeSwipeable(dossier.id);

    const linked =
      (dossier.castId
        ? cast.find((item) => item.id === dossier.castId)
        : undefined) ??
      cast.find((item) => item.name.trim().toLowerCase() === dossier.name.trim().toLowerCase());

    setEditingDossier(dossier);
    setEditingCast(castFromDossier(dossier, undefined, linked));
    setIsModalOpen(true);
  }

  async function handleInferRelations() {
    if (!novelId || !novel || isInferringRelations) {
      return;
    }

    const confirmed = await confirmAppAction(
      '一键整理人物关系',
      '将读取角色库中的全部角色卡和已有关系，统一互相绑定的关系，并补全宿舍、班级、团队等多人关系。已有手动关系会作为优先依据保留。',
      { confirmLabel: '开始整理' },
    );
    if (!confirmed) {
      return;
    }

    setIsInferringRelations(true);
    try {
      const report = await inferNovelCharacterRelations(novelId);
      showAppAlert(
        '关系整理完成',
        `已读取 ${report.castCount} 名角色，整理 ${report.totalPairCount} 对关系；新增 ${report.addedPairCount} 对，统一 ${report.updatedPairCount} 对。`,
      );
    } catch (error) {
      showAppAlert(
        '关系整理失败',
        error instanceof Error ? error.message : '请稍后重试。',
      );
    } finally {
      setIsInferringRelations(false);
    }
  }

  function handleImportAnalysisCharacters() {
    if (!novelId || runningJob || isEnriching) return;
    const report = syncNovelKnowledgeBase(novelId, { refreshGenerated: false });
    showAppAlert('已有分析已补入', formatKnowledgeSyncReport(report));
  }

  async function handleEnrichCharacters() {
    if (!novelId || runningJob || isEnriching) return;
    setIsEnriching(true);
    try {
      const result = await enrichNovelCharacters(novelId);
      showAppAlert('正文资料整理完成', `已整理 ${result.enriched} 位人物的正文资料。自动提取的卡片已补全，手动保存的卡片保持不变。`);
    } catch (error) {
      showAppAlert('正文补全失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setIsEnriching(false);
    }
  }

  function handleSaveCharacter(character: NovelCastCharacter, experience: string) {
    if (!novelId || !novel) {
      return;
    }

    const exists = cast.some((item) => item.id === character.id);
    const nextCast = exists
      ? cast.map((item) => (item.id === character.id ? character : item))
      : [...cast, character];

    updateNovelCastCharacters(novelId, nextCast, { pivotId: character.id });

    // Preserve aliases / experienceDraft; only update experience + enabled from this modal.
    const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
    if (latest) {
      const nextDossiers = ensureNovelDossiers(latest).map((item) => {
        const matched =
          item.castId === character.id ||
          item.name.trim().toLowerCase() === character.name.trim().toLowerCase();

        if (!matched) {
          return item;
        }

        return {
          ...item,
          experience,
          enabled: editingDossier?.enabled !== false,
          updatedAt: new Date().toISOString(),
        };
      });
      updateNovelCharacterDossiers(novelId, nextDossiers);
    }

    setIsModalOpen(false);
    setEditingDossier(null);
    setEditingCast(null);
  }

  function handleToggle(dossier: NovelCharacterDossier, enabled: boolean) {
    if (!novelId) {
      return;
    }

    updateNovelCharacterDossiers(
      novelId,
      dossiers.map((item) =>
        item.id === dossier.id ? { ...item, enabled, updatedAt: new Date().toISOString() } : item,
      ),
    );
  }

  function performDelete(dossier: NovelCharacterDossier) {
    if (!novelId) {
      return;
    }

    clearSwipeableRef(dossier.id);
    const ok = deleteNovelKnowledgeCharacter(novelId, dossier.id);
    if (!ok) {
      showAppAlert('删除失败', '未找到该角色，可能已被删除。');
    }
  }

  async function confirmDelete(dossier: NovelCharacterDossier) {
    if (!novelId || !novel) {
      return;
    }

    const label = dossier.name || '未命名';
    const confirmed = await confirmAppAction(
      '删除角色',
      `确定删除「${label}」吗？设定，以及其他角色中指向该人的关系会一并清除。`,
      { confirmLabel: '删除' },
    );

    if (!confirmed) {
      closeSwipeable(dossier.id);
      return;
    }

    performDelete(dossier);
  }

  function renderDeleteAction(dossier: NovelCharacterDossier, displayName: string) {
    return (
      <RectButton
        onPress={() => {
          void confirmDelete(dossier);
        }}
        style={styles.deleteAction}
        accessibilityRole="button"
        accessibilityLabel={`删除 ${displayName}`}>
        <ThemedText type="smallBold" style={styles.deleteActionText}>
          删除
        </ThemedText>
      </RectButton>
    );
  }

  if (!novelId || !novel) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: '角色知识库', headerShown: true }} />
        <ThemedText themeColor="textSecondary">未找到小说。</ThemedText>
        <Pressable onPress={() => router.replace('/(tabs)/novels' as Href)}>
          <ThemedText type="linkPrimary">返回书架</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemedView decorated style={styles.container}>
        <Stack.Screen
          options={{
            title: '角色知识库',
            headerShown: true,
            headerBackTitle: '知识库',
            headerStyle: { backgroundColor: theme.background },
            headerTintColor: theme.accent,
            headerTitleStyle: { color: theme.text, fontWeight: '700' },
          }}
        />

        <SafeAreaView style={[styles.safeArea, desktop && styles.safeAreaDesktop]} edges={['left', 'right', 'bottom']}>
          <ScrollView contentContainerStyle={[styles.content, desktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
            <Animated.View
              style={[
                styles.archiveHeroShell,
                { backgroundColor: chrome.inputBackground, borderColor: chrome.border },
                {
                  opacity: archiveReveal,
                  transform: [
                    { translateX: archiveReveal.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) },
                    { rotate: archiveReveal.interpolate({ inputRange: [0, 1], outputRange: ['-0.8deg', '0deg'] }) },
                  ],
                },
              ]}>
              <View
                style={[
                  styles.archiveHero,
                  { backgroundColor: chrome.background, borderColor: chrome.headerBorder },
                ]}>
                <Text
                  pointerEvents="none"
                  style={[styles.archiveHeroNumber, { color: chrome.accent }]}>
                  {String(dossiers.length).padStart(2, '0')}
                </Text>
                <View
                  pointerEvents="none"
                  style={[styles.archiveHeroOrbit, { borderColor: chrome.accent }]}
                />
                <View style={styles.archiveHeroHeading}>
                  <View style={[styles.archiveHeroSignal, { backgroundColor: chrome.accent }]} />
                  <Text style={[styles.archiveHeroEyebrow, { color: chrome.accent }]}> 
                    PERSONA ARCHIVE / {activeAppearance.name}
                  </Text>
                </View>
                <Text style={[styles.archiveHeroTitle, { color: chrome.text }]}>人物档案室</Text>
                <Text style={[styles.archiveHeroCopy, { color: chrome.textMuted }]}> 
                  《{novel.name}》现收录 {cast.length} 位角色。主角持续参与叙事，配角在姓名被提及时唤醒；卡片可左右滑动管理。
                </Text>
                <View style={styles.archiveHeroStats}>
                  <View>
                    <Text style={[styles.archiveHeroStatValue, { color: chrome.text }]}>{dossiers.length}</Text>
                    <Text style={[styles.archiveHeroStatLabel, { color: chrome.textMuted }]}>已建档</Text>
                  </View>
                  <View style={[styles.archiveHeroStatRule, { backgroundColor: chrome.headerBorder }]} />
                  <View>
                    <Text style={[styles.archiveHeroStatValue, { color: chrome.text }]}>
                      {cast.filter((item) => item.isProtagonist === true).length}
                    </Text>
                    <Text style={[styles.archiveHeroStatLabel, { color: chrome.textMuted }]}>主角</Text>
                  </View>
                  <Pressable
                    onPress={() => setIsAppearancePickerOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`切换人设卡面，当前 ${activeAppearance.name}`}
                    style={({ pressed }) => [
                      styles.appearanceQuickAction,
                      { borderColor: chrome.border },
                      pressed && styles.pressed,
                    ]}>
                    <Text style={[styles.appearanceQuickLabel, { color: chrome.textMuted }]}>卡面</Text>
                    <Text style={[styles.appearanceQuickValue, { color: chrome.accent }]} numberOfLines={1}>
                      {activeAppearance.name} ↗
                    </Text>
                  </Pressable>
                </View>

              <View style={styles.actionRow}>
              <Pressable
                onPress={openCreate}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionButtonPrimary,
                  { backgroundColor: theme.accent },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="添加角色">
                <View style={styles.primaryActionContent}>
                  <ThemedText type="smallBold" style={styles.addButtonText}>
                    新建角色
                  </ThemedText>
                  <View style={styles.primaryActionArrow}>
                    <Text style={styles.primaryActionArrowText}>↗</Text>
                  </View>
                </View>
              </Pressable>
              <Pressable
                onPress={() => setIsOperationsOpen(true)}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionButtonWorkspace,
                  { borderColor: chrome.accent, backgroundColor: chrome.background },
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="打开人物运营中心">
                <View style={styles.workspaceActionCopy}>
                  <ThemedText type="smallBold" style={{ color: chrome.accent }}>人物运营</ThemedText>
                  <ThemedText type="code" style={{ color: chrome.textMuted }}>检索、关系、剧情态、候选与人物弧</ThemedText>
                </View>
                <Text style={[styles.workspaceActionArrow, { color: chrome.accent }]}>→</Text>
              </Pressable>
              </View>
            </View>
          </Animated.View>

            {!novel.quickTravel?.config.enabled && analyzedCharacters.length > 0 ? (
              <View style={[styles.legacyIdeaCard, { backgroundColor: chrome.inputBackground, borderColor: chrome.border }]}>
                <View style={styles.legacyIdeaCopy}>
                  <Text style={[styles.legacyIdeaTitle, { color: chrome.text }]}>从正文完善人物</Text>
                  <Text style={[styles.legacyIdeaText, { color: chrome.textMuted }]}>
                    检索定稿正文，补全自动提取的人物卡。手动保存的卡片由你维护，重新分析不会覆盖。
                    {missingCharacterCount > 0 ? ` 还有 ${missingCharacterCount} 位已分析人物未建卡，可直接补入。` : ''}
                  </Text>
                  {runningJob || isEnriching ? (
                    <Text accessibilityLiveRegion="polite" style={[styles.legacyIdeaText, { color: chrome.accent }]}>
                      {runningJob?.kind === 'enrich' || isEnriching ? '正在从正文补全人物…' : '当前写作任务完成后可补全人物。'}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.actionRow}>
                  {missingCharacterCount > 0 ? (
                    <Pressable
                      onPress={handleImportAnalysisCharacters}
                      disabled={Boolean(runningJob) || isEnriching}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.legacyIdeaButton, { borderColor: chrome.accent, opacity: runningJob || isEnriching ? 0.5 : 1 }, pressed && styles.pressed]}>
                      <Text style={[styles.legacyIdeaButtonText, { color: chrome.accent }]}>补入已有分析人物</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => void handleEnrichCharacters()}
                    disabled={Boolean(runningJob) || isEnriching}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.legacyIdeaButton, { borderColor: chrome.accent, opacity: runningJob || isEnriching ? 0.5 : 1 }, pressed && styles.pressed]}>
                    <Text style={[styles.legacyIdeaButtonText, { color: chrome.accent }]}>从正文补全</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {legacyProtagonistIdea ? (
              <View
                style={[
                  styles.legacyIdeaCard,
                  { backgroundColor: chrome.inputBackground, borderColor: chrome.border },
                ]}>
                <View style={styles.legacyIdeaCopy}>
                  <Text style={[styles.legacyIdeaEyebrow, { color: chrome.accent }]}>已有主角构思</Text>
                  <Text style={[styles.legacyIdeaTitle, { color: chrome.text }]}>旧创作蓝图中保留了一份主角设定</Text>
                  <Text style={[styles.legacyIdeaText, { color: chrome.textMuted }]}>
                    {[legacyProtagonistIdea.identity, legacyProtagonistIdea.desire]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Pressable
                  onPress={openLegacyProtagonistIdea}
                  style={({ pressed }) => [
                    styles.legacyIdeaButton,
                    { borderColor: chrome.accent, backgroundColor: chrome.background },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="用这份构思创建主角">
                  <Text style={[styles.legacyIdeaButtonText, { color: chrome.accent }]}>用这份构思创建主角</Text>
                </Pressable>
              </View>
            ) : null}

            {dossiers.length === 0 ? (
              <ThemedText type="small" themeColor="textMuted">
                还没有角色。点上方「新建」；可勾选「是否主角」，支持男女双主角。
              </ThemedText>
            ) : (
              <View style={desktop ? styles.cardGrid : undefined}>
              {dossiers.slice(0, visibleCharacterCount).map((dossier, dossierIndex) => {
                const linkedCast =
                  (dossier.castId
                    ? cast.find((item) => item.id === dossier.castId)
                    : undefined) ??
                  cast.find(
                    (item) =>
                      item.name.trim().toLowerCase() === dossier.name.trim().toLowerCase(),
                  );
                const dossierCast = castFromDossier(dossier);
                const summaryCast = linkedCast ?? dossierCast;
                const displayName = summaryCast.name || dossier.name || '未命名';
                const metaLine = formatCharacterMeta([
                  summaryCast.profession,
                  summaryCast.gender,
                  summaryCast.age,
                  resolveCastHeight(dossier, cast),
                ]);
                const enabled = dossier.enabled !== false;
                const isProtagonist = linkedCast?.isProtagonist === true;
                const portraitUri = linkedCast?.portraitUri?.trim()
                  ? resolvePortraitDisplayUri(linkedCast.portraitUri, linkedCast.gender || summaryCast.gender)
                  : '';
                const portraitKey = linkedCast?.id ?? dossier.id;
                const portraitDetectionKey = linkedCast?.portraitUri?.trim()
                  ? `${novelId}:${portraitKey}:${linkedCast.portraitUri.trim()}`
                  : '';
                const detectedPortraitFocus = autoPortraitFocus[portraitDetectionKey];
                const portraitMetrics = portraitRenderMetrics[portraitKey];
                const portraitContentPosition = getPortraitContentPosition(
                  // In a browser, prefer the fresh OpenCV result over an old
                  // native/fallback anchor. This also covers quick-travel
                  // rosters whose cast list is intentionally not persisted.
                  Platform.OS === 'web'
                    ? detectedPortraitFocus ?? linkedCast?.portraitFocus
                    : linkedCast?.portraitFocus ?? detectedPortraitFocus,
                  portraitMetrics
                    ? {
                        width: portraitMetrics.sourceWidth,
                        height: portraitMetrics.sourceHeight,
                      }
                    : undefined,
                  portraitMetrics
                    ? {
                        width: portraitMetrics.containerWidth,
                        height: portraitMetrics.containerHeight,
                      }
                    : undefined,
                );

                return (
                  <Swipeable
                    key={dossier.id}
                    containerStyle={desktop ? styles.cardGridItem : undefined}
                    ref={(ref) => {
                      swipeableRefs.current[dossier.id] = ref;
                    }}
                    friction={2}
                    leftThreshold={40}
                    rightThreshold={40}
                    overshootLeft={false}
                    overshootRight={false}
                    overshootFriction={8}
                    dragOffsetFromLeftEdge={16}
                    dragOffsetFromRightEdge={16}
                    failOffsetY={[-12, 12]}
                    enableTrackpadTwoFingerGesture
                    onSwipeableOpenStartDrag={() => {
                      closeOtherSwipeables(dossier.id);
                    }}
                    renderLeftActions={() => renderDeleteAction(dossier, displayName)}
                    renderRightActions={() => renderDeleteAction(dossier, displayName)}>
                    <View
                      style={[
                        styles.card,
                        {
                          backgroundColor: chrome.background,
                          borderColor: chrome.border,
                          borderRadius: Math.max(chrome.panelRadius, 14),
                        },
                      ]}>
                      <View
                        pointerEvents="none"
                        style={[styles.cardInnerBezel, { borderColor: chrome.headerBorder }]}
                      />
                      <Text
                        pointerEvents="none"
                        style={[styles.cardSerial, { color: chrome.accent }]}>
                        {String(dossierIndex + 1).padStart(2, '0')}
                      </Text>
                      <View pointerEvents="none" style={styles.cardTelemetry}>
                        <View style={[styles.cardTelemetryDot, { backgroundColor: chrome.accent }]} />
                        <Text style={[styles.cardTelemetryText, { color: chrome.textMuted }]}> 
                          PERSONA / {enabled ? 'ACTIVE' : 'DORMANT'}
                        </Text>
                      </View>
                      {portraitUri ? (
                        <View
                          pointerEvents="none"
                          style={styles.cardPortraitGhost}
                          onLayout={({ nativeEvent: { layout } }) => {
                            if (layout.width <= 0 || layout.height <= 0) return;
                            setPortraitRenderMetrics((current) => {
                              const previous = current[portraitKey];
                              if (
                                previous?.containerWidth === layout.width &&
                                previous?.containerHeight === layout.height
                              ) {
                                return current;
                              }
                              return {
                                ...current,
                                [portraitKey]: {
                                  sourceWidth: previous?.sourceWidth ?? 0,
                                  sourceHeight: previous?.sourceHeight ?? 0,
                                  containerWidth: layout.width,
                                  containerHeight: layout.height,
                                },
                              };
                            });
                          }}>
                          <Image
                            source={portraitUri}
                            style={[
                              styles.cardPortraitGhostImage,
                              Platform.OS === 'android' && styles.cardPortraitGhostImageAndroid,
                            ]}
                            contentFit="cover"
                            contentPosition={portraitContentPosition}
                            onLoad={({ source }) => {
                              if (source.width <= 0 || source.height <= 0) return;
                              setPortraitRenderMetrics((current) => {
                                const previous = current[portraitKey];
                                if (
                                  previous?.sourceWidth === source.width &&
                                  previous?.sourceHeight === source.height
                                ) {
                                  return current;
                                }
                                return {
                                  ...current,
                                  [portraitKey]: {
                                    sourceWidth: source.width,
                                    sourceHeight: source.height,
                                    containerWidth: previous?.containerWidth ?? 0,
                                    containerHeight: previous?.containerHeight ?? 0,
                                  },
                                };
                              });
                            }}
                            cachePolicy="memory-disk"
                            accessibilityLabel=""
                          />
                        </View>
                      ) : null}
                      <View
                        style={[styles.accentBar, { backgroundColor: chrome.accent }]}
                        pointerEvents="none"
                      />

                      <View style={styles.cardRow}>
                        <Pressable
                          onPress={() => openEdit(dossier)}
                          onLongPress={() => {
                            void confirmDelete(dossier);
                          }}
                          delayLongPress={450}
                          style={({ pressed }) => [
                            styles.cardHit,
                            pressed && styles.pressed,
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel={`编辑角色 ${displayName}`}>
                          <View style={styles.cardCopy}>
                            <View style={styles.cardNameRow}>
                              <Text
                                style={[styles.cardName, { color: chrome.text }]}
                                numberOfLines={1}>
                                {displayName}
                              </Text>
                              {isProtagonist ? (
                                <View
                                  style={[
                                    styles.protagonistChip,
                                    {
                                      borderColor: chrome.accent,
                                      backgroundColor: chrome.stampBackground,
                                    },
                                  ]}>
                                  <Text
                                    style={[styles.protagonistChipText, { color: chrome.accent }]}>
                                    主角
                                  </Text>
                                </View>
                              ) : null}
                              {linkedCast?.generatedFromReply && linkedCast?.sourceChapter ? (
                                <View
                                  style={[
                                    styles.chapterChip,
                                    {
                                      borderColor: chrome.border,
                                      backgroundColor: chrome.stampBackground,
                                    },
                                  ]}>
                                  <Text
                                    style={[styles.chapterChipText, { color: chrome.textMuted }]}> 
                                    {linkedCast.sourceChapter}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <Text
                              style={[styles.cardMeta, { color: chrome.textMuted }]}
                              numberOfLines={1}>
                              {metaLine}
                            </Text>
                          </View>
                        </Pressable>

                        <View style={styles.cardActions}>
                          <Switch
                            value={enabled}
                            onValueChange={(next) => handleToggle(dossier, next)}
                            trackColor={{
                              false: chrome.inputBorder,
                              true: chrome.accent,
                            }}
                            thumbColor={enabled ? chrome.accentContrast : chrome.textMuted}
                            accessibilityLabel={
                              enabled
                                ? `禁用角色 ${displayName}`
                                : `启用角色 ${displayName}`
                            }
                          />
                          <Pressable
                            onPress={() => {
                              void confirmDelete(dossier);
                            }}
                            hitSlop={10}
                            style={({ pressed }) => [
                              styles.cardDeleteBtn,
                              pressed && { opacity: 0.55 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`删除 ${displayName}`}>
                            <Text style={[styles.cardDeleteText, { color: chrome.accent }]}>
                              删除
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  </Swipeable>
                );
              })}
              {dossiers.length > visibleCharacterCount ? (
                <Pressable
                  onPress={() => setVisibleCharacterCount((current) => current + 30)}
                  style={({ pressed }) => [
                    styles.loadMoreCharacters,
                    { borderColor: chrome.border, backgroundColor: chrome.inputBackground },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold">继续展开 {Math.min(30, dossiers.length - visibleCharacterCount)} 人</ThemedText>
                  <ThemedText type="code" style={{ color: chrome.textMuted }}>尚有 {dossiers.length - visibleCharacterCount} 人未渲染；可在人物运营中直接搜索</ThemedText>
                </Pressable>
              ) : null}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>

        <NovelCastCharacterModal
          key={`modal-${editingCast?.id ?? 'new'}`}
          visible={isModalOpen}
          initial={editingCast}
          initialExperience={editingDossier?.experience ?? ''}
          novelName={novel.name}
          intro={mergeIntroForDisplay(novel.shortIntro, novel.detailedIntro)}
          framework={framework}
          existingCast={cast}
          worldContext={
            ENABLE_QUICK_TRAVEL && activeQuickWorld ? buildQuickTravelCharacterContext(activeQuickWorld) : undefined
          }
          novelId={novelId}
          appearanceId={appearanceId}
          requireName
          onClose={() => {
            setIsModalOpen(false);
            setEditingDossier(null);
            setEditingCast(null);
          }}
          onSave={handleSaveCharacter}
        />

        {isOperationsOpen ? <CharacterOperationsModal
          visible={isOperationsOpen}
          novel={novel}
          cast={cast}
          dossiers={dossiers}
          onClose={() => setIsOperationsOpen(false)}
          onUpdateCast={(nextCast) => updateNovelCastCharacters(novelId, nextCast)}
          onUpdateDossiers={(nextDossiers) => updateNovelCharacterDossiers(novelId, nextDossiers)}
          onUpdateWorkspace={(characterWorkspace) => updateNovel(novelId, { characterWorkspace })}
          onUpdateCharacterStates={(characterStates) => {
            const base = novel.novelStoryAnalysis ?? createEmptyStoryAnalysis(novel.chapters?.length ?? 0);
            updateNovel(novelId, {
              novelStoryAnalysis: {
                ...base,
                stateVersion: base.stateVersion + 1,
                characterStates,
                manifest: { ...base.manifest, updatedAt: new Date().toISOString() },
              },
            });
          }}
          isOrganizingRelations={isInferringRelations}
          onOrganizeRelations={handleInferRelations}
          onMergeCharacters={(primaryId, secondaryId) => {
            const primary = cast.find((item) => item.id === primaryId);
            const secondary = cast.find((item) => item.id === secondaryId);
            if (!primary || !secondary) return;
            updateNovelCastCharacters(novelId, mergeCastCharacters(cast, primaryId, secondaryId), { pivotId: primaryId });
            updateNovelCharacterDossiers(novelId, dossiers.filter((dossier) =>
              dossier.castId !== secondaryId
              && dossier.name.trim().toLocaleLowerCase() !== secondary.name.trim().toLocaleLowerCase(),
            ));
            const workspace = normalizeCharacterWorkspace(novel.characterWorkspace);
            const primaryTags = workspace.tagsByCharacterId[primaryId] ?? [];
            const secondaryTags = workspace.tagsByCharacterId[secondaryId] ?? [];
            const tagsByCharacterId = { ...workspace.tagsByCharacterId };
            tagsByCharacterId[primaryId] = [...new Set([...primaryTags, ...secondaryTags])];
            delete tagsByCharacterId[secondaryId];
            const primaryArc = workspace.arcs.find((arc) => arc.characterId === primaryId);
            const arcs = workspace.arcs
              .filter((arc) => arc.characterId !== secondaryId)
              .concat(primaryArc ? [] : workspace.arcs.filter((arc) => arc.characterId === secondaryId).map((arc) => ({ ...arc, characterId: primaryId })));
            const analysis = novel.novelStoryAnalysis;
            updateNovel(novelId, {
              characterWorkspace: { ...workspace, tagsByCharacterId, arcs },
              ...(analysis ? {
                novelStoryAnalysis: {
                  ...analysis,
                  characterStates: analysis.characterStates
                    .map((state) => state.characterId === secondaryId ? { ...state, characterId: primaryId } : state)
                    .filter((state, index, rows) => rows.findIndex((item) => item.characterId === state.characterId) === index),
                  relationships: analysis.relationships.map((relation) => ({
                    ...relation,
                    fromCharacter: relation.fromCharacter.trim().toLocaleLowerCase() === secondary.name.trim().toLocaleLowerCase() ? primary.name : relation.fromCharacter,
                    toCharacter: relation.toCharacter.trim().toLocaleLowerCase() === secondary.name.trim().toLocaleLowerCase() ? primary.name : relation.toCharacter,
                  })),
                },
              } : {}),
            });
          }}
          onDiscoverCandidates={(source) => generateNovelSupportingCharacters(novelId, {
            source,
            previewOnly: true,
          })}
          onEditCandidate={openCandidate}
        /> : null}

        <Modal
          visible={isAppearancePickerOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setIsAppearancePickerOpen(false)}>
          <Pressable style={styles.appearanceBackdrop} onPress={() => setIsAppearancePickerOpen(false)}>
            <Pressable
              style={[
                styles.appearanceSheet,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                },
              ]}
              onPress={(event) => event.stopPropagation()}>
              <View style={styles.appearanceSheetHeader}>
                <View style={{ flex: 1, gap: 4 }}>
                  <ThemedText type="smallBold">卡面款式</ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    两套全新原创视觉，整部小说共用一套。
                  </ThemedText>
                </View>
                <Pressable onPress={() => setIsAppearancePickerOpen(false)} hitSlop={8}>
                  <ThemedText type="code" themeColor="accent">
                    关闭
                  </ThemedText>
                </Pressable>
              </View>
              <CharacterCardAppearancePicker
                appearances={CHARACTER_CARD_APPEARANCES}
                selectedId={appearanceId}
                onSelect={(appearance) => {
                  if (!novelId) {
                    return;
                  }
                  updateNovelCharacterCardAppearanceId(novelId, appearance.id);
                  setIsAppearancePickerOpen(false);
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>

      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  safeAreaDesktop: { maxWidth: 1600 },
  content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  contentDesktop: { paddingHorizontal: Spacing.five, paddingTop: Spacing.five, gap: Spacing.four },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.three },
  cardGridItem: { flexBasis: 420, flexGrow: 1, minWidth: 0 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  addButton: {
    borderRadius: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  archiveHeroShell: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    overflow: 'hidden',
  },
  archiveHero: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  archiveHeroNumber: {
    position: 'absolute',
    right: -8,
    top: -28,
    fontFamily: 'serif',
    fontSize: 154,
    lineHeight: 166,
    fontWeight: '400',
    opacity: 0.075,
  },
  archiveHeroOrbit: {
    position: 'absolute',
    right: -76,
    top: -90,
    width: 218,
    height: 218,
    borderRadius: 109,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.42,
  },
  archiveHeroHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  archiveHeroSignal: {
    width: 22,
    height: 3,
  },
  archiveHeroEyebrow: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.7,
    textTransform: 'uppercase',
  },
  archiveHeroTitle: {
    maxWidth: 620,
    fontFamily: 'serif',
    fontSize: 40,
    lineHeight: 47,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
  archiveHeroCopy: {
    maxWidth: 720,
    fontSize: 13,
    lineHeight: 21,
  },
  archiveHeroStats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    flexWrap: 'wrap',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  archiveHeroStatValue: {
    fontFamily: 'serif',
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
  },
  archiveHeroStatLabel: {
    marginTop: 2,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  archiveHeroStatRule: {
    width: StyleSheet.hairlineWidth,
    minHeight: 38,
  },
  appearanceQuickAction: {
    minWidth: 136,
    minHeight: 42,
    marginLeft: 'auto',
    borderLeftWidth: 1,
    paddingLeft: Spacing.three,
    justifyContent: 'center',
    gap: 2,
  },
  appearanceQuickLabel: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  appearanceQuickValue: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: 1,
    minWidth: 96,
    minHeight: 48,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    gap: 2,
  },
  actionButtonPrimary: {},
  actionButtonWorkspace: {
    flex: 2.2,
    minWidth: 220,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
  },
  legacyIdeaCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  legacyIdeaCopy: {
    flex: 1,
    minWidth: 220,
    gap: 4,
  },
  legacyIdeaEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  legacyIdeaTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  legacyIdeaText: {
    fontSize: 12,
    lineHeight: 18,
  },
  legacyIdeaButton: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legacyIdeaButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  addButtonText: { color: '#120c09' },
  primaryActionContent: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingLeft: Spacing.one,
  },
  primaryActionArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,12,9,0.1)',
  },
  primaryActionArrowText: {
    color: '#120c09',
    fontSize: 15,
    fontWeight: '800',
  },
  workspaceActionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  workspaceActionArrow: {
    fontFamily: 'serif',
    fontSize: 22,
    lineHeight: 26,
  },
  appearanceBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(18, 12, 9, 0.45)',
  },
  appearanceSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  appearanceSheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 72,
  },
  cardInnerBezel: {
    position: 'absolute',
    top: 5,
    right: 5,
    bottom: 5,
    left: 5,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.62,
  },
  cardSerial: {
    position: 'absolute',
    right: 78,
    top: -12,
    fontFamily: 'serif',
    fontSize: 64,
    lineHeight: 76,
    fontWeight: '400',
    opacity: 0.09,
  },
  cardTelemetry: {
    position: 'absolute',
    left: Spacing.four,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    opacity: 0.76,
  },
  cardTelemetryDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  cardTelemetryText: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: 2,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing.four,
    paddingRight: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  cardHit: {
    flex: 1,
    minWidth: 0,
  },
  cardPortraitGhost: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    opacity: 0.2,
  },
  cardPortraitGhostImage: {
    width: '100%',
    height: '100%',
  },
  cardPortraitGhostImageAndroid: {
    transform: [{ scale: ANDROID_PORTRAIT_GHOST_ZOOM }],
  },
  cardCopy: {
    gap: 5,
    minWidth: 0,
    flex: 1,
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardName: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
    maxWidth: '78%',
  },
  protagonistChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  protagonistChipText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  chapterChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chapterChipText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  cardMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  cardActions: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
    minWidth: 52,
  },
  cardDeleteBtn: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  cardDeleteText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  deleteAction: {
    width: DELETE_ACTION_WIDTH,
    alignSelf: 'stretch',
    backgroundColor: DELETE_ACTION_BG,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteActionText: { color: '#fff7f5' },
  pressed: { opacity: 0.75 },
  loadMoreCharacters: { minHeight: 74, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 5, padding: Spacing.three },
});
