import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { WorkbenchPanel } from '@/components/novel-continue/WorkbenchPanel';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  dedupeCharactersInAnalysis,
  detectMisalignedStoryAnalysis,
  normalizeAnalysisEntityIds,
} from '@/services/novel-story-state';
import { useTavernStore } from '@/store/tavern-store';
import { showAppAlert } from '@/utils/app-alert';
import type {
  NovelCharacterRelationship,
  NovelHook,
  NovelPlotThread,
  NovelStoryAnalysis,
  NovelTimelineEvent,
} from '@/types/tavern';

type KnowledgeSection = 'characters' | 'hooks' | 'plots' | 'events';

const SECTIONS: { key: KnowledgeSection; label: string }[] = [
  { key: 'characters', label: '人物' },
  { key: 'hooks', label: '伏笔' },
  { key: 'plots', label: '剧情' },
  { key: 'events', label: '事件' },
];

const HOOK_STATUS_LABEL: Record<NovelHook['status'], string> = {
  open: '未回收',
  progressing: '推进中',
  deferred: '已搁置',
  resolved: '已回收',
};

const HOOK_IMPORTANCE_LABEL: Record<NovelHook['importance'], string> = {
  core: '核心',
  major: '重要',
  minor: '次要',
};

const PLOT_KIND_LABEL: Record<NovelPlotThread['kind'], string> = {
  main: '主线',
  sub: '支线',
  arc: '情感弧',
};

const TIMELINE_TYPE_LABEL: Record<NovelTimelineEvent['type'], string> = {
  timeline: '事件',
  location: '地点',
  faction: '势力',
  item: '物品',
  resource: '资源',
};

/**
 * 续写专属知识库（仪表盘）：四板块（人物 / 伏笔 / 剧情 / 事件）直接渲染
 * `novelStoryAnalysis`，不新增存储。人物详情支持「预写 SFW/NSFW 种子 +
 * 全文检索增强」回填外貌、性格等字段；修正认知请走「分析」tab 重新分析。
 */
export function KnowledgePanel({ novelId }: { novelId: string }) {
  const theme = useTheme();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const finalChapterCount = (novel?.chapters ?? []).filter((chapter) => chapter.status === 'final').length;
  // 展示层统一归一化：历史 bug 可能留下「同人不同 id」的重复人物与指向废弃 id 的状态；
  // 重新分析（存储层清理）之前，这里先按 name 合并，保证人物 / 状态 / 详情一致。
  const rawAnalysis = novel?.novelStoryAnalysis ?? null;
  const analysis = useMemo(
    () =>
      rawAnalysis
        ? normalizeAnalysisEntityIds(dedupeCharactersInAnalysis(rawAnalysis))
        : null,
    [rawAnalysis],
  );
  const [section, setSection] = useState<KnowledgeSection>('characters');
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedHookId, setSelectedHookId] = useState<string | null>(null);

  if (!analysis) {
    return (
      <WorkbenchPanel
        title="续写知识库"
        subtitle="人物 / 伏笔 / 剧情 / 事件，全部来自状态分析。">
        <ThemedText type="small" themeColor="textMuted">
          还没有状态分析。先在「分析」tab 完成一次增量分析，这里会自动展示全书的结构化信息。
        </ThemedText>
      </WorkbenchPanel>
    );
  }

  const selectedCharacter = analysis.characters.find((item) => item.id === selectedCharacterId) ?? null;
  const selectedHook = analysis.hooks.find((item) => item.id === selectedHookId) ?? null;

  return (
    <>
      <WorkbenchPanel
        title="续写知识库"
        subtitle={`由状态分析生成（第 ${analysis.lastAnalyzedChapter} 章，stateVersion ${analysis.stateVersion}）。人物支持从全文检索增强。`}>
        <View style={[styles.segmentRow, { backgroundColor: theme.backgroundElement }]}>
          {SECTIONS.map((item) => {
            const active = item.key === section;
            return (
              <Pressable
                key={item.key}
                onPress={() => setSection(item.key)}
                style={[styles.segmentItem, active && { backgroundColor: theme.surface, borderColor: theme.accent }]}>
                <ThemedText type="smallBold" themeColor={active ? 'accent' : 'textMuted'}>
                  {item.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {section === 'characters' ? (
          <CharacterSection analysis={analysis} onSelect={setSelectedCharacterId} />
        ) : null}
        {section === 'hooks' ? (
          <HookSection analysis={analysis} onSelect={setSelectedHookId} />
        ) : null}
        {section === 'plots' ? <PlotSection analysis={analysis} /> : null}
        {section === 'events' ? <EventSection analysis={analysis} totalChapters={finalChapterCount} /> : null}
      </WorkbenchPanel>

      <DetailModal
        visible={Boolean(selectedCharacter)}
        title={selectedCharacter ? `人物 · ${selectedCharacter.name}` : ''}
        onClose={() => setSelectedCharacterId(null)}>
        {selectedCharacter ? (
          <CharacterDetail analysis={analysis} novelId={novelId} characterId={selectedCharacter.id} />
        ) : null}
      </DetailModal>

      <DetailModal
        visible={Boolean(selectedHook)}
        title={selectedHook ? `伏笔 · ${selectedHook.keyword}` : ''}
        onClose={() => setSelectedHookId(null)}>
        {selectedHook ? <HookDetail analysis={analysis} hook={selectedHook} /> : null}
      </DetailModal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 人物
// ─────────────────────────────────────────────────────────────────────────────

function CharacterSection({
  analysis,
  onSelect,
}: {
  analysis: NovelStoryAnalysis;
  onSelect: (id: string) => void;
}) {
  const theme = useTheme();

  // 传入的 analysis 已在 KnowledgePanel 顶层做过去重归一化，这里直接渲染。
  if (analysis.characters.length === 0) {
    return <EmptyHint text="暂无人物信息。" />;
  }

  return (
    <View style={styles.section}>
      {analysis.characters.map((character) => {
        const state = analysis.characterStates.find(
          (item) => item.characterId === character.id,
        );
        const relationCount = analysis.relationships.filter(
          (item) => item.fromCharacter === character.name || item.toCharacter === character.name,
        ).length;
        return (
          <Pressable
            key={character.id}
            onPress={() => onSelect(character.id)}
            style={({ pressed }) => [
              styles.listCard,
              { backgroundColor: theme.backgroundElement, borderColor: theme.border },
              pressed && { opacity: 0.7 },
            ]}>
            <View style={styles.listRowHeader}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.listTitle}>
                {character.name}
              </ThemedText>
              <TagChip label={character.role || '角色'} />
            </View>
            <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
              {character.appearance || state?.currentState || character.profile || '（无档案描述）'}
            </ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              {relationCount > 0 ? `${relationCount} 条关系` : ''}
              {state?.goal ? `${relationCount > 0 ? ' · ' : ''}目标：${state.goal.slice(0, 30)}` : ''}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function CharacterDetail({
  analysis,
  novelId,
  characterId,
}: {
  analysis: NovelStoryAnalysis;
  novelId: string;
  characterId: string;
}) {
  const theme = useTheme();
  const character = analysis.characters.find((item) => item.id === characterId);
  const enrichNovelCharacters = useTavernStore((state) => state.enrichNovelCharacters);
  const updateNovelCharacterSeeds = useTavernStore((state) => state.updateNovelCharacterSeeds);
  const enrichJob = useTavernStore((state) =>
    state.novels
      .find((item) => item.id === novelId)
      ?.novelGenerationJobs?.find((job) => job.kind === 'enrich'),
  );
  const isEnriching = enrichJob?.status === 'running';
  const [showAllEvidence, setShowAllEvidence] = useState(false);

  if (!character) {
    return null;
  }
  const state = analysis.characterStates.find((item) => item.characterId === characterId);
  // analysis 已在顶层做过 id 归一化（normalizeAnalysisEntityIds），关系 id 唯一，直接过滤。
  const relations = analysis.relationships.filter(
    (item) => item.fromCharacter === character.name || item.toCharacter === character.name,
  );
  const evidence = character.evidence ?? [];
  const visibleEvidence = showAllEvidence ? evidence : evidence.slice(0, 2);

  // 角色卡档案字段：优先结构化字段，缺省回退到 characterStates（说话方式 / 动机）。
  const profileFields = [
    { label: '外貌', value: character.appearance ?? '' },
    { label: '性格', value: character.personality ?? '' },
    { label: '说话方式', value: character.speechStyle ?? state?.speakingStyle ?? '' },
    { label: '动机', value: character.motivation ?? state?.motive ?? '' },
    { label: '阵营 / 所属', value: character.affiliation ?? '' },
    { label: '背景', value: character.background ?? '' },
  ].filter((field) => field.value.trim().length > 0);

  const privacyRows =
    character.privacy
      ? [
          { label: '性器官', value: character.privacy.genitals ?? '' },
          { label: '胸部', value: character.privacy.chest ?? '' },
          { label: '敏感带', value: character.privacy.erogenousZones ?? '' },
          { label: '气味', value: character.privacy.scent ?? '' },
          { label: '性癖', value: character.privacy.xp ?? '' },
          { label: '自慰习惯', value: character.privacy.masturbationHabits ?? '' },
          { label: '禁忌', value: character.privacy.taboo ?? '' },
        ].filter((row) => row.value.trim().length > 0)
      : [];

  async function handleEnrich() {
    if (isEnriching) {
      return;
    }
    try {
      await enrichNovelCharacters(novelId);
      showAppAlert('增强完成', '已从全文检索并回填角色档案。');
    } catch (error) {
      showAppAlert('增强失败', error instanceof Error ? error.message : '角色档案增强失败。');
    }
  }

  return (
    <View style={styles.detailBody}>
      {/* 角色卡头部 */}
      <View
        style={[styles.charCardHeader, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <View style={styles.charCardTitleRow}>
          <ThemedText type="subtitle" numberOfLines={1} style={styles.charCardName}>
            {character.name}
          </ThemedText>
          <TagChip label={character.role || '角色'} />
        </View>
        <ThemedText type="small" themeColor="textMuted">
          {[
            state?.atChapter ? `状态截至第 ${state.atChapter} 章` : '',
            relations.length > 0 ? `${relations.length} 条关系` : '',
          ]
            .filter(Boolean)
            .join(' · ') || '暂无摘要'}
        </ThemedText>
      </View>

      {/* 人物档案 */}
      {profileFields.length > 0 || character.profile.trim() ? (
        <>
          <RoleCardSection title="人物档案" />
          {profileFields.map((field) => (
            <FieldRow key={field.label} label={field.label} value={field.value} />
          ))}
          {profileFields.length === 0 && character.profile.trim() ? (
            <RoleCardField value={character.profile} />
          ) : null}
        </>
      ) : null}

      {/* 人物关系 */}
      <RoleCardSection title="人物关系" badge={`${relations.length}`} />
      {relations.length === 0 ? (
        <ThemedText type="small" themeColor="textMuted">
          暂无关系记录。
        </ThemedText>
      ) : (
        relations.map((relation) => (
          <RelationRow
            key={relation.id || `${relation.fromCharacter}→${relation.toCharacter}`}
            relation={relation}
            selfName={character.name}
          />
        ))
      )}

      {/* 原文证据 */}
      {evidence.length > 0 ? (
        <>
          <RoleCardSection title="原文证据" badge={`${evidence.length}`} />
          {visibleEvidence.map((item, index) => (
            <RoleCardField key={index} value={item} />
          ))}
          {evidence.length > 2 ? (
            <Pressable onPress={() => setShowAllEvidence((value) => !value)} hitSlop={8}>
              <ThemedText type="small" themeColor="accent">
                {showAllEvidence ? '收起' : `查看全部 ${evidence.length} 条`}
              </ThemedText>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {/* NSFW 隐私档案 */}
      {privacyRows.length > 0 ? (
        <>
          <RoleCardSection title="私密档案" />
          {privacyRows.map((row) => (
            <FieldRow key={row.label} label={row.label} value={row.value} />
          ))}
        </>
      ) : null}

      {/* 当前状态与信息边界 */}
      {state ? (
        <>
          <RoleCardSection title="当前状态" />
          {state.currentState ? <RoleCardField value={state.currentState} /> : null}
          {state.goal ? <FieldRow label="目标" value={state.goal} /> : null}
          <RoleCardSection title="信息边界" />
          <FieldRow label="知道" value={state.knows.length > 0 ? state.knows.join('、') : '（无）'} />
          <FieldRow label="不知道" value={state.unknown.length > 0 ? state.unknown.join('、') : '（无）'} />
        </>
      ) : null}

      {/* 全文检索增强 */}
      <View style={[styles.seedCard, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
        <ThemedText type="smallBold">全文检索增强</ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          预写想强调的 SFW / NSFW 内容作为种子，系统会在全书中找到对应描写，回填外貌、性格、说话方式、背景与原文证据。
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted">SFW 预写</ThemedText>
        <TextInput
          value={character.sfwSeed ?? ''}
          onChangeText={(text) => updateNovelCharacterSeeds(novelId, characterId, { sfwSeed: text })}
          placeholder="如：青衫、剑眉、清冷疏离…"
          placeholderTextColor={theme.textMuted}
          multiline
          style={[
            styles.seedInput,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
          ]}
        />
        <ThemedText type="small" themeColor="textMuted">私密预写</ThemedText>
        <TextInput
          value={character.nsfwSeed ?? ''}
          onChangeText={(text) => updateNovelCharacterSeeds(novelId, characterId, { nsfwSeed: text })}
          placeholder="如：腰腹线条、敏感带、隐私描写…"
          placeholderTextColor={theme.textMuted}
          multiline
          style={[
            styles.seedInput,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text },
          ]}
        />
        <Pressable
          disabled={isEnriching}
          onPress={() => void handleEnrich()}
          style={({ pressed }) => [
            styles.enrichButton,
            { backgroundColor: theme.accent },
            (isEnriching || pressed) && { opacity: 0.6 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.surface }}>
            {isEnriching ? '增强中…' : '从全文检索增强'}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/** 角色卡分区标题：accent 竖条 + 标题 + 可选徽标。 */
function RoleCardSection({ title, badge }: { title: string; badge?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.roleCardSection}>
      <View style={[styles.roleCardSectionBar, { backgroundColor: theme.accent }]} />
      <ThemedText type="smallBold">{title}</ThemedText>
      {badge ? (
        <ThemedText type="small" themeColor="textMuted">
          {badge}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** 角色卡字段行：小标签在上、内容在下。 */
function FieldRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.roleCardField, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  );
}

/** 角色卡字段块：无标签的纯内容。 */
function RoleCardField({ value }: { value: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.roleCardField, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  );
}

function RelationRow({ relation, selfName }: { relation: NovelCharacterRelationship; selfName: string }) {
  const theme = useTheme();
  const other = relation.fromCharacter === selfName ? relation.toCharacter : relation.fromCharacter;
  return (
    <View style={[styles.relationCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="smallBold">
        {other} · {relation.relation}
      </ThemedText>
      {relation.description ? (
        <ThemedText type="small" themeColor="textMuted">
          {relation.description}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textMuted">
        记录于第 {relation.atChapter} 章
      </ThemedText>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 伏笔
// ─────────────────────────────────────────────────────────────────────────────

function HookSection({
  analysis,
  onSelect,
}: {
  analysis: NovelStoryAnalysis;
  onSelect: (id: string) => void;
}) {
  const theme = useTheme();
  const openHooks = analysis.hooks.filter((hook) => hook.status !== 'resolved');
  const resolvedHooks = analysis.hooks.filter((hook) => hook.status === 'resolved');

  const sortOpen = (a: NovelHook, b: NovelHook) => {
    const weight: Record<NovelHook['importance'], number> = { core: 0, major: 1, minor: 2 };
    return weight[a.importance] - weight[b.importance];
  };

  if (analysis.hooks.length === 0) {
    return <EmptyHint text="暂无伏笔记录。" />;
  }

  return (
    <View style={styles.section}>
      {openHooks.length > 0 ? (
        <>
          <ThemedText type="smallBold">未回收（{openHooks.length}）</ThemedText>
          {[...openHooks].sort(sortOpen).map((hook) => (
            <Pressable
              key={hook.id}
              onPress={() => onSelect(hook.id)}
              style={({ pressed }) => [
                styles.listCard,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                pressed && { opacity: 0.7 },
              ]}>
              <View style={styles.listRowHeader}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.listTitle}>
                  {hook.keyword}
                </ThemedText>
                <View style={styles.tagGroup}>
                  <TagChip label={HOOK_STATUS_LABEL[hook.status]} />
                  <TagChip label={HOOK_IMPORTANCE_LABEL[hook.importance]} />
                </View>
              </View>
              <ThemedText type="small" themeColor="textMuted" numberOfLines={2}>
                {hook.description}
              </ThemedText>
              <ThemedText type="small" themeColor="textMuted">
                埋于第 {hook.startChapter} 章 · 最近推进第 {hook.lastAdvancedChapter} 章
              </ThemedText>
            </Pressable>
          ))}
        </>
      ) : null}

      {resolvedHooks.length > 0 ? (
        <>
          <ThemedText type="smallBold">已回收（{resolvedHooks.length}）</ThemedText>
          {resolvedHooks.map((hook) => (
            <Pressable
              key={hook.id}
              onPress={() => onSelect(hook.id)}
              style={({ pressed }) => [
                styles.listCard,
                { backgroundColor: theme.backgroundSelected, borderColor: theme.border },
                pressed && { opacity: 0.7 },
              ]}>
              <View style={styles.listRowHeader}>
                <ThemedText type="small" themeColor="textMuted" numberOfLines={1} style={styles.listTitle}>
                  {hook.keyword}
                </ThemedText>
                <TagChip label="已回收" />
              </View>
              <ThemedText type="small" themeColor="textMuted">
                第 {hook.resolvedChapter ?? '?'} 章回收
              </ThemedText>
            </Pressable>
          ))}
        </>
      ) : null}
    </View>
  );
}

function HookDetail({ analysis, hook }: { analysis: NovelStoryAnalysis; hook: NovelHook }) {
  const dependsOnKeywords = hook.dependsOn
    .map((id) => analysis.hooks.find((item) => item.id === id)?.keyword)
    .filter((value): value is string => Boolean(value));

  return (
    <View style={styles.detailBody}>
      <View style={styles.detailMetaRow}>
        <TagChip label={HOOK_STATUS_LABEL[hook.status]} />
        <TagChip label={HOOK_IMPORTANCE_LABEL[hook.importance]} />
        {hook.type ? <TagChip label={hook.type} /> : null}
      </View>

      <LabeledBlock label="描述" text={hook.description || '（无）'} />
      <LabeledBlock label="预期回收" text={hook.expectedPayoff || '（未描述）'} />
      <View style={styles.infoBoundary}>
        <ThemedText type="small">埋于第 {hook.startChapter} 章</ThemedText>
        <ThemedText type="small">最近推进第 {hook.lastAdvancedChapter} 章</ThemedText>
        {hook.resolvedChapter ? <ThemedText type="small">回收于第 {hook.resolvedChapter} 章</ThemedText> : null}
      </View>

      {dependsOnKeywords.length > 0 ? (
        <LabeledBlock label="依赖伏笔" text={dependsOnKeywords.join('、')} />
      ) : null}

      {hook.supportingEvidence.length > 0 ? (
        <LabeledBlock label="原文证据" text={hook.supportingEvidence.join('\n')} />
      ) : null}

      {hook.note ? <LabeledBlock label="备注" text={hook.note} /> : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 剧情线
// ─────────────────────────────────────────────────────────────────────────────

function PlotSection({ analysis }: { analysis: NovelStoryAnalysis }) {
  const theme = useTheme();

  if (analysis.plotThreads.length === 0) {
    return <EmptyHint text="暂无剧情线记录。" />;
  }

  return (
    <View style={styles.section}>
      {analysis.plotThreads.map((thread) => (
        <View
          key={thread.id}
          style={[styles.listCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.listRowHeader}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.listTitle}>
              {thread.title}
            </ThemedText>
            <TagChip label={PLOT_KIND_LABEL[thread.kind] ?? thread.kind} />
          </View>
          <ThemedText type="small" themeColor="textMuted">
            {thread.description}
          </ThemedText>
          <View style={[styles.progressBlock, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
            <ThemedText type="smallBold">当前进度</ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              {thread.progress || '（未推进）'}
            </ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              起于第 {thread.startChapter} 章
            </ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 事件
// ─────────────────────────────────────────────────────────────────────────────

function EventSection({
  analysis,
  totalChapters,
}: {
  analysis: NovelStoryAnalysis;
  totalChapters: number;
}) {
  const theme = useTheme();
  const misaligned = useMemo(
    () => detectMisalignedStoryAnalysis(analysis, totalChapters),
    [analysis, totalChapters],
  );
  const timeline = useMemo(
    () => [...analysis.timeline].sort((a, b) => a.chapter - b.chapter),
    [analysis.timeline],
  );
  const summaries = useMemo(
    () => [...analysis.chapterSummaries].sort((a, b) => a.chapter - b.chapter),
    [analysis.chapterSummaries],
  );

  return (
    <View style={styles.section}>
      {misaligned ? (
        <View style={[styles.warningCard, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
          <ThemedText type="smallBold" themeColor="accent">
            章节编号异常
          </ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            检测到章节摘要编号被整体推高（例如全书 {totalChapters} 章，却记录了 {summaries.length} 条），会导致续写上下文引用错误的章节号。
            请到「分析」tab 重新运行一次状态分析，系统会自动重置错位数据并重新生成。
          </ThemedText>
        </View>
      ) : null}

      {summaries.length > 0 ? (
        <>
          <ThemedText type="smallBold">章节摘要</ThemedText>
          {summaries.map((row) => (
            <View
              key={row.chapter}
              style={[styles.listCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText type="smallBold">
                第 {row.chapter} 章 {row.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textMuted">
                {row.events}
              </ThemedText>
              {row.stateChanges ? (
                <ThemedText type="small" themeColor="textMuted">
                  章末：{row.stateChanges}
                </ThemedText>
              ) : null}
              {row.hookActivity ? (
                <ThemedText type="small" themeColor="textMuted">
                  伏笔：{row.hookActivity}
                </ThemedText>
              ) : null}
              {row.mood ? <TagChip label={`基调 ${row.mood}`} /> : null}
            </View>
          ))}
        </>
      ) : null}

      {timeline.length > 0 ? (
        <>
          <ThemedText type="smallBold">时间线（{timeline.length}）</ThemedText>
          {timeline.map((event) => (
            <View
              key={event.id}
              style={[styles.listCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <View style={styles.listRowHeader}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.listTitle}>
                  {event.subject}
                </ThemedText>
                <View style={styles.tagGroup}>
                  <TagChip label={TIMELINE_TYPE_LABEL[event.type] ?? event.type} />
                  <TagChip label={`第${event.chapter}章`} />
                </View>
              </View>
              <ThemedText type="small" themeColor="textMuted">
                {event.event}
              </ThemedText>
            </View>
          ))}
        </>
      ) : null}

      {timeline.length === 0 && summaries.length === 0 ? (
        <EmptyHint text="暂无事件记录。" />
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 通用小件
// ─────────────────────────────────────────────────────────────────────────────

function EmptyHint({ text }: { text: string }) {
  return (
    <ThemedText type="small" themeColor="textMuted">
      {text}
    </ThemedText>
  );
}

function TagChip({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tagChip, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
    </View>
  );
}

function LabeledBlock({ label, text }: { label: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.labeledBlock, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        {text}
      </ThemedText>
    </View>
  );
}

function DetailModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={[styles.modalOverlay, { backgroundColor: theme.scrim }]}>
        <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.modalHeader}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.modalTitle}>
              {title}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={10}>
              <ThemedText style={{ color: theme.textMuted }}>✕</ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  segmentRow: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: 3,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  listCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
  listRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  listTitle: {
    flex: 1,
  },
  tagGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
  },
  tagChip: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  relationCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 2,
  },
  progressBlock: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 2,
  },
  infoBoundary: {
    borderRadius: 12,
    gap: 2,
  },
  labeledBlock: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
  detailBody: {
    gap: Spacing.two,
  },
  detailMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  charCardHeader: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: 6,
  },
  charCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  charCardName: {
    flex: 1,
    fontSize: 20,
    lineHeight: 28,
  },
  roleCardSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  roleCardSectionBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
  },
  roleCardField: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 2,
  },
  seedCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 6,
  },
  warningCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
  seedInput: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 44,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  enrichButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
  },
  modalBody: {
    gap: Spacing.two,
  },
});
