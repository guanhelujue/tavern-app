import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DraftTextInput } from '@/components/ui/DraftTextInput';
import { Spacing } from '@/constants/theme';
import {
  diagnoseCharacterRelations,
  filterCharacterLibrary,
  normalizeCharacterWorkspace,
  setCharacterTags,
  syncDynamicRelationToCard,
  upsertCharacterArc,
  type CharacterLibraryFilter,
} from '@/features/character-operations/model';
import { useTheme } from '@/hooks/use-theme';
import { showAppAlert } from '@/utils/app-alert';
import type {
  Novel,
  NovelCastCharacter,
  NovelCharacterDossier,
  NovelCharacterState,
  NovelCharacterWorkspace,
} from '@/types/tavern';

type Tab = 'library' | 'relations' | 'state' | 'candidates' | 'arcs';
type CandidateSource = 'current-reply' | 'current-chapter' | 'all-text';

type Props = {
  visible: boolean;
  novel: Novel;
  cast: NovelCastCharacter[];
  dossiers: NovelCharacterDossier[];
  onClose: () => void;
  onUpdateCast: (cast: NovelCastCharacter[]) => void;
  onUpdateDossiers: (dossiers: NovelCharacterDossier[]) => void;
  onUpdateWorkspace: (workspace: NovelCharacterWorkspace) => void;
  onUpdateCharacterStates: (states: NovelCharacterState[]) => void;
  isOrganizingRelations: boolean;
  onOrganizeRelations: () => Promise<void>;
  onMergeCharacters: (primaryId: string, secondaryId: string) => void;
  onDiscoverCandidates: (source: CandidateSource) => Promise<NovelCastCharacter[]>;
  onEditCandidate: (candidate: NovelCastCharacter) => void;
};

const TABS: { id: Tab; label: string; caption: string }[] = [
  { id: 'library', label: '档案室', caption: '检索与批量' },
  { id: 'relations', label: '关系', caption: '冲突与同步' },
  { id: 'state', label: '剧情态', caption: '现在发生什么' },
  { id: 'candidates', label: '候选箱', caption: '从正文发现' },
  { id: 'arcs', label: '人物弧', caption: '未来如何变化' },
];

const FILTERS: { id: CharacterLibraryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'protagonist', label: '主角' },
  { id: 'supporting', label: '配角' },
  { id: 'enabled', label: '启用' },
  { id: 'disabled', label: '停用' },
];

function splitList(value: string) {
  return value.split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean);
}

function Input({ label, value, onChangeText, multiline = false, placeholder, preserveDraft = false }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  preserveDraft?: boolean;
}) {
  const theme = useTheme();
  const InputComponent = preserveDraft ? DraftTextInput : TextInput;
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{label}</Text>
      <InputComponent
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
        ]}
      />
    </View>
  );
}

export function CharacterOperationsModal({
  visible,
  novel,
  cast,
  dossiers,
  onClose,
  onUpdateCast,
  onUpdateDossiers,
  onUpdateWorkspace,
  onUpdateCharacterStates,
  isOrganizingRelations,
  onOrganizeRelations,
  onMergeCharacters,
  onDiscoverCandidates,
  onEditCandidate,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CharacterLibraryFilter>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkTags, setBulkTags] = useState('');
  const [workspace, setWorkspace] = useState(() => normalizeCharacterWorkspace(novel.characterWorkspace));
  const [activeCharacterId, setActiveCharacterId] = useState(cast[0]?.id ?? '');
  const [characterSearch, setCharacterSearch] = useState('');
  const [stateDraft, setStateDraft] = useState<NovelCharacterState | null>(() => {
    const characterId = cast[0]?.id;
    if (!characterId) return null;
    return novel.novelStoryAnalysis?.characterStates.find((item) => item.characterId === characterId) ?? {
      characterId,
      currentState: '',
      goal: '',
      motive: '',
      speakingStyle: '',
      knows: [],
      unknown: [],
      atChapter: novel.novelStoryAnalysis?.lastAnalyzedChapter ?? 0,
    };
  });
  const [arcDraft, setArcDraft] = useState<NovelCharacterWorkspace['arcs'][number] | null>(() => {
    const characterId = cast[0]?.id;
    if (!characterId) return null;
    return normalizeCharacterWorkspace(novel.characterWorkspace).arcs.find((item) => item.characterId === characterId) ?? {
      characterId,
      startingPoint: '',
      stageGoal: '',
      keyTurn: '',
      progress: '',
      nextMove: '',
      status: 'planned',
      updatedAt: new Date().toISOString(),
    };
  });
  const [candidates, setCandidates] = useState<NovelCastCharacter[]>([]);
  const [candidateBusy, setCandidateBusy] = useState<CandidateSource | null>(null);
  const [relationFromId, setRelationFromId] = useState(cast[0]?.id ?? '');
  const [relationTargetName, setRelationTargetName] = useState('');
  const [relationLabel, setRelationLabel] = useState('');
  const [relationNote, setRelationNote] = useState('');

  const filtered = useMemo(() => filterCharacterLibrary(
    dossiers,
    cast,
    workspace,
    query,
    filter,
    tagFilter || undefined,
  ), [cast, dossiers, filter, query, tagFilter, workspace]);
  const allTags = useMemo(() => [...new Set(Object.values(workspace.tagsByCharacterId).flat())].sort(), [workspace]);
  const relationIssues = useMemo(() => diagnoseCharacterRelations(
    cast,
    novel.novelStoryAnalysis?.relationships ?? [],
  ), [cast, novel.novelStoryAnalysis?.relationships]);
  const matchingCharacters = useMemo(() => {
    const needle = characterSearch.trim().toLocaleLowerCase();
    return cast.filter((character) => !needle || [character.name, character.profession, ...(character.aliases ?? [])]
      .some((value) => value.toLocaleLowerCase().includes(needle))).slice(0, 30);
  }, [cast, characterSearch]);
  const activeCharacter = cast.find((item) => item.id === activeCharacterId);

  function commitWorkspace(next: NovelCharacterWorkspace) {
    setWorkspace(next);
    onUpdateWorkspace(next);
  }

  function toggleSelected(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function bulkSetEnabled(enabled: boolean) {
    const selectedSet = new Set(selected);
    onUpdateDossiers(dossiers.map((dossier) => dossier.castId && selectedSet.has(dossier.castId)
      ? { ...dossier, enabled, updatedAt: new Date().toISOString() }
      : dossier));
  }

  function chooseCharacter(characterId: string, destination: 'state' | 'arcs') {
    setActiveCharacterId(characterId);
    if (destination === 'state') {
      const current = novel.novelStoryAnalysis?.characterStates.find((item) => item.characterId === characterId);
      setStateDraft(current ?? {
        characterId,
        currentState: '',
        goal: '',
        motive: '',
        speakingStyle: '',
        knows: [],
        unknown: [],
        atChapter: novel.novelStoryAnalysis?.lastAnalyzedChapter ?? 0,
      });
    } else {
      setArcDraft(workspace.arcs.find((item) => item.characterId === characterId) ?? {
        characterId,
        startingPoint: '',
        stageGoal: '',
        keyTurn: '',
        progress: '',
        nextMove: '',
        status: 'planned',
        updatedAt: new Date().toISOString(),
      });
    }
    setTab(destination);
  }

  async function discover(source: CandidateSource) {
    if (candidateBusy) return;
    setCandidateBusy(source);
    try {
      const found = await onDiscoverCandidates(source);
      const existing = new Set(cast.flatMap((item) => [item.name, ...(item.aliases ?? [])]).map((name) => name.trim().toLocaleLowerCase()));
      const fresh = found.filter((item) => item.name.trim() && !existing.has(item.name.trim().toLocaleLowerCase()));
      setCandidates(fresh);
      if (!fresh.length) {
        showAppAlert('没有新候选', '所选正文范围中没有发现可建立人物卡的新角色。');
      }
    } catch (error) {
      showAppAlert('候选提取失败', error instanceof Error ? error.message : '无法从正文提取人物候选。');
    } finally {
      setCandidateBusy(null);
    }
  }

  function saveInitialRelation() {
    const source = cast.find((item) => item.id === relationFromId);
    const targetName = relationTargetName.trim();
    const label = relationLabel.trim();
    if (!source || !targetName || !label) {
      showAppAlert('关系未填写完整', '请选择起点人物，并填写对象和关系称谓。');
      return;
    }
    const normalizedTarget = targetName.toLocaleLowerCase();
    const target = cast.find((item) => [item.name, ...(item.aliases ?? [])]
      .some((name) => name.trim().toLocaleLowerCase() === normalizedTarget));
    const relations = [...(source.relations ?? [])];
    const existing = relations.findIndex((relation) => (
      target?.id
        ? relation.targetCastId === target.id
        : relation.targetName.trim().toLocaleLowerCase() === normalizedTarget
    ));
    const nextRelation = {
      id: existing >= 0 ? relations[existing]!.id : `relation-${Date.now()}`,
      targetName: target?.name ?? targetName,
      targetCastId: target?.id,
      label,
      note: relationNote.trim() || undefined,
      source: 'manual' as const,
      updatedAt: Date.now(),
    };
    if (existing >= 0) relations[existing] = nextRelation;
    else relations.push(nextRelation);
    onUpdateCast(cast.map((character) => character.id === source.id ? { ...character, relations } : character));
    setRelationTargetName('');
    setRelationLabel('');
    setRelationNote('');
  }

  function removeInitialRelation(sourceId: string, relationId: string) {
    onUpdateCast(cast.map((character) => character.id === sourceId
      ? { ...character, relations: (character.relations ?? []).filter((relation) => relation.id !== relationId) }
      : character));
  }

  const characterPicker = (
    <View style={styles.pickerBlock}>
      <Input label="查找人物" value={characterSearch} onChangeText={setCharacterSearch} placeholder="姓名、别名或职业" />
      <View style={styles.chipWrap}>
        {matchingCharacters.map((character) => (
          <Pressable
            key={character.id}
            onPress={() => chooseCharacter(character.id, tab === 'arcs' ? 'arcs' : 'state')}
            style={[styles.chip, { borderColor: character.id === activeCharacterId ? theme.accent : theme.border }]}>
            <Text style={{ color: character.id === activeCharacterId ? theme.accent : theme.text }}>{character.name || '未命名'}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: Math.max(insets.top, Spacing.two) }]}>
        <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.two) }]}>
          <View style={[styles.header, compact && styles.headerCompact, { borderBottomColor: theme.border }]}>
            <View style={styles.headingCopy}>
              <Text style={[styles.eyebrow, { color: theme.accent }]}>CHARACTER OPERATIONS</Text>
              <Text style={[styles.title, { color: theme.text }]}>人物运营中心</Text>
              <Text style={[styles.subtitle, { color: theme.textMuted }]}>稳定档案、剧情当前态和未来规划各走自己的轨道。</Text>
            </View>
            <Pressable onPress={onClose} style={[styles.close, { borderColor: theme.border }]}><Text style={[styles.closeText, { color: theme.accent }]}>×</Text></Pressable>
          </View>
          <ScrollView
            horizontal
            style={styles.tabsViewport}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.tabs, { borderBottomColor: theme.border }]}>
            {TABS.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === item.id }}
                onPress={() => setTab(item.id)}
                style={[styles.tab, tab === item.id && { backgroundColor: theme.accent }]}>
                <Text style={[styles.tabIndex, { color: tab === item.id ? theme.background : theme.accent }]}>{String(index + 1).padStart(2, '0')}</Text>
                <View><Text style={[styles.tabLabel, { color: tab === item.id ? theme.background : theme.text }]}>{item.label}</Text><Text style={[styles.tabCaption, { color: tab === item.id ? theme.background : theme.textMuted }]}>{item.caption}</Text></View>
              </Pressable>
            ))}
          </ScrollView>

          {tab === 'library' ? (
            <View style={styles.flexBody}>
              <View style={[styles.toolbar, { borderBottomColor: theme.border }]}>
                <TextInput value={query} onChangeText={setQuery} placeholder="搜索姓名、别名、职业、所属或标签" placeholderTextColor={theme.textMuted} style={[styles.search, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]} />
                <View style={styles.chipWrap}>{FILTERS.map((item) => <Pressable key={item.id} onPress={() => setFilter(item.id)} style={[styles.filterChip, { borderColor: filter === item.id ? theme.accent : theme.border }]}><Text style={{ color: filter === item.id ? theme.accent : theme.textMuted }}>{item.label}</Text></Pressable>)}</View>
                {allTags.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipWrap}><Pressable onPress={() => setTagFilter('')}><Text style={{ color: !tagFilter ? theme.accent : theme.textMuted }}>全部标签</Text></Pressable>{allTags.map((tag) => <Pressable key={tag} onPress={() => setTagFilter(tag)}><Text style={{ color: tagFilter === tag ? theme.accent : theme.textMuted }}>#{tag}</Text></Pressable>)}</ScrollView> : null}
                {selected.length ? <View style={styles.bulkRow}><TextInput value={bulkTags} onChangeText={setBulkTags} placeholder="标签，用逗号分隔" placeholderTextColor={theme.textMuted} style={[styles.bulkInput, { color: theme.text, borderColor: theme.border }]} /><Pressable onPress={() => commitWorkspace(setCharacterTags(workspace, selected, splitList(bulkTags)))} style={[styles.smallAction, { backgroundColor: theme.accent }]}><Text style={{ color: theme.background }}>应用标签</Text></Pressable><Pressable onPress={() => bulkSetEnabled(true)}><Text style={{ color: theme.accent }}>启用</Text></Pressable><Pressable onPress={() => bulkSetEnabled(false)}><Text style={{ color: theme.textMuted }}>停用</Text></Pressable></View> : null}
              </View>
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                initialNumToRender={18}
                windowSize={7}
                removeClippedSubviews
                ListEmptyComponent={<Text style={[styles.empty, { color: theme.textMuted }]}>没有符合条件的人物。</Text>}
                renderItem={({ item }) => {
                  const character = item.castId ? cast.find((entry) => entry.id === item.castId) : cast.find((entry) => entry.name === item.name);
                  const id = character?.id ?? '';
                  const checked = selected.includes(id);
                  return <View style={[styles.rowCard, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}><Pressable disabled={!id} onPress={() => toggleSelected(id)} style={[styles.check, { borderColor: theme.accent, backgroundColor: checked ? theme.accent : 'transparent' }]}><Text style={{ color: theme.background }}>{checked ? '✓' : ''}</Text></Pressable><View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: theme.text }]}>{item.name || '未命名'}</Text><Text style={[styles.rowMeta, { color: theme.textMuted }]}>{[character?.profession, character?.affiliation, ...(id ? workspace.tagsByCharacterId[id] ?? [] : []).map((tag) => `#${tag}`)].filter(Boolean).join(' · ') || '暂无分类'}</Text></View>{id ? <><Pressable onPress={() => chooseCharacter(id, 'state')}><Text style={{ color: theme.accent }}>剧情态</Text></Pressable><Pressable onPress={() => chooseCharacter(id, 'arcs')}><Text style={{ color: theme.accent }}>人物弧</Text></Pressable></> : null}<Text style={{ color: item.enabled === false ? theme.textMuted : theme.accent }}>{item.enabled === false ? '停用' : '启用'}</Text></View>;
                }}
              />
            </View>
          ) : null}

          {tab === 'relations' ? (
            <ScrollView style={styles.flexBody} contentContainerStyle={styles.scrollBody}>
              <View style={styles.sectionLead}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>全局关系体检</Text>
                <Text style={[styles.sectionCopy, { color: theme.textMuted }]}>剧情关系永远覆盖初始关系；同步和人物合并只在你点击后发生。</Text>
              </View>
              <Pressable
                disabled={isOrganizingRelations}
                onPress={() => void onOrganizeRelations()}
                accessibilityRole="button"
                accessibilityLabel="AI 整理全库人物关系"
                style={({ pressed }) => [
                  styles.relationAutomation,
                  { borderColor: theme.accent, backgroundColor: theme.backgroundElement },
                  (pressed || isOrganizingRelations) && { opacity: 0.62 },
                ]}>
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowTitle, { color: theme.accent }]}>
                    {isOrganizingRelations ? '正在整理全库关系…' : 'AI 整理全库关系'}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.textMuted }]}>补全互相绑定、宿舍、班级与团队关系；手工关系优先保留。</Text>
                </View>
                <Text style={[styles.relationAutomationArrow, { color: theme.accent }]}>↗</Text>
              </Pressable>
              {relationIssues.length ? relationIssues.map((issue) => (
                <View key={issue.id} style={[styles.issue, { borderColor: issue.severity === 'warning' ? '#b94a43' : theme.border }]}>
                  <Text style={{ color: theme.text }}>{issue.message}</Text>
                  {issue.kind === 'identity' && issue.characterIds.length === 2 ? (
                    <Pressable onPress={() => onMergeCharacters(issue.characterIds[0]!, issue.characterIds[1]!)} style={[styles.issueAction, { borderColor: theme.accent }]}>
                      <Text style={{ color: theme.accent }}>保留前者并合并后者</Text>
                    </Pressable>
                  ) : null}
                </View>
              )) : <Text style={[styles.empty, { color: theme.textMuted }]}>没有发现悬空、重复或身份冲突。</Text>}

              <Text style={[styles.subheading, { color: theme.text }]}>编辑初始关系</Text>
              <Text style={[styles.sectionCopy, { color: theme.textMuted }]}>只维护人物卡里的稳定关系。对象若已建档，输入姓名或别名会自动绑定；也允许记录尚未建档的人。</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipWrap}>
                {cast.slice(0, 40).map((character) => (
                  <Pressable
                    key={character.id}
                    onPress={() => setRelationFromId(character.id)}
                    style={[styles.chip, { borderColor: relationFromId === character.id ? theme.accent : theme.border }]}>
                    <Text style={{ color: relationFromId === character.id ? theme.accent : theme.text }}>{character.name || '未命名'}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.relationEditor}>
                <Input label="关系对象" value={relationTargetName} onChangeText={setRelationTargetName} placeholder="姓名或别名" />
                <Input label="关系称谓" value={relationLabel} onChangeText={setRelationLabel} placeholder="室友、宿敌、师生……" />
                <Input label="关系备注" value={relationNote} onChangeText={setRelationNote} placeholder="一句话说明当前状态" />
                <Pressable onPress={saveInitialRelation} style={[styles.primaryAction, { backgroundColor: theme.accent }]}>
                  <Text style={{ color: theme.background, fontWeight: '800' }}>保存初始关系</Text>
                </Pressable>
              </View>
              {(cast.find((item) => item.id === relationFromId)?.relations ?? []).map((relation) => (
                <View key={relation.id} style={[styles.rowCard, { borderColor: theme.border }]}>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{relation.targetName} · {relation.label}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{relation.note || '暂无关系备注'}</Text>
                  </View>
                  <Pressable onPress={() => removeInitialRelation(relationFromId, relation.id)}>
                    <Text style={{ color: '#b94a43' }}>删除</Text>
                  </Pressable>
                </View>
              ))}

              <Text style={[styles.subheading, { color: theme.text }]}>剧情当前关系</Text>
              {(novel.novelStoryAnalysis?.relationships ?? []).filter((item) => !item.stale).map((relation) => (
                <View key={relation.id} style={[styles.rowCard, { borderColor: theme.border }]}>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: theme.text }]}>{relation.fromCharacter} → {relation.toCharacter} · {relation.relation}</Text>
                    <Text style={[styles.rowMeta, { color: theme.textMuted }]}>{relation.description || `第 ${relation.atChapter} 章`}</Text>
                  </View>
                  <Pressable onPress={() => onUpdateCast(syncDynamicRelationToCard(cast, relation))}>
                    <Text style={{ color: theme.accent }}>同步回人物卡</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {tab === 'state' ? <ScrollView style={styles.flexBody} contentContainerStyle={styles.scrollBody}>{characterPicker}{activeCharacter ? <View style={styles.editorBlock}><Text style={[styles.subheading, { color: theme.text }]}>{activeCharacter.name} · 当前剧情态</Text><Input label="当前状态（位置、服装、伤病、情绪可合并）" value={stateDraft?.currentState ?? ''} onChangeText={(currentState) => setStateDraft((value) => value ? { ...value, currentState } : value)} multiline /><Input label="当前目标" value={stateDraft?.goal ?? ''} onChangeText={(goal) => setStateDraft((value) => value ? { ...value, goal } : value)} /><Input label="当前动机" value={stateDraft?.motive ?? ''} onChangeText={(motive) => setStateDraft((value) => value ? { ...value, motive } : value)} /><Input label="当前说话状态" value={stateDraft?.speakingStyle ?? ''} onChangeText={(speakingStyle) => setStateDraft((value) => value ? { ...value, speakingStyle } : value)} /><Input key={activeCharacter.id + ':knows'} preserveDraft label="已知信息（逗号分隔）" value={(stateDraft?.knows ?? []).join('，')} onChangeText={(value) => setStateDraft((state) => state ? { ...state, knows: splitList(value) } : state)} multiline /><Input key={activeCharacter.id + ':unknown'} preserveDraft label="未知信息（逗号分隔）" value={(stateDraft?.unknown ?? []).join('，')} onChangeText={(value) => setStateDraft((state) => state ? { ...state, unknown: splitList(value) } : state)} multiline /><Pressable disabled={!stateDraft} onPress={() => { if (!stateDraft) return; const current = novel.novelStoryAnalysis?.characterStates ?? []; onUpdateCharacterStates([...current.filter((item) => item.characterId !== stateDraft.characterId), { ...stateDraft, atChapter: novel.novelStoryAnalysis?.lastAnalyzedChapter ?? stateDraft.atChapter, locked: true, stale: false, stateVersion: (novel.novelStoryAnalysis?.stateVersion ?? 0) + 1 }]); }} style={[styles.primaryAction, { backgroundColor: theme.accent }]}><Text style={{ color: theme.background, fontWeight: '800' }}>保存剧情态</Text></Pressable></View> : null}</ScrollView> : null}

          {tab === 'candidates' ? <ScrollView style={styles.flexBody} contentContainerStyle={styles.scrollBody}><View style={styles.sectionLead}><Text style={[styles.sectionTitle, { color: theme.text }]}>正文未建档人物候选箱</Text><Text style={[styles.sectionCopy, { color: theme.textMuted }]}>沿用现有正文角色生成器，但先生成候选，确认后才进入角色库。</Text></View><View style={styles.chipWrap}>{([{ id: 'current-reply', label: '最近回复' }, { id: 'current-chapter', label: '当前章节' }, { id: 'all-text', label: '全部正文' }] as const).map((source) => <Pressable key={source.id} disabled={Boolean(candidateBusy)} onPress={() => void discover(source.id)} style={[styles.sourceButton, { borderColor: theme.accent }]}><Text style={{ color: theme.accent }}>{candidateBusy === source.id ? '提取中…' : source.label}</Text></Pressable>)}</View>{!candidates.length ? <Text style={[styles.empty, { color: theme.textMuted }]}>尚未提取候选；系统会自动排除已有姓名和别名。</Text> : candidates.map((candidate) => <View key={candidate.id} style={[styles.rowCard, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}><View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: theme.text }]}>{candidate.name}</Text><Text style={[styles.rowMeta, { color: theme.textMuted }]}>{candidate.profession || candidate.background || '正文中新出现的人物'}</Text></View><Pressable onPress={() => onEditCandidate(candidate)}><Text style={{ color: theme.accent }}>审阅并建档</Text></Pressable><Pressable onPress={() => setCandidates((items) => items.filter((item) => item.id !== candidate.id))}><Text style={{ color: theme.textMuted }}>忽略</Text></Pressable></View>)}</ScrollView> : null}

          {tab === 'arcs' ? <ScrollView style={styles.flexBody} contentContainerStyle={styles.scrollBody}>{characterPicker}{activeCharacter ? <View style={styles.editorBlock}><Text style={[styles.subheading, { color: theme.text }]}>{activeCharacter.name} · 人物弧线</Text><Text style={[styles.sectionCopy, { color: theme.textMuted }]}>{(() => { const last = novel.novelStoryAnalysis?.characterStates.find((item) => item.characterId === activeCharacter.id)?.atChapter ?? 0; const current = novel.novelStoryAnalysis?.lastAnalyzedChapter ?? 0; return last > 0 ? `最近状态：第 ${last} 章${current > last ? ` · 已 ${current - last} 章未推进` : ''}` : '尚无正文状态记录'; })()}</Text><Input label="初始状态" value={arcDraft?.startingPoint ?? ''} onChangeText={(startingPoint) => setArcDraft((value) => value ? { ...value, startingPoint } : value)} multiline /><Input label="阶段目标" value={arcDraft?.stageGoal ?? ''} onChangeText={(stageGoal) => setArcDraft((value) => value ? { ...value, stageGoal } : value)} /><Input label="关键转折" value={arcDraft?.keyTurn ?? ''} onChangeText={(keyTurn) => setArcDraft((value) => value ? { ...value, keyTurn } : value)} multiline /><Input label="当前进度" value={arcDraft?.progress ?? ''} onChangeText={(progress) => setArcDraft((value) => value ? { ...value, progress } : value)} /><Input label="下一次应推进什么" value={arcDraft?.nextMove ?? ''} onChangeText={(nextMove) => setArcDraft((value) => value ? { ...value, nextMove } : value)} multiline /><View style={styles.chipWrap}>{(['planned', 'active', 'paused', 'completed'] as const).map((status) => <Pressable key={status} onPress={() => setArcDraft((value) => value ? { ...value, status } : value)} style={[styles.filterChip, { borderColor: arcDraft?.status === status ? theme.accent : theme.border }]}><Text style={{ color: arcDraft?.status === status ? theme.accent : theme.textMuted }}>{({ planned: '计划中', active: '推进中', paused: '暂停', completed: '完成' })[status]}</Text></Pressable>)}</View><Pressable disabled={!arcDraft} onPress={() => arcDraft && commitWorkspace(upsertCharacterArc(workspace, { ...arcDraft, updatedAt: new Date().toISOString() }))} style={[styles.primaryAction, { backgroundColor: theme.accent }]}><Text style={{ color: theme.background, fontWeight: '800' }}>保存人物弧线</Text></Pressable></View> : null}</ScrollView> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,12,9,0.55)' },
  sheet: { width: '100%', maxWidth: 1500, height: '96%', alignSelf: 'center', borderWidth: 1 },
  header: { minHeight: 112, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  headerCompact: { minHeight: 94, paddingHorizontal: Spacing.three },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.6 },
  title: { fontFamily: 'serif', fontSize: 28, lineHeight: 34, fontWeight: '600' },
  subtitle: { fontSize: 11, lineHeight: 16 },
  close: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: 'serif', fontSize: 25, lineHeight: 28 },
  tabsViewport: { height: 68, flexGrow: 0, flexShrink: 0 },
  tabs: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, padding: 5, gap: 5 },
  tab: { minWidth: 150, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three },
  tabIndex: { fontFamily: 'serif', fontSize: 17, fontWeight: '600' },
  tabLabel: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  tabCaption: { fontSize: 8, lineHeight: 11 },
  flexBody: { flex: 1 },
  toolbar: { borderBottomWidth: StyleSheet.hairlineWidth, padding: Spacing.three, gap: Spacing.two },
  search: { minHeight: 44, borderWidth: 1, paddingHorizontal: Spacing.three, fontSize: 13 },
  chipWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  filterChip: { minHeight: 34, borderWidth: 1, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
  bulkRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  bulkInput: { minWidth: 180, minHeight: 38, borderWidth: 1, paddingHorizontal: Spacing.two },
  smallAction: { minHeight: 38, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: Spacing.three, gap: Spacing.two },
  rowCard: { minHeight: 72, borderWidth: 1, padding: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  check: { width: 24, height: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, minWidth: 0, gap: 4 },
  rowTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  rowMeta: { fontSize: 10, lineHeight: 15 },
  empty: { paddingVertical: Spacing.four, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  scrollBody: { padding: Spacing.four, gap: Spacing.three },
  sectionLead: { gap: 5, marginBottom: Spacing.two },
  sectionTitle: { fontFamily: 'serif', fontSize: 24, lineHeight: 30, fontWeight: '600' },
  sectionCopy: { fontSize: 11, lineHeight: 17 },
  issue: { borderLeftWidth: 4, borderTopWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, padding: Spacing.three },
  issueAction: { alignSelf: 'flex-start', marginTop: Spacing.two, borderWidth: 1, minHeight: 34, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  subheading: { fontFamily: 'serif', fontSize: 20, lineHeight: 26, fontWeight: '600', marginTop: Spacing.two },
  pickerBlock: { gap: Spacing.two },
  editorBlock: { gap: Spacing.three },
  relationEditor: { gap: Spacing.two },
  relationAutomation: { minHeight: 70, borderWidth: 1, borderLeftWidth: 4, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  relationAutomationArrow: { fontFamily: 'serif', fontSize: 22, lineHeight: 26 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 10, lineHeight: 14, fontWeight: '800' },
  input: { minHeight: 44, borderWidth: 1, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 13, lineHeight: 20 },
  inputMultiline: { minHeight: 92 },
  primaryAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three, alignSelf: 'flex-start' },
  sourceButton: { minHeight: 42, borderWidth: 1, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 36, borderWidth: 1, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
});
