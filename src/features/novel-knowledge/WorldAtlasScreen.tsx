import { Stack, useLocalSearchParams, router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { MobileAction, MobilePageIntro } from '@/components/mobile/MobileUI';
import { NovelMobileNavigation } from '@/components/novel-continue/NovelMobileNavigation';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { NovelLoreBatchGeneratorModal } from '@/components/NovelLoreBatchGeneratorModal';
import {
  MAX_NOVEL_LORE_CONTENT_LENGTH,
  NOVEL_LORE_COLLECTION_TEMPLATES,
  NOVEL_LORE_TYPES,
  NOVEL_LORE_TYPE_LABELS,
  SYSTEM_NOVEL_LORE_COLLECTIONS,
  type NovelLoreCollection,
  type NovelLoreCollectionTemplateId,
  type NovelLoreTypeId,
} from '@/constants/novel-lore';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { getLorePlanningDraftId } from '@/features/novel-planning/lore-draft';
import { generateNovelLoreEntry } from '@/services/novel-create-ai';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import type { NovelLoreEntry } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { generateId } from '@/utils/helpers';
import { mergeIntroForDisplay } from '@/utils/novel-intro';
import {
  createEmptyLoreEntry,
  ensureNovelLoreCollections,
  ensureNovelLoreEntries,
  getNovelLoreCollections,
  resolveLoreCollectionId,
} from '@/utils/novel-lore';

function aliasesToText(aliases: string[]) {
  return aliases.join('，');
}

function textToAliases(value: string) {
  return value
    .split(/[,，、|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function excerpt(value: string, empty: string, limit = 92) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return empty;
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

export default function WorldAtlasScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const desktop = useDesktopLayout();
  const mobile = !desktop;
  const wide = desktop || width >= 760;
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const novels = useTavernStore((state) => state.novels);
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const updateNovelLoreEntries = useTavernStore((state) => state.updateNovelLoreEntries);
  const updateNovelLoreCollections = useTavernStore((state) => state.updateNovelLoreCollections);
  const recordNovelContinuationUsage = useTavernStore((state) => state.recordNovelContinuationUsage);
  const novel = novels.find((item) => item.id === novelId);

  const entries = useMemo(() => (novel ? ensureNovelLoreEntries(novel) : []), [novel]);
  const customCollections = useMemo(
    () => ensureNovelLoreCollections(novel?.loreCollections),
    [novel?.loreCollections],
  );
  const collections = useMemo(
    () => getNovelLoreCollections(customCollections),
    [customCollections],
  );

  const [activeCollectionId, setActiveCollectionId] = useState(SYSTEM_NOVEL_LORE_COLLECTIONS[0].id);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  const [isOverviewModalOpen, setIsOverviewModalOpen] = useState(false);
  const [editing, setEditing] = useState<NovelLoreEntry | null>(null);
  const [draft, setDraft] = useState<NovelLoreEntry>(createEmptyLoreEntry());
  const [aliasesText, setAliasesText] = useState('');
  const [aiBrief, setAiBrief] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [collectionName, setCollectionName] = useState('');
  const [collectionDescription, setCollectionDescription] = useState('');
  const [collectionType, setCollectionType] = useState<NovelLoreTypeId>('lore');
  const [overviewName, setOverviewName] = useState('');
  const [overviewEra, setOverviewEra] = useState('');
  const [overviewRules, setOverviewRules] = useState('');
  const [introReveal] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));

  useEffect(() => {
    introReveal.stopAnimation();
    if (!motionEnabled) {
      introReveal.setValue(1);
      return;
    }
    introReveal.setValue(0);
    Animated.timing(introReveal, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    }).start();
  }, [introReveal, motionEnabled]);

  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const collectionId = resolveLoreCollectionId(entry, collections);
      counts.set(collectionId, (counts.get(collectionId) ?? 0) + 1);
    }
    return counts;
  }, [collections, entries]);

  const activeCollection = collections.find((collection) => collection.id === activeCollectionId)
    ?? collections[0];
  const visibleEntries = useMemo(
    () => entries.filter((entry) => resolveLoreCollectionId(entry, collections) === activeCollection?.id),
    [activeCollection?.id, collections, entries],
  );
  const activeIsCustom = customCollections.some((collection) => collection.id === activeCollection?.id);

  function openCreate() {
    if (!activeCollection) return;
    setEditing(null);
    setDraft(createEmptyLoreEntry(activeCollection.defaultType, activeCollection.id));
    setAliasesText('');
    setAiBrief('');
    setIsEntryModalOpen(true);
  }

  function openBatchCreate() {
    setIsBatchModalOpen(true);
  }

  async function openLorePlanning() {
    if (!novelId || !activeCollection) return;
    try {
      const draftId = await getLorePlanningDraftId(novelId, activeCollection.id, entries.map((entry) => entry.id));
      router.push({ pathname: '/novel/planning', params: { kind: 'lore', novelId, collectionId: activeCollection.id, draftId } } as Href);
    } catch {
      showAppAlert('无法打开构想', '读取规划草稿失败，请重试。');
    }
  }

  function handleAcceptBatch(additions: NovelLoreEntry[]) {
    if (!novelId || additions.length === 0 || !activeCollection) return;
    const filed = additions.map((entry) => ({ ...entry, collectionId: activeCollection.id }));
    updateNovelLoreEntries(novelId, [...entries, ...filed]);
  }

  function openEdit(entry: NovelLoreEntry) {
    setEditing(entry);
    setDraft({ ...entry, collectionId: resolveLoreCollectionId(entry, collections) });
    setAliasesText(aliasesToText(entry.aliases));
    setAiBrief('');
    setIsEntryModalOpen(true);
  }

  function closeEntryModal() {
    setIsEntryModalOpen(false);
    setEditing(null);
    setAiBrief('');
  }

  function handleSave() {
    if (!novelId) return;
    const name = draft.name.trim();
    if (!name) {
      showAppAlert('缺少名称', '请填写设定名称。');
      return;
    }
    const nextEntry: NovelLoreEntry = {
      ...draft,
      name,
      aliases: textToAliases(aliasesText),
      content: draft.content.trim().slice(0, MAX_NOVEL_LORE_CONTENT_LENGTH),
      updatedAt: new Date().toISOString(),
    };
    const exists = entries.some((item) => item.id === nextEntry.id);
    const next = exists
      ? entries.map((item) => (item.id === nextEntry.id ? nextEntry : item))
      : [...entries, nextEntry];
    updateNovelLoreEntries(novelId, next);
    setActiveCollectionId(nextEntry.collectionId ?? activeCollectionId);
    closeEntryModal();
  }

  function handleToggle(entry: NovelLoreEntry, enabled: boolean) {
    if (!novelId) return;
    updateNovelLoreEntries(
      novelId,
      entries.map((item) => item.id === entry.id
        ? { ...item, enabled, updatedAt: new Date().toISOString() }
        : item),
    );
  }

  async function handleDelete(entry: NovelLoreEntry) {
    if (!novelId) return;
    const confirmed = await confirmAppAction('删除设定', `确定删除「${entry.name || '未命名'}」吗？`, { confirmLabel: '删除' });
    if (confirmed) updateNovelLoreEntries(novelId, entries.filter((item) => item.id !== entry.id));
  }

  async function handleAiGenerate() {
    if (!novel || isGenerating) return;
    setIsGenerating(true);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, { task: 'world', purpose: 'utility' });
      if (!apiSettings.apiKey.trim()) {
        showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
        return;
      }
      const next = await generateNovelLoreEntry({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        novelName: novel.name,
        intro: mergeIntroForDisplay(novel.shortIntro, novel.detailedIntro),
        worldName: novel.worldName,
        worldEra: novel.worldEra,
        current: { ...draft, aliases: textToAliases(aliasesText) },
        existingEntries: entries,
        userBrief: aiBrief,
        preferredType: draft.type,
        onUsage: (usage) => {
          if (novelId && usage.completionTokens > 0) recordNovelContinuationUsage(novelId, 'create-lore', usage.completionTokens);
        },
      });
      setDraft({ ...next, collectionId: draft.collectionId });
      setAliasesText(aliasesToText(next.aliases));
    } catch (error) {
      showAppAlert('生成失败', error instanceof Error ? error.message : '无法生成设定。');
    } finally {
      setIsGenerating(false);
    }
  }

  function openOverview() {
    if (!novel) return;
    setOverviewName(novel.worldName);
    setOverviewEra(novel.worldEra);
    setOverviewRules(novel.gameRules);
    setIsOverviewModalOpen(true);
  }

  function saveOverview() {
    if (!novelId) return;
    updateNovel(novelId, { worldName: overviewName, worldEra: overviewEra, gameRules: overviewRules });
    setIsOverviewModalOpen(false);
  }

  function createCollection() {
    if (!novelId) return;
    const name = collectionName.trim();
    if (!name) {
      showAppAlert('缺少分卷名', '请填写分卷名称。');
      return;
    }
    if (collections.some((collection) => collection.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      showAppAlert('名称重复', '已经存在同名分卷。');
      return;
    }
    const next: NovelLoreCollection = {
      id: generateId('atlas'),
      name: name.slice(0, 28),
      description: collectionDescription.trim().slice(0, 80),
      defaultType: collectionType,
    };
    updateNovelLoreCollections(novelId, [...customCollections, next]);
    setActiveCollectionId(next.id);
    setCollectionName('');
    setCollectionDescription('');
    setCollectionType('lore');
    setIsCollectionModalOpen(false);
  }

  function applyCollectionTemplate(templateId: NovelLoreCollectionTemplateId) {
    if (!novelId) return;
    const template = NOVEL_LORE_COLLECTION_TEMPLATES[templateId];
    const names = new Set(collections.map((collection) => collection.name.toLocaleLowerCase()));
    const additions = template.collections
      .filter((collection) => !names.has(collection.name.toLocaleLowerCase()))
      .map((collection) => ({ ...collection, id: generateId(`atlas-${templateId}`) }));
    if (additions.length === 0) {
      showAppAlert('已经归档', `${template.name}分卷已经全部存在。`);
      return;
    }
    updateNovelLoreCollections(novelId, [...customCollections, ...additions]);
    setActiveCollectionId(additions[0].id);
    setIsCollectionModalOpen(false);
  }

  async function deleteActiveCollection() {
    if (!novelId || !activeCollection || !activeIsCustom) return;
    const count = collectionCounts.get(activeCollection.id) ?? 0;
    const confirmed = await confirmAppAction(
      '删除分卷',
      count > 0 ? `删除「${activeCollection.name}」后，其中 ${count} 条设定会回到对应的基础分卷。` : `确定删除空分卷「${activeCollection.name}」吗？`,
      { confirmLabel: '删除分卷' },
    );
    if (!confirmed) return;
    updateNovelLoreEntries(novelId, entries.map((entry) => entry.collectionId === activeCollection.id ? { ...entry, collectionId: undefined } : entry));
    updateNovelLoreCollections(novelId, customCollections.filter((collection) => collection.id !== activeCollection.id));
    setActiveCollectionId(SYSTEM_NOVEL_LORE_COLLECTIONS[0].id);
  }

  if (!novelId || !novel) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: '世界设定', headerShown: true }} />
        <ThemedText themeColor="textSecondary">未找到小说。</ThemedText>
        <Pressable onPress={() => router.replace('/(tabs)/novels' as Href)}><ThemedText type="linkPrimary">返回书架</ThemedText></Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView decorated={!mobile} style={styles.container}>
      <Stack.Screen options={{ title: '世界设定', headerShown: !mobile, headerBackTitle: '知识库', headerStyle: { backgroundColor: theme.background }, headerTintColor: theme.accent, headerTitleStyle: { color: theme.text, fontWeight: '700' } }} />
      <SafeAreaView style={[styles.safeArea, desktop && styles.safeAreaDesktop]} edges={mobile ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}>
        {mobile ? <NovelMobileNavigation novelId={novel.id} title="知识库" /> : null}
        <ScrollView contentContainerStyle={[styles.content, desktop && styles.contentDesktop, mobile && styles.mobileContent]} showsVerticalScrollIndicator={false}>
          {mobile ? <View style={{ gap: 16 }}>
            <MobilePageIntro title="知识库" subtitle={`${entries.length} 条资料 · 世界设定与故事规则`} />
            <Pressable accessibilityRole="button" onPress={openOverview} style={({ pressed }) => [{ padding: 16, borderRadius: 12, gap: 8, backgroundColor: theme.primaryContainer }, pressed && styles.pressed]}><ThemedText type="smallBold" themeColor="primary">世界总览 · 编辑 →</ThemedText><ThemedText style={{ fontSize: 18, lineHeight: 28 }}>{novel.worldName.trim() || '尚未命名的世界'}</ThemedText></Pressable>
            <MobileAction label="和 AI 一起构思世界" variant="text" onPress={() => router.push({ pathname: '/novel/planning', params: { kind: 'world', novelId } } as Href)} />
          </View> : <>
          <Animated.View style={{ opacity: introReveal, transform: [{ translateX: introReveal.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }, { scaleX: introReveal.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }}>
            <View style={[styles.heroTopline, mobile && styles.mobileHeroTopline]}><View style={[styles.heroRule, { backgroundColor: theme.accent }]} /><Text style={[styles.eyebrow, { color: theme.accent }]}>WORLD ATLAS / LIVE INDEX</Text></View>
            <View style={[styles.heroRow, wide && styles.heroRowWide]}>
              <View style={styles.heroCopy}><Text style={[styles.heroTitle, desktop && styles.heroTitleDesktop, mobile && styles.mobileHeroTitle, { color: theme.text }]}>知识库</Text><Text style={[styles.heroDescription, desktop && styles.bodyTextDesktop, { color: theme.textMuted }]}>世界总览、资料分组与条目都在这里管理。</Text></View>
              <View style={[styles.heroMetric, { borderColor: theme.border }]}><Text style={[styles.heroMetricValue, { color: theme.text }]}>{entries.length}</Text><Text style={[styles.heroMetricLabel, { color: theme.textMuted }]}>条已归档</Text></View>
            </View>
          </Animated.View>

          <Pressable onPress={openOverview} style={({ pressed }) => [styles.overview, mobile && { minHeight: 188, borderRadius: 12, padding: 20 }, { backgroundColor: theme.accent }, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="编辑世界总览">
            <View pointerEvents="none" style={[styles.overviewOrbit, { borderColor: theme.onPrimary }]} /><Text pointerEvents="none" style={[styles.overviewMonogram, { color: theme.onPrimary }]}>界</Text>
            <View style={styles.overviewHeader}><Text style={[styles.overviewEyebrow, { color: `${theme.onPrimary}B8` }]}>MASTER DOSSIER</Text><Text style={[styles.overviewEdit, { color: theme.onPrimary }]}>编辑总览 ↗</Text></View>
            <Text style={[styles.overviewTitle, { color: theme.onPrimary }]}>{novel.worldName.trim() || '尚未命名的世界'}</Text>
            <Text style={[styles.overviewEra, { color: `${theme.onPrimary}D0` }]}>{excerpt(novel.worldEra, '尚未记录时代、技术或力量体系。', 120)}</Text>
            <View style={[styles.overviewRule, { backgroundColor: `${theme.onPrimary}42` }]} /><Text style={[styles.overviewRules, { color: `${theme.onPrimary}B8` }]}>{excerpt(novel.gameRules, '尚未记录这个世界必须遵守的规则。', 150)}</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push({ pathname: '/novel/planning', params: { kind: 'world', novelId } } as Href)}
            style={({ pressed }) => [styles.planningEntry, { borderColor: theme.accent, backgroundColor: theme.accentMuted }, pressed && styles.pressed]}
          >
            <View style={styles.planningEntryCopy}><Text style={[styles.planningEntryEyebrow, { color: theme.accent }]}>PLANNING STUDIO</Text><Text style={[styles.planningEntryTitle, { color: theme.text }]}>和 AI 一起构思世界</Text><Text style={[styles.planningEntryDescription, { color: theme.textMuted }]}>先用自然语言讨论，准备好后再写入世界总览字段。</Text></View>
            <Text style={[styles.planningEntryArrow, { color: theme.accent }]}>进入 ↗</Text>
          </Pressable>

          </>}
          <View style={styles.collectionSection}>
            <View style={styles.sectionHeadingRow}>
              <View style={styles.sectionHeadingCopy}><Text style={[styles.sectionIndex, { color: theme.accent }]}>卷宗索引</Text><Text style={[styles.sectionTitle, { color: theme.text }]}>选择一卷，只看相关资料</Text></View>
              <Pressable onPress={() => setIsCollectionModalOpen(true)} style={({ pressed }) => [styles.textAction, mobile && { minHeight: 48, justifyContent: 'center' }, pressed && styles.pressed]}><Text style={[styles.textActionLabel, { color: theme.accent }]}>新分卷 / 模板 ＋</Text></Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.collectionRail}>
              {collections.map((collection, index) => {
                const active = collection.id === activeCollection?.id;
                const count = collectionCounts.get(collection.id) ?? 0;
                return (
                  <Pressable key={collection.id} onPress={() => setActiveCollectionId(collection.id)} style={({ pressed }) => [styles.collectionTab, mobile && { minHeight: 64, width: 140, borderRadius: 12, padding: 12 }, { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accentMuted : theme.backgroundElement }, pressed && styles.pressed]}>
                    {!mobile ? <View style={styles.collectionTabTop}><Text style={[styles.collectionSerial, { color: active ? theme.accent : theme.textMuted }]}>{String(index + 1).padStart(2, '0')}</Text><Text style={[styles.collectionCount, { color: active ? theme.accent : theme.textMuted }]}>{count} 条</Text></View> : null}
                    <Text numberOfLines={1} style={[styles.collectionName, { color: theme.text }]}>{collection.name}</Text>{!mobile ? <Text numberOfLines={2} style={[styles.collectionDescription, { color: theme.textMuted }]}>{collection.description}</Text> : <ThemedText type="small" themeColor="textMuted">{count} 条</ThemedText>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {activeCollection ? (
            <View style={[styles.ledger, desktop && styles.ledgerDesktop, mobile && { padding: 0, borderWidth: 0, borderRadius: 0 }, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
              <View style={styles.ledgerHeader}>
                <View style={styles.ledgerTitleBlock}><Text style={[styles.ledgerEyebrow, { color: theme.accent }]}>OPEN VOLUME · {NOVEL_LORE_TYPE_LABELS[activeCollection.defaultType]}</Text><Text style={[styles.ledgerTitle, { color: theme.text }]}>{activeCollection.name}</Text><Text style={[styles.ledgerDescription, { color: theme.textMuted }]}>{activeCollection.description}</Text></View>
                <View style={[styles.ledgerActions, mobile && { width: '100%' }]}>
                  <Pressable onPress={() => { void openLorePlanning(); }} style={[styles.minorAction, mobile && { minHeight: 44, borderRadius: 12 }, { borderColor: theme.accent }]}><Text style={[styles.minorActionText, { color: theme.accent }]}>对话构思新条目</Text></Pressable>
                  {activeIsCustom ? <Pressable onPress={() => void deleteActiveCollection()} style={({ pressed }) => [styles.minorAction, mobile && { minHeight: 44, borderRadius: 12 }, { borderColor: theme.border }, pressed && styles.pressed]}><Text style={[styles.minorActionText, { color: theme.textMuted }]}>删卷</Text></Pressable> : null}
                  <Pressable onPress={openBatchCreate} style={({ pressed }) => [styles.minorAction, mobile && { minHeight: 44, borderRadius: 12 }, { borderColor: theme.accent }, pressed && styles.pressed]}><Text style={[styles.minorActionText, { color: theme.accent }]}>AI 起草</Text></Pressable>
                  <Pressable onPress={openCreate} style={({ pressed }) => [styles.addAction, mobile && { minHeight: 44, borderRadius: 12 }, { backgroundColor: theme.accent }, pressed && styles.pressed]}><Text style={[styles.addActionText, { color: theme.onPrimary }]}>新增条目 ＋</Text></Pressable>
                </View>
              </View>
              {visibleEntries.length === 0 ? (
                <Pressable onPress={openCreate} style={[styles.emptyState, { borderColor: theme.border }]}><Text style={[styles.emptyGlyph, { color: theme.accent }]}>◇</Text><Text style={[styles.emptyTitle, { color: theme.text }]}>这一卷还是空的</Text><Text style={[styles.emptyDescription, { color: theme.textMuted }]}>添加第一条资料，或让 AI 按当前分卷起草候选。</Text></Pressable>
              ) : (
                <View style={styles.entryList}>{visibleEntries.map((entry, index) => {
                  const enabled = entry.enabled !== false;
                  return (
                    <View key={entry.id} style={[styles.entryRow, { borderTopColor: theme.border }]}>
                      <Pressable onPress={() => openEdit(entry)} style={styles.entryMain} accessibilityRole="button" accessibilityLabel={`编辑设定 ${entry.name}`}>
                        <Text style={[styles.entryIndex, { color: theme.textMuted }]}>{String(index + 1).padStart(2, '0')}</Text>
                        <View style={styles.entryCopy}><View style={styles.entryTitleRow}><Text numberOfLines={1} style={[styles.entryTitle, desktop && styles.entryTitleDesktop, { color: theme.text }]}>{entry.name || '未命名'}</Text><Text style={[styles.entryType, { color: theme.accent }]}>{NOVEL_LORE_TYPE_LABELS[entry.type]}</Text></View><Text numberOfLines={2} style={[styles.entryContent, desktop && styles.bodyTextDesktop, { color: theme.textSecondary }]}>{entry.content.trim() || '暂无正文'}</Text>{entry.aliases.length > 0 ? <Text numberOfLines={1} style={[styles.entryAliases, { color: theme.textMuted }]}>触发词 · {aliasesToText(entry.aliases)}</Text> : null}</View>
                      </Pressable>
                      <View style={[styles.entryActions, mobile && { flexWrap: 'wrap', gap: 4, justifyContent: 'flex-start' }]}><Pressable style={mobile && { minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 }} onPress={() => router.push({ pathname: '/novel/planning', params: { kind: 'lore', novelId, entryId: entry.id } } as Href)} hitSlop={8}><Text style={[styles.deleteText, { color: theme.accent }]}>规划</Text></Pressable><Pressable style={mobile && { minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 }} onPress={() => void handleDelete(entry)} hitSlop={8}><Text style={styles.deleteText}>删除</Text></Pressable><View style={mobile && { minHeight: 44, justifyContent: 'center' }}><Switch value={enabled} onValueChange={(next) => handleToggle(entry, next)} trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }} thumbColor={enabled ? theme.accent : theme.textMuted} /></View></View>
                    </View>
                  );
                })}</View>
              )}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={isOverviewModalOpen} animationType="slide" transparent onRequestClose={() => setIsOverviewModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setIsOverviewModalOpen(false)} /><View style={[styles.modalSheet, { backgroundColor: theme.background, borderColor: theme.border }]}><View style={styles.modalHeader}><View><Text style={[styles.modalEyebrow, { color: theme.accent }]}>MASTER DOSSIER</Text><Text style={[styles.modalTitle, { color: theme.text }]}>编辑世界总览</Text></View><Pressable onPress={() => setIsOverviewModalOpen(false)} hitSlop={8}><Text style={{ color: theme.accent }}>关闭</Text></Pressable></View><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled"><LabeledInput label="世界名称" value={overviewName} onChangeText={setOverviewName} placeholder="例如：大梁江湖、九州界" /><LabeledInput label="时代与世界基础" value={overviewEra} onChangeText={setOverviewEra} placeholder="时代、社会、技术或力量体系" multiline /><LabeledInput label="世界运行规则" value={overviewRules} onChangeText={setOverviewRules} placeholder="正文必须遵守的规则与边界" multiline /><Pressable onPress={saveOverview} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.accent }, pressed && styles.pressed]}><Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>保存世界总览</Text></Pressable></ScrollView></View></KeyboardAvoidingView>
      </Modal>

      <Modal visible={isCollectionModalOpen} animationType="slide" transparent onRequestClose={() => setIsCollectionModalOpen(false)}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Pressable style={styles.modalBackdrop} onPress={() => setIsCollectionModalOpen(false)} /><View style={[styles.modalSheet, { backgroundColor: theme.background, borderColor: theme.border }]}><View style={styles.modalHeader}><View><Text style={[styles.modalEyebrow, { color: theme.accent }]}>CUSTOM VOLUME</Text><Text style={[styles.modalTitle, { color: theme.text }]}>建立新分卷</Text></View><Pressable onPress={() => setIsCollectionModalOpen(false)} hitSlop={8}><Text style={{ color: theme.accent }}>关闭</Text></Pressable></View><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={styles.templateBlock}><Text style={[styles.fieldLabel, { color: theme.text }]}>从题材模板开始</Text><Text style={[styles.fieldHelp, { color: theme.textMuted }]}>模板只会添加可编辑分卷，不改变小说内容。</Text><View style={[styles.templateGrid, wide && styles.templateGridWide]}>{(Object.entries(NOVEL_LORE_COLLECTION_TEMPLATES) as [NovelLoreCollectionTemplateId, (typeof NOVEL_LORE_COLLECTION_TEMPLATES)[NovelLoreCollectionTemplateId]][]).map(([id, template]) => <Pressable key={id} onPress={() => applyCollectionTemplate(id)} style={({ pressed }) => [styles.templateCard, { borderColor: theme.border, backgroundColor: theme.backgroundElement }, pressed && styles.pressed]}><Text style={[styles.templateTitle, { color: theme.text }]}>{template.name}</Text><Text style={[styles.templateDescription, { color: theme.textMuted }]}>{template.description}</Text><Text style={[styles.templateMeta, { color: theme.accent }]}>{template.collections.length} 卷 · 套用 ↗</Text></Pressable>)}</View></View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} /><LabeledInput label="分卷名称" value={collectionName} onChangeText={setCollectionName} placeholder="例如：神兵谱、异兽志、星舰档案" /><LabeledInput label="一句说明" value={collectionDescription} onChangeText={setCollectionDescription} placeholder="这一卷收录什么" /><View style={styles.field}><Text style={[styles.fieldLabel, { color: theme.text }]}>默认条目类型</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRail}>{NOVEL_LORE_TYPES.map((type) => <Pressable key={type} onPress={() => setCollectionType(type)} style={[styles.pickerOption, { borderColor: collectionType === type ? theme.accent : theme.border, backgroundColor: collectionType === type ? theme.accentMuted : theme.backgroundElement }]}><Text style={{ color: collectionType === type ? theme.accent : theme.textSecondary }}>{NOVEL_LORE_TYPE_LABELS[type]}</Text></Pressable>)}</ScrollView></View><Pressable onPress={createCollection} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.accent }, pressed && styles.pressed]}><Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>创建空白分卷</Text></Pressable>
        </ScrollView></View></KeyboardAvoidingView>
      </Modal>

      <Modal visible={isEntryModalOpen} animationType="slide" transparent onRequestClose={closeEntryModal}>
        <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Pressable style={styles.modalBackdrop} onPress={closeEntryModal} /><View style={[styles.modalSheet, { backgroundColor: theme.background, borderColor: theme.border }]}><View style={styles.modalHeader}><View><Text style={[styles.modalEyebrow, { color: theme.accent }]}>ATLAS ENTRY</Text><Text style={[styles.modalTitle, { color: theme.text }]}>{editing ? '编辑条目' : '新建条目'}</Text></View><Pressable onPress={closeEntryModal} hitSlop={8}><Text style={{ color: theme.accent }}>关闭</Text></Pressable></View><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.field}><Text style={[styles.fieldLabel, { color: theme.text }]}>归入分卷</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRail}>{collections.map((collection) => <Pressable key={collection.id} onPress={() => setDraft((prev) => ({ ...prev, collectionId: collection.id }))} style={[styles.pickerOption, { borderColor: draft.collectionId === collection.id ? theme.accent : theme.border, backgroundColor: draft.collectionId === collection.id ? theme.accentMuted : theme.backgroundElement }]}><Text style={{ color: draft.collectionId === collection.id ? theme.accent : theme.textSecondary }}>{collection.name}</Text></Pressable>)}</ScrollView></View>
          <View style={styles.field}><Text style={[styles.fieldLabel, { color: theme.text }]}>语义类型</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRail}>{NOVEL_LORE_TYPES.map((type) => <Pressable key={type} onPress={() => setDraft((prev) => ({ ...prev, type }))} style={[styles.pickerOption, { borderColor: draft.type === type ? theme.accent : theme.border, backgroundColor: draft.type === type ? theme.accentMuted : theme.backgroundElement }]}><Text style={{ color: draft.type === type ? theme.accent : theme.textSecondary }}>{NOVEL_LORE_TYPE_LABELS[type]}</Text></Pressable>)}</ScrollView></View>
          <LabeledInput label="名称" value={draft.name} onChangeText={(name) => setDraft((prev) => ({ ...prev, name }))} placeholder="例如：青霜剑、金陵城、玄天宗" /><LabeledInput label="别名与触发词" value={aliasesText} onChangeText={setAliasesText} placeholder="逗号分隔，如：锈剑，因果之刃" />
          <View style={styles.field}><View style={styles.labelRow}><Text style={[styles.fieldLabel, { color: theme.text }]}>AI 需要知道的事实</Text><Text style={[styles.fieldCounter, { color: theme.textMuted }]}>{draft.content.length} / {MAX_NOVEL_LORE_CONTENT_LENGTH}</Text></View><TextInput value={draft.content} onChangeText={(content) => setDraft((prev) => ({ ...prev, content: content.slice(0, MAX_NOVEL_LORE_CONTENT_LENGTH) }))} placeholder="命中名称时需要模型知道的稳定设定。" placeholderTextColor={theme.textMuted} multiline style={[styles.input, styles.multiline, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} /></View>
          <View style={styles.switchRow}><View style={{ flex: 1 }}><Text style={[styles.fieldLabel, { color: theme.text }]}>参与正文匹配</Text><Text style={[styles.fieldHelp, { color: theme.textMuted }]}>关闭后保留档案，但不会注入提示词。</Text></View><Switch value={draft.enabled !== false} onValueChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))} trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }} thumbColor={draft.enabled !== false ? theme.accent : theme.textMuted} /></View>
          <TaskModelSelector task="world" disabled={isGenerating} />
          <LabeledInput label="给 AI 的补全要求（可选）" value={aiBrief} onChangeText={setAiBrief} placeholder="一句话描述，如：一把能斩因果的锈剑" multiline compact /><Pressable onPress={() => void handleAiGenerate()} disabled={isGenerating} style={({ pressed }) => [styles.secondaryButton, { borderColor: theme.accent }, (pressed || isGenerating) && styles.pressed]}><Text style={[styles.secondaryButtonText, { color: theme.accent }]}>{isGenerating ? '生成中…' : 'AI 补全本条'}</Text></Pressable><Pressable onPress={handleSave} style={({ pressed }) => [styles.primaryButton, { backgroundColor: theme.accent }, pressed && styles.pressed]}><Text style={[styles.primaryButtonText, { color: theme.onPrimary }]}>保存条目</Text></Pressable>
        </ScrollView></View></KeyboardAvoidingView>
      </Modal>

      <NovelLoreBatchGeneratorModal visible={isBatchModalOpen} novel={novel} existingEntries={entries} targetCollection={activeCollection} onAccept={handleAcceptBatch} onClose={() => setIsBatchModalOpen(false)} />
    </ThemedView>
  );
}

type LabeledInputProps = { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; multiline?: boolean; compact?: boolean };

function LabeledInput({ label, value, onChangeText, placeholder, multiline = false, compact = false }: LabeledInputProps) {
  const theme = useTheme();
  return <View style={styles.field}><Text style={[styles.fieldLabel, { color: theme.text }]}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.textMuted} multiline={multiline} style={[styles.input, multiline && (compact ? styles.compactMultiline : styles.multiline), { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} /></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' }, safeAreaDesktop: { maxWidth: 1600 }, content: { padding: Spacing.four, gap: Spacing.five, paddingBottom: Spacing.six }, contentDesktop: { paddingHorizontal: Spacing.five, paddingTop: Spacing.five, gap: Spacing.six }, mobileContent: { paddingHorizontal: 20, paddingTop: 20, gap: 16 }, centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  heroTopline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.three }, mobileHeroTopline: { marginBottom: 8 }, heroRule: { width: 32, height: 3 }, eyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.55 }, heroRow: { gap: Spacing.three }, heroRowWide: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }, heroCopy: { flex: 1, maxWidth: 580, gap: 7 }, heroTitle: { fontFamily: 'serif', fontSize: 42, lineHeight: 49, fontWeight: '600', letterSpacing: -0.4 }, mobileHeroTitle: { fontSize: 28, lineHeight: 38 }, heroTitleDesktop: { fontSize: 52, lineHeight: 60 }, heroDescription: { maxWidth: 560, fontSize: 12, lineHeight: 20 }, bodyTextDesktop: { fontSize: 15, lineHeight: 24 }, heroMetric: { minWidth: 130, borderLeftWidth: 1, paddingLeft: Spacing.three, paddingBottom: 3 }, heroMetricValue: { fontFamily: 'serif', fontSize: 30, lineHeight: 34, fontWeight: '500' }, heroMetricLabel: { fontSize: 8, lineHeight: 12, letterSpacing: 0.8, fontWeight: '800' },
  overview: { minHeight: 252, overflow: 'hidden', padding: Spacing.four, justifyContent: 'flex-end' }, overviewOrbit: { position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: StyleSheet.hairlineWidth, top: -92, right: -62, opacity: 0.35 }, overviewMonogram: { position: 'absolute', top: -30, right: 22, fontFamily: 'serif', fontSize: 142, lineHeight: 172, opacity: 0.1 }, overviewHeader: { position: 'absolute', top: Spacing.three, left: Spacing.four, right: Spacing.four, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, overviewEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.5 }, overviewEdit: { fontSize: 10, lineHeight: 15, fontWeight: '800' }, overviewTitle: { maxWidth: '78%', fontFamily: 'serif', fontSize: 32, lineHeight: 39, fontWeight: '600' }, overviewEra: { maxWidth: 600, marginTop: 7, fontSize: 12, lineHeight: 19 }, overviewRule: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.three }, overviewRules: { maxWidth: 650, fontSize: 10, lineHeight: 17 }, planningEntry: { minHeight: 84, borderWidth: 1, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three }, planningEntryCopy: { flex: 1, gap: 3 }, planningEntryEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.3 }, planningEntryTitle: { fontFamily: 'serif', fontSize: 20, lineHeight: 25, fontWeight: '600' }, planningEntryDescription: { fontSize: 10, lineHeight: 15 }, planningEntryArrow: { fontSize: 10, fontWeight: '900' },
  collectionSection: { gap: Spacing.three }, sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.three }, sectionHeadingCopy: { flex: 1, gap: 3 }, sectionIndex: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.35 }, sectionTitle: { fontFamily: 'serif', fontSize: 20, lineHeight: 26, fontWeight: '600' }, textAction: { paddingVertical: 5 }, textActionLabel: { fontSize: 10, lineHeight: 15, fontWeight: '800' }, collectionRail: { gap: Spacing.two, paddingRight: Spacing.four }, collectionTab: { width: 178, minHeight: 126, borderWidth: 1, padding: Spacing.three, gap: 7 }, collectionTabTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, collectionSerial: { fontFamily: 'monospace', fontSize: 9, lineHeight: 13, fontWeight: '800', letterSpacing: 0.8 }, collectionCount: { fontSize: 8, lineHeight: 12, fontWeight: '800' }, collectionName: { fontFamily: 'serif', fontSize: 18, lineHeight: 23, fontWeight: '600' }, collectionDescription: { fontSize: 9, lineHeight: 15 },
  ledger: { borderWidth: 1, padding: Spacing.four, gap: Spacing.four }, ledgerDesktop: { padding: Spacing.five, gap: Spacing.five }, ledgerHeader: { gap: Spacing.three }, ledgerTitleBlock: { maxWidth: 580, gap: 4 }, ledgerEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.4 }, ledgerTitle: { fontFamily: 'serif', fontSize: 30, lineHeight: 37, fontWeight: '600' }, ledgerDescription: { fontSize: 11, lineHeight: 17 }, ledgerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }, minorAction: { minHeight: 38, borderWidth: 1, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, minorActionText: { fontSize: 10, lineHeight: 14, fontWeight: '800' }, addAction: { minHeight: 38, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }, addActionText: { fontSize: 10, lineHeight: 14, fontWeight: '900' },
  emptyState: { minHeight: 200, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: 7 }, emptyGlyph: { fontSize: 26, lineHeight: 30 }, emptyTitle: { fontFamily: 'serif', fontSize: 20, lineHeight: 25, fontWeight: '600' }, emptyDescription: { maxWidth: 320, textAlign: 'center', fontSize: 10, lineHeight: 16 }, entryList: { gap: 0 }, entryRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.three, gap: Spacing.two }, entryMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three }, entryIndex: { width: 24, fontFamily: 'monospace', fontSize: 9, lineHeight: 16, fontWeight: '800' }, entryCopy: { flex: 1, minWidth: 0, gap: 5 }, entryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two }, entryTitle: { flex: 1, fontFamily: 'serif', fontSize: 17, lineHeight: 22, fontWeight: '600' }, entryTitleDesktop: { fontSize: 22, lineHeight: 28 }, entryType: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 0.7 }, entryContent: { fontSize: 11, lineHeight: 18 }, entryAliases: { fontSize: 8, lineHeight: 13, letterSpacing: 0.3 }, entryActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.three }, deleteText: { color: '#b54a3c', fontSize: 10, fontWeight: '800' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(18, 12, 9, 0.58)' }, modalSheet: { width: '100%', maxWidth: 760, maxHeight: '91%', alignSelf: 'center', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, paddingTop: Spacing.three }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.four, paddingBottom: Spacing.three }, modalEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.3 }, modalTitle: { fontFamily: 'serif', fontSize: 24, lineHeight: 30, fontWeight: '600' }, modalContent: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three }, field: { gap: Spacing.two }, fieldLabel: { fontSize: 11, lineHeight: 16, fontWeight: '800' }, fieldHelp: { fontSize: 9, lineHeight: 14 }, labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two }, fieldCounter: { fontFamily: 'monospace', fontSize: 8, lineHeight: 12 }, input: { borderWidth: 1, borderRadius: 12, minHeight: 46, paddingHorizontal: Spacing.three, fontSize: 15 }, multiline: { minHeight: 118, paddingVertical: Spacing.three, textAlignVertical: 'top' }, compactMultiline: { minHeight: 78, paddingVertical: Spacing.three, textAlignVertical: 'top' }, switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three }, pickerRail: { flexDirection: 'row', gap: Spacing.two, paddingRight: Spacing.four }, pickerOption: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 }, templateBlock: { gap: Spacing.two }, templateGrid: { gap: Spacing.two }, templateGridWide: { flexDirection: 'row' }, templateCard: { flex: 1, borderWidth: 1, padding: Spacing.three, gap: 5 }, templateTitle: { fontFamily: 'serif', fontSize: 18, lineHeight: 23, fontWeight: '600' }, templateDescription: { fontSize: 10, lineHeight: 16 }, templateMeta: { marginTop: Spacing.two, fontSize: 9, lineHeight: 13, fontWeight: '800' }, divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one }, primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, primaryButtonText: { fontSize: 11, lineHeight: 16, fontWeight: '900' }, secondaryButton: { minHeight: 46, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, secondaryButtonText: { fontSize: 11, lineHeight: 16, fontWeight: '800' }, pressed: { opacity: 0.7, transform: [{ scale: 0.99 }] },
});
