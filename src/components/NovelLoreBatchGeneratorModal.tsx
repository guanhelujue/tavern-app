import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { ThemedView } from '@/components/themed-view';
import {
  MAX_NOVEL_LORE_BATCH_TOTAL,
  MAX_NOVEL_LORE_CONTENT_LENGTH,
  NOVEL_LORE_TYPES,
  NOVEL_LORE_TYPE_LABELS,
  type NovelLoreCollection,
} from '@/constants/novel-lore';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  generateNovelLoreDraftBatch,
  type NovelLoreBatchCounts,
} from '@/services/novel-create-ai';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import type { Novel, NovelLoreEntry } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { mergeIntroForDisplay } from '@/utils/novel-intro';

type Props = {
  visible: boolean;
  novel: Novel;
  existingEntries: NovelLoreEntry[];
  targetCollection?: NovelLoreCollection;
  onAccept: (entries: NovelLoreEntry[]) => void;
  onClose: () => void;
};

function parseCount(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function aliasesToText(aliases: string[]) {
  return aliases.join('，');
}

function textToAliases(value: string) {
  return value
    .split(/[,，、|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, list) =>
      list.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index,
    )
    .slice(0, 3);
}

export function NovelLoreBatchGeneratorModal({
  visible,
  novel,
  existingEntries,
  targetCollection,
  onAccept,
  onClose,
}: Props) {
  const theme = useTheme();
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const recordNovelContinuationUsage = useTavernStore(
    (state) => state.recordNovelContinuationUsage,
  );
  const [worldCountText, setWorldCountText] = useState('3');
  const [locationCountText, setLocationCountText] = useState('5');
  const [targetCountText, setTargetCountText] = useState('5');
  const [brief, setBrief] = useState('');
  const [drafts, setDrafts] = useState<NovelLoreEntry[]>([]);
  const [draftAliasTexts, setDraftAliasTexts] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');

  const worldCount = parseCount(worldCountText);
  const locationCount = parseCount(locationCountText);
  const targetCount = parseCount(targetCountText);
  const requestedTotal = targetCollection ? targetCount : worldCount + locationCount;
  const selectedCount = drafts.filter((entry) => selectedIds.has(entry.id)).length;
  const reviewSummary = useMemo(
    () => NOVEL_LORE_TYPES
      .map((type) => ({ type, count: drafts.filter((entry) => entry.type === type).length }))
      .filter((item) => item.count > 0)
      .map((item) => `${NOVEL_LORE_TYPE_LABELS[item.type]} ${item.count} 条`)
      .join('，'),
    [drafts],
  );

  function resetState() {
    setWorldCountText('3');
    setLocationCountText('5');
    setTargetCountText('5');
    setBrief('');
    setDrafts([]);
    setDraftAliasTexts({});
    setSelectedIds(new Set());
    setError('');
    setIsGenerating(false);
  }

  async function requestClose() {
    if (isGenerating) {
      return;
    }
    if (drafts.length > 0) {
      const confirmed = await confirmAppAction(
        '放弃候选草稿',
        '尚未加入设定库的候选会被清除，确定关闭吗？',
        { confirmLabel: '放弃' },
      );
      if (!confirmed) {
        return;
      }
    }
    resetState();
    onClose();
  }

  async function handleGenerate() {
    if (isGenerating) {
      return;
    }
    if (requestedTotal < 1) {
      setError('请至少生成 1 条设定。');
      return;
    }
    if (requestedTotal > MAX_NOVEL_LORE_BATCH_TOTAL) {
      setError(`单次最多生成 ${MAX_NOVEL_LORE_BATCH_TOTAL} 条设定。`);
      return;
    }
    setIsGenerating(true);
    setError('');
    setDrafts([]);
    setDraftAliasTexts({});
    setSelectedIds(new Set());
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        task: 'world', purpose: 'utility',
    });
    if (!apiSettings.apiKey.trim()) {
      showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
      return;
    }
      const counts = Object.fromEntries(
        NOVEL_LORE_TYPES.map((type) => [
          type,
          targetCollection
            ? (type === targetCollection.defaultType ? targetCount : 0)
            : type === 'world'
              ? worldCount
              : type === 'location'
                ? locationCount
                : 0,
        ]),
      ) as NovelLoreBatchCounts;
      const result = await generateNovelLoreDraftBatch({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        novelName: novel.name,
        intro: mergeIntroForDisplay(novel.shortIntro, novel.detailedIntro),
        worldName: novel.worldName,
        worldEra: novel.worldEra,
        counts,
        existingEntries,
        userBrief: [
          targetCollection
            ? `当前分卷：${targetCollection.name}。分卷说明：${targetCollection.description || '无'}。所有候选必须符合这一分卷主题。`
            : '',
          brief,
        ].filter(Boolean).join('\n'),
        onUsage: (usage) => {
          if (usage.completionTokens > 0) {
            recordNovelContinuationUsage(novel.id, 'create-lore', usage.completionTokens);
          }
        },
      });
      setDrafts(result.entries);
      setDraftAliasTexts(Object.fromEntries(
        result.entries.map((entry) => [entry.id, aliasesToText(entry.aliases)]),
      ));
      setSelectedIds(new Set(result.entries.map((entry) => entry.id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量生成失败，请稍后重试。');
    } finally {
      setIsGenerating(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function updateDraft(id: string, updates: Partial<NovelLoreEntry>) {
    setDrafts((current) =>
      current.map((entry) =>
        entry.id === id
          ? { ...entry, ...updates, updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
  }

  function removeDraft(id: string) {
    setDrafts((current) => current.filter((entry) => entry.id !== id));
    setDraftAliasTexts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function handleAccept() {
    const selected = drafts.filter((entry) => selectedIds.has(entry.id));
    if (selected.length === 0) {
      setError('请至少选择 1 条候选设定。');
      return;
    }
    const existingNames = new Set(
      existingEntries.map((entry) => entry.name.trim().toLowerCase()).filter(Boolean),
    );
    const selectedNames = new Set<string>();
    for (const entry of selected) {
      const name = entry.name.trim();
      const content = entry.content.trim();
      const key = name.toLowerCase();
      if (!name || !content) {
        setError('选中的每条候选都必须填写名称和正文。');
        return;
      }
      if (existingNames.has(key) || selectedNames.has(key)) {
        setError(`候选设定「${name}」与已有内容重名。`);
        return;
      }
      selectedNames.add(key);
    }

    onAccept(selected.map((entry) => ({
      ...entry,
      name: entry.name.trim(),
      aliases: textToAliases(draftAliasTexts[entry.id] ?? aliasesToText(entry.aliases)),
      content: entry.content.trim().slice(0, MAX_NOVEL_LORE_CONTENT_LENGTH),
      updatedAt: new Date().toISOString(),
    })));
    resetState();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => {
        void requestClose();
      }}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            void requestClose();
          }}
        />
        <View
          style={[
            styles.modalSheet,
            { backgroundColor: theme.background, borderColor: theme.border },
          ]}>
          <View style={styles.modalHeader}>
            <View style={styles.headerCopy}>
              <ThemedText type="subtitle">AI 批量起草{targetCollection ? ` · ${targetCollection.name}` : ''}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                先生成候选，审阅后再加入设定库。
              </ThemedText>
              <TaskModelSelector task="world" disabled={isGenerating} />
            </View>
            <Pressable
              onPress={() => {
                void requestClose();
              }}
              disabled={isGenerating}
              hitSlop={8}>
              <ThemedText type="code" themeColor={isGenerating ? 'textMuted' : 'accent'}>
                关闭
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {drafts.length === 0 ? (
              <>
                <ThemedView
                  type="surface"
                  style={[styles.capacityPanel, { borderColor: theme.border }]}>
                  <ThemedText type="smallBold">本次生成数量</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    单次最多 {MAX_NOVEL_LORE_BATCH_TOTAL} 条，可分批继续添加。
                  </ThemedText>
                  <View style={styles.countRow}>
                    {targetCollection ? (
                      <View style={styles.countField}>
                        <ThemedText type="smallBold">{NOVEL_LORE_TYPE_LABELS[targetCollection.defaultType]}候选</ThemedText>
                        <TextInput value={targetCountText} onChangeText={setTargetCountText} keyboardType="number-pad" selectTextOnFocus editable={!isGenerating} accessibilityLabel="当前分卷生成数量" style={[styles.countInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} />
                      </View>
                    ) : (
                      <>
                        <View style={styles.countField}>
                          <ThemedText type="smallBold">世界观</ThemedText>
                          <TextInput value={worldCountText} onChangeText={setWorldCountText} keyboardType="number-pad" selectTextOnFocus editable={!isGenerating} accessibilityLabel="世界观生成数量" style={[styles.countInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} />
                        </View>
                        <View style={styles.countField}>
                          <ThemedText type="smallBold">地点</ThemedText>
                          <TextInput value={locationCountText} onChangeText={setLocationCountText} keyboardType="number-pad" selectTextOnFocus editable={!isGenerating} accessibilityLabel="地点生成数量" style={[styles.countInput, { backgroundColor: theme.backgroundElement, borderColor: theme.border, color: theme.text }]} />
                        </View>
                      </>
                    )}
                  </View>
                </ThemedView>

                <View style={styles.field}>
                  <ThemedText type="smallBold">创作要求（可选）</ThemedText>
                  <TextInput
                    value={brief}
                    onChangeText={setBrief}
                    editable={!isGenerating}
                    placeholder="例如：东方克苏鲁，地点要能推动调查剧情"
                    placeholderTextColor={theme.textMuted}
                    multiline
                    style={[
                      styles.input,
                      styles.briefInput,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                  />
                </View>

                {error ? (
                  <ThemedText type="small" style={styles.errorText} accessibilityRole="alert">
                    {error}
                  </ThemedText>
                ) : null}

                <Pressable
                  onPress={() => {
                    void handleGenerate();
                  }}
                  disabled={isGenerating}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.accent },
                    (pressed || isGenerating) && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                    {isGenerating ? `正在起草 ${requestedTotal} 条候选…` : `生成 ${requestedTotal} 条候选`}
                  </ThemedText>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.reviewHeader}>
                  <View style={styles.headerCopy}>
                    <ThemedText type="smallBold">审阅候选</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {reviewSummary}，已选 {selectedCount} 条。
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => {
                      setDrafts([]);
                      setDraftAliasTexts({});
                      setSelectedIds(new Set());
                      setError('');
                    }}
                    style={[styles.textButton, { borderColor: theme.border }]}>
                    <ThemedText type="code" themeColor="accent">重新生成</ThemedText>
                  </Pressable>
                </View>

                {drafts.map((entry) => {
                  const selected = selectedIds.has(entry.id);
                  return (
                    <ThemedView
                      key={entry.id}
                      type="surface"
                      style={[
                        styles.draftCard,
                        {
                          borderColor: selected ? theme.accent : theme.border,
                          opacity: selected ? 1 : 0.62,
                        },
                      ]}>
                      <View style={styles.draftTopRow}>
                        <Pressable
                          onPress={() => toggleSelected(entry.id)}
                          style={styles.selectionControl}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          accessibilityLabel={`选择候选设定 ${entry.name}`}>
                          <View
                            style={[
                              styles.checkbox,
                              {
                                borderColor: selected ? theme.accent : theme.border,
                                backgroundColor: selected ? theme.accent : 'transparent',
                              },
                            ]}>
                            {selected ? (
                              <ThemedText type="code" style={{ color: theme.onPrimary }}>✓</ThemedText>
                            ) : null}
                          </View>
                          <ThemedText type="code" themeColor="accent">
                            {NOVEL_LORE_TYPE_LABELS[entry.type]}
                          </ThemedText>
                        </Pressable>
                        <Pressable onPress={() => removeDraft(entry.id)} hitSlop={8}>
                          <ThemedText type="code" style={styles.deleteText}>移除</ThemedText>
                        </Pressable>
                      </View>

                      <View style={styles.field}>
                        <ThemedText type="smallBold">名称</ThemedText>
                        <TextInput
                          value={entry.name}
                          onChangeText={(name) => updateDraft(entry.id, { name })}
                          placeholder="设定名称"
                          placeholderTextColor={theme.textMuted}
                          style={[
                            styles.input,
                            {
                              backgroundColor: theme.backgroundElement,
                              borderColor: theme.border,
                              color: theme.text,
                            },
                          ]}
                        />
                      </View>

                      <View style={styles.field}>
                        <ThemedText type="smallBold">别名</ThemedText>
                        <TextInput
                          value={draftAliasTexts[entry.id] ?? aliasesToText(entry.aliases)}
                          onChangeText={(value) =>
                            setDraftAliasTexts((current) => ({ ...current, [entry.id]: value }))
                          }
                          placeholder="逗号分隔，最多 3 个"
                          placeholderTextColor={theme.textMuted}
                          style={[
                            styles.input,
                            {
                              backgroundColor: theme.backgroundElement,
                              borderColor: theme.border,
                              color: theme.text,
                            },
                          ]}
                        />
                      </View>

                      <View style={styles.field}>
                        <ThemedText type="smallBold">正文</ThemedText>
                        <TextInput
                          value={entry.content}
                          onChangeText={(content) =>
                            updateDraft(entry.id, {
                              content: content.slice(0, MAX_NOVEL_LORE_CONTENT_LENGTH),
                            })
                          }
                          placeholder="需要模型知道的设定要点"
                          placeholderTextColor={theme.textMuted}
                          multiline
                          style={[
                            styles.input,
                            styles.contentInput,
                            {
                              backgroundColor: theme.backgroundElement,
                              borderColor: theme.border,
                              color: theme.text,
                            },
                          ]}
                        />
                        <ThemedText type="code" themeColor="textMuted">
                          {entry.content.length} / {MAX_NOVEL_LORE_CONTENT_LENGTH}
                        </ThemedText>
                      </View>
                    </ThemedView>
                  );
                })}

                {error ? (
                  <ThemedText type="small" style={styles.errorText} accessibilityRole="alert">
                    {error}
                  </ThemedText>
                ) : null}

                <Pressable
                  onPress={handleAccept}
                  disabled={selectedCount === 0}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    { backgroundColor: theme.accent },
                    (pressed || selectedCount === 0) && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>
                    加入选中的 {selectedCount} 条
                  </ThemedText>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(18, 12, 9, 0.45)',
  },
  modalSheet: {
    maxHeight: '94%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingTop: Spacing.three,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  headerCopy: { flex: 1, gap: 4 },
  modalContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  capacityPanel: {
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  countRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  countField: { flex: 1, gap: Spacing.two },
  countInput: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  field: { gap: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  briefInput: {
    minHeight: 86,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
  contentInput: {
    minHeight: 112,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
  primaryButton: {
    borderRadius: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  textButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  draftCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  draftTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  selectionControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { color: '#b54a3c' },
  deleteText: { color: '#b54a3c', fontWeight: '700' },
  pressed: { opacity: 0.68 },
});
