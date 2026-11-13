import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NovelFormField } from '@/components/novel-create/NovelFormField';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { KeyboardAwareScrollView } from '@/components/ui/KeyboardAwareScrollView';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { router } from 'expo-router';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { requestChapterRewrite, type ChapterRewriteMode } from '@/services/novel-chapter-rewrite';
import { getNovelAuditSourceFingerprint, isNovelRewriteAuditCurrent } from '@/services/novel-audit-freshness';
import type { NovelAuditIssue, NovelChapter } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { NovelComicModal } from '@/components/NovelComicModal';
import { assertChapterLength } from '@/utils/novel-chapter-length';

const AUDIT_CATEGORY_LABELS: Record<NovelAuditIssue['category'], string> = {
  consistency: '一致性',
  rhythm: '节奏',
  continuity: '连贯',
  character: '人物',
  foreshadowing: '伏笔',
  structure: '结构',
};

type NovelChapterEditorModalProps = {
  visible: boolean;
  novelId: string;
  chapter: NovelChapter | null;
  onClose: () => void;
};

export function NovelChapterEditorModal({
  visible,
  novelId,
  chapter,
  onClose,
}: NovelChapterEditorModalProps) {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const finalizeNovelChapter = useTavernStore((state) => state.finalizeNovelChapter);
  const deleteNovelChapter = useTavernStore((state) => state.deleteNovelChapter);
  const auditNovelChapter = useTavernStore((state) => state.auditNovelChapter);
  const auditRewriteChapter = useTavernStore((state) => state.auditRewriteChapter);
  const reviseNovelChapter = useTavernStore((state) => state.reviseNovelChapter);
  const backupNovelChapter = useTavernStore((state) => state.backupNovelChapter);
  const rollbackNovelChapter = useTavernStore((state) => state.rollbackNovelChapter);
  const saveNovelChapter = useTavernStore((state) => state.saveNovelChapter);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [goal, setGoal] = useState('');
  const [content, setContent] = useState('');
  const [operation, setOperation] = useState<'audit' | 'revise' | 'finalize' | 'delete' | 'rollback' | 'candidate' | null>(null);
  const [rewriteMode, setRewriteMode] = useState<ChapterRewriteMode>('edit');
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [candidate, setCandidate] = useState<{ content: string; source: string } | null>(null);
  const isAuditing = operation === 'audit';
  const isAiRevising = operation === 'revise';
  const isFinalizing = operation !== null && !isAuditing && !isAiRevising;
  const [isDirty, setIsDirty] = useState(false);
  const [isComicOpen, setIsComicOpen] = useState(false);
  const operationToken = useRef(0);
  const activeOperation = useRef<number | null>(null);
  const editorKey = useRef<string | null>(null);
  const closePending = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!visible || !chapter) {
      editorKey.current = null;
      activeOperation.current = null;
      operationToken.current += 1;
      return;
    }
    const key = `${novelId}:${chapter.id}`;
    const newSession = editorKey.current !== key;
    if (newSession) {
      editorKey.current = key;
      operationToken.current += 1;
      activeOperation.current = null;
    }
    if (newSession || (!isDirty && activeOperation.current === null)) {
      // Initialize a new editor, or refresh a clean draft after an operation.
      setTitle(chapter.title);
      setSummary(chapter.summary);
      setGoal(chapter.goal);
      setContent(chapter.content);
      setIsDirty(false);
      if (newSession) { setOperation(null); setCandidate(null); setRewriteInstruction(''); }
    }
  }, [visible, novelId, chapter, isDirty, operation]);

  useEffect(() => () => {
    operationToken.current += 1;
    activeOperation.current = null;
    editorKey.current = null;
  }, []);

  const audits = useMemo(
    () => (novel?.audits ?? []).filter((item) => item.chapterId === chapter?.id).slice(0, 3),
    [novel?.audits, chapter?.id],
  );
  const rewriteAudits = useMemo(
    () =>
      (novel?.novelRewriteAudits ?? [])
        .filter((item) => item.chapterId === chapter?.id)
        .slice(0, 3),
    [novel?.novelRewriteAudits, chapter?.id],
  );
  const backups = useMemo(
    () => (novel?.chapterBackups ?? []).filter((item) => item.chapterId === chapter?.id).slice(-8),
    [novel?.chapterBackups, chapter?.id],
  );

  const currentChapter = chapter;

  if (!currentChapter) {
    return null;
  }

  const activeChapter: NovelChapter = currentChapter;
  const sourceFingerprint = novel ? getNovelAuditSourceFingerprint(novel, activeChapter) : '';
  const auditIsCurrent = (audit: { chapterId: string; sourceFingerprint?: string; stale?: boolean }) =>
    !isDirty && isNovelRewriteAuditCurrent(audit, activeChapter.id, sourceFingerprint);

  function setDirtyFor(next: Partial<Pick<NovelChapter, 'title' | 'summary' | 'goal' | 'content'>>) {
    setIsDirty(
      (next.title ?? title) !== activeChapter.title ||
        (next.summary ?? summary) !== activeChapter.summary ||
        (next.goal ?? goal) !== activeChapter.goal ||
        (next.content ?? content) !== activeChapter.content,
    );
  }

  const charCount = content.replace(/\s/g, '').length;

  function beginOperation(kind: NonNullable<typeof operation>) {
    if (activeOperation.current !== null) return null;
    const token = ++operationToken.current;
    activeOperation.current = token;
    Keyboard.dismiss();
    setOperation(kind);
    return token;
  }

  function isCurrentOperation(token: number) {
    return activeOperation.current === token && operationToken.current === token &&
      editorKey.current === `${novelId}:${activeChapter.id}`;
  }

  function finishOperation(token: number) {
    if (!isCurrentOperation(token)) return;
    activeOperation.current = null;
    setOperation(null);
  }

  function closeEditor() {
    operationToken.current += 1;
    activeOperation.current = null;
    editorKey.current = null;
    setOperation(null);
    setIsDirty(false);
    setIsComicOpen(false);
    onClose();
  }

  async function saveDraft(token: number) {
    if (!isCurrentOperation(token)) return false;
    savingRef.current = true;
    try {
      await saveNovelChapter(novelId, { ...activeChapter, title, summary, goal, content });
      if (!isCurrentOperation(token)) return false;
      setIsDirty(false);
      return true;
    } finally {
      savingRef.current = false;
    }
  }

  async function handleSave() {
    const token = beginOperation('finalize');
    if (token === null) return;
    try {
      await saveDraft(token);
      if (isCurrentOperation(token)) showAppAlert('已保存', '章节内容已更新。');
    } catch (error) {
      if (isCurrentOperation(token)) showAppAlert('保存失败', error instanceof Error ? error.message : '章节保存失败，请重试。');
    } finally {
      finishOperation(token);
    }
  }

  async function requestClose() {
    if (closePending.current || savingRef.current) return;
    Keyboard.dismiss();
    if (!isDirty && !candidate) {
      closeEditor();
      return;
    }
    closePending.current = true;
    try {
      if (await confirmAppAction('放弃未保存修改？', candidate ? '尚未采纳的修改候选会丢失，已保存原稿保留。' : '关闭后当前章节编辑将丢失。', { confirmLabel: '放弃修改', cancelLabel: '继续编辑' })) {
        closeEditor();
      }
    } finally {
      closePending.current = false;
    }
  }

  async function handleFinalize(continueWriting = false) {
    const token = beginOperation('finalize');
    if (token === null) return;
    try {
      if (isDirty) {
        await saveDraft(token);
        if (!isCurrentOperation(token)) return;
      }
      const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
      const savedChapter = latest?.chapters?.find((item) => item.id === activeChapter.id);
      assertChapterLength(savedChapter?.content ?? content, savedChapter?.targetWords);
      if (latest?.continuationSettings?.autoAudit !== false) {
        const saved = latest?.chapters?.find((item) => item.id === activeChapter.id);
        const validAudit = saved && latest?.novelRewriteAudits?.find((audit) =>
          isNovelRewriteAuditCurrent(audit, saved.id, getNovelAuditSourceFingerprint(latest, saved)));
        if (!validAudit) await auditRewriteChapter(novelId, activeChapter.id);
        if (!isCurrentOperation(token)) return;
        const checked = useTavernStore.getState().novels.find((item) => item.id === novelId);
        const checkedChapter = checked?.chapters?.find((item) => item.id === activeChapter.id);
        const audit = checked && checkedChapter && checked.novelRewriteAudits?.find((item) =>
          isNovelRewriteAuditCurrent(item, activeChapter.id, getNovelAuditSourceFingerprint(checked, checkedChapter)));
        if (!audit || !audit.passed || audit.issues.some((issue) => issue.severity === 'critical')) {
          showAppAlert('草稿待处理', audit ? '审查发现高风险问题，请修改或重写后重新审查。原稿已保留。' : '设定或正文已变化，请重新审查当前版本。');
          return;
        }
      }
      backupNovelChapter(novelId, activeChapter.id);
      await finalizeNovelChapter(novelId, activeChapter.id);
      if (isCurrentOperation(token)) {
        showAppAlert('已定稿', '本章已保存为定稿，后续写作会带入本章。');
        if (continueWriting) {
          const nextDraft = useTavernStore.getState().novels.find((item) => item.id === novelId)?.chapters
            ?.filter((item) => item.status === 'draft').sort((a, b) => a.index - b.index)[0];
          closeEditor();
          router.push(`/novel/chapters/${novelId}?chapterId=${nextDraft?.id ?? 'new'}`);
        }
      }
    } catch (error) {
      if (isCurrentOperation(token)) showAppAlert('定稿失败', error instanceof Error ? error.message : '章节提交失败，请重试。');
    } finally {
      finishOperation(token);
    }
  }

  async function handleDelete() {
    const token = beginOperation('delete');
    if (token === null) return;
    try {
      const confirmed = await confirmAppAction('删除章节', `删除「${title || `第${activeChapter.index}章`}」？此操作不可撤销。`, { confirmLabel: '删除' });
      if (confirmed && isCurrentOperation(token)) {
        deleteNovelChapter(novelId, activeChapter.id);
        closeEditor();
      }
    } finally {
      finishOperation(token);
    }
  }

  async function handleAudit() {
    const token = beginOperation('audit');
    if (token === null) return;
    try {
      if (isDirty) {
        await saveDraft(token);
        if (!isCurrentOperation(token)) return;
      }
      await auditNovelChapter(novelId, activeChapter.id);
      if (isCurrentOperation(token)) showAppAlert('审查完成', '已生成该章审查报告，可在下方查看。');
    } catch (error) {
      if (isCurrentOperation(token)) showAppAlert(
        '审查失败',
        error instanceof Error ? error.message : '审查失败，请稍后重试。',
      );
    } finally {
      finishOperation(token);
    }
  }

  async function handleAiRevise() {
    const token = beginOperation('revise');
    if (token === null) return;
    try {
      // 未保存的编辑先落库，确保基于最新正文修订。
      if (isDirty) {
        await saveDraft(token);
        if (!isCurrentOperation(token)) return;
      }
      // 复用 8 维 LLM 审查：无记录时先生成一次。
      const hasRewriteAudit = rewriteAudits.some(auditIsCurrent);
      if (isDirty || !hasRewriteAudit) {
        await auditRewriteChapter(novelId, activeChapter.id);
      }
      if (!isCurrentOperation(token)) return;
      // 修订后自动复查，仅采用明显更优的版本（保留原稿）。
      const result = await reviseNovelChapter(novelId, activeChapter.id);
      if (!isCurrentOperation(token)) return;
      showAppAlert(
        'AI 修订完成',
        result.adopted
          ? `已采用修订版（新评分 ${result.score} 分），并在下方生成最新审查报告。`
          : `修订版未明显优于原稿，已保留原版本（候选修订评分 ${result.score} 分）。`,
      );
      // 用修订后的内容刷新编辑区。
      const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
      const refreshed = (latest?.chapters ?? []).find((item) => item.id === activeChapter.id);
      if (refreshed) {
        setTitle(refreshed.title);
        setSummary(refreshed.summary);
        setGoal(refreshed.goal);
        setContent(refreshed.content);
      }
    } catch (error) {
      if (isCurrentOperation(token)) showAppAlert(
        'AI 修订失败',
        error instanceof Error ? error.message : 'AI 修订失败，请稍后重试。',
      );
    } finally {
      finishOperation(token);
    }
  }

  async function handleRewriteCandidate() {
    const token = beginOperation('candidate');
    if (token === null) return;
    try {
      if (isDirty) {
        await saveDraft(token);
        if (!isCurrentOperation(token)) return;
      }
      const state = useTavernStore.getState();
      const current = state.novels.find((item) => item.id === novelId);
      await Promise.all((current?.chapters ?? []).filter((item) => item.index <= activeChapter.index && item.contentStatus && item.contentStatus !== 'loaded')
        .map((item) => state.hydrateNovelChapterContent(item.id)));
      const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
      const saved = latest?.chapters?.find((item) => item.id === activeChapter.id);
      if (!latest || !saved) throw new Error('章节已不存在。');
      const source = getNovelAuditSourceFingerprint(latest, saved);
      const result = await requestChapterRewrite({ novel: latest, chapter: saved,
        apiSettings: resolveApiSettings(state.providers, state.generationSettings, { task: 'writing', purpose: 'chat' }),
        writingExtensions: state.contentStyleSettings, instruction: rewriteInstruction, mode: rewriteMode });
      if (isCurrentOperation(token)) setCandidate({ content: result, source });
    } catch (error) {
      if (isCurrentOperation(token)) showAppAlert('生成修改候选失败', error instanceof Error ? error.message : '请稍后重试，原稿已保留。');
    } finally { finishOperation(token); }
  }

  async function adoptCandidate() {
    if (!candidate || operation) return;
    const latest = useTavernStore.getState().novels.find((item) => item.id === novelId);
    const saved = latest?.chapters?.find((item) => item.id === activeChapter.id);
    if (isDirty || !latest || !saved || candidate.source !== getNovelAuditSourceFingerprint(latest, saved)) {
      showAppAlert('候选已过期', '生成后正文或作品设定发生了变化，请保存当前修改并重新生成候选。');
      return;
    }
    const token = beginOperation('candidate');
    if (token === null) return;
    try {
      savingRef.current = true;
      backupNovelChapter(novelId, activeChapter.id);
      await saveNovelChapter(novelId, { ...saved, content: candidate.content, summary: '', status: 'draft' });
      if (!isCurrentOperation(token)) return;
      setContent(candidate.content); setSummary(''); setCandidate(null); setIsDirty(false);
      showAppAlert('已采纳为草稿', '原稿已备份；摘要和审查需要根据新正文重新生成。');
    } catch (error) {
      if (isCurrentOperation(token)) showAppAlert('保存候选失败', error instanceof Error ? error.message : '候选保存失败，请重试。');
    } finally { savingRef.current = false; finishOperation(token); }
  }

  async function handleRollback(backupId: string) {
    const token = beginOperation('rollback');
    if (token === null) return;
    try {
      const confirmed = await confirmAppAction('回退版本', '将恢复备份中的正文和章节信息；已定稿章节会成为草稿，需要重新采纳定稿。确定吗？', { confirmLabel: '回退' });
      if (!confirmed || !isCurrentOperation(token)) return;
      savingRef.current = true;
      await rollbackNovelChapter(novelId, activeChapter.id, backupId);
      if (isCurrentOperation(token)) setIsDirty(false);
    } catch (error) {
      if (isCurrentOperation(token)) showAppAlert('回退失败', error instanceof Error ? error.message : '章节回退失败，请重试。');
    } finally {
      savingRef.current = false;
      finishOperation(token);
    }
  }

  return (
    <KeyboardSafeModal
      visible={visible}
      onRequestClose={() => void requestClose()}
      scrollable={false}>
      <View style={[styles.overlay, { backgroundColor: theme.scrim }]}> 
        <SafeAreaContainer insets={insets}>
          <View style={[styles.sheet, desktop && styles.desktopSheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
            {!desktop && <View style={[styles.handle, { backgroundColor: theme.border }]} />}
            <View style={styles.header}>
              <View style={styles.headerText}>
                <ThemedText type="smallBold">
                  {currentChapter.status === 'draft' ? '草稿' : '定稿'} · 第{activeChapter.index}章
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {charCount} 字
                </ThemedText>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭章节编辑" onPress={() => void requestClose()} hitSlop={10} style={styles.closeButton}>
                <ThemedText style={{ color: theme.textMuted }}>✕</ThemedText>
              </Pressable>
            </View>

            <KeyboardAwareScrollView
              style={styles.body}
              contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 24 }]}
              keyboardShouldPersistTaps="handled">
              <NovelFormField
                label="章名"
                value={title}
                placeholder={`第${activeChapter.index}章`}
                editable={!isAuditing && !isAiRevising && !isFinalizing}
                onChangeText={(value) => {
                  setTitle(value);
                  setDirtyFor({ title: value });
                }}
              />
              <NovelFormField
                label="本章摘要"
                value={summary}
                placeholder="一句话概括本章发生了什么（用于上下文注入）"
                multiline
                editable={!isAuditing && !isAiRevising && !isFinalizing}
                minHeight={56}
                onChangeText={(value) => {
                  setSummary(value);
                  setDirtyFor({ summary: value });
                }}
              />
              <NovelFormField
                label="本章目标"
                value={goal}
                placeholder="本章要推进什么 / 埋下什么钩子"
                multiline
                editable={!isAuditing && !isAiRevising && !isFinalizing}
                minHeight={56}
                onChangeText={(value) => {
                  setGoal(value);
                  setDirtyFor({ goal: value });
                }}
              />
              <NovelFormField
                label="正文"
                value={content}
                placeholder="本章正文……"
                multiline
                editable={!isAuditing && !isAiRevising && !isFinalizing}
                minHeight={240}
                onChangeText={(value) => {
                  setContent(value);
                  setDirtyFor({ content: value });
                }}
              />
              <View style={styles.actions}>
                <TaskModelSelector task="review" disabled={operation !== null} />
                <ActionButton
                  label={isDirty ? '保存修改' : '已保存'}
                  onPress={handleSave}
                  disabled={!isDirty || isAuditing || isAiRevising || isFinalizing}
                  tone="primary"
                />
                {currentChapter.status === 'draft' ? (
                  <ActionButton
                    label={operation === 'finalize' ? '正在定稿…' : novel?.continuationSettings?.autoAudit === false ? '采纳定稿' : '审查并定稿'}
                    onPress={() => void handleFinalize()}
                    tone="accent"
                    disabled={isAuditing || isAiRevising || isFinalizing || !content.trim()}
                  />
                ) : null}
                {currentChapter.status === 'draft' && <ActionButton label="定稿并继续写作" onPress={() => void handleFinalize(true)} disabled={operation !== null || !content.trim()} />}
                {currentChapter.status === 'draft' ? (
                  <ActionButton
                    label={isAiRevising ? '自动修复中…' : '自动修复审查问题'}
                    onPress={() => void handleAiRevise()}
                    disabled={isAiRevising || isAuditing || isFinalizing}
                  />
                ) : null}
                <ActionButton
                  label={isAuditing ? '审查中…' : '规则 + LLM 审查'}
                  onPress={() => void handleAudit()}
                  disabled={isAuditing || isAiRevising || isFinalizing}
                />
                <ActionButton
                  label="写实分镜"
                  onPress={() => setIsComicOpen(true)}
                  disabled={isAuditing || isAiRevising || isFinalizing || !content.trim()}
                  tone="accent"
                />
                <ActionButton label="删除章节" onPress={handleDelete} tone="danger" disabled={isAuditing || isAiRevising || isFinalizing} />
              </View>

              <View style={styles.section}>
                <ThemedText type="smallBold">修改本章</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">按当前角色、世界和章节目标生成候选；查看后采纳，原稿自动备份。</ThemedText>
                <TaskModelSelector task="writing" disabled={operation !== null} />
                <View style={styles.actions}>{([['polish', '润色文字'], ['edit', '按意见修改'], ['rewrite', '整章重写']] as const).map(([mode, label]) =>
                  <ActionButton key={mode} label={label} tone={rewriteMode === mode ? 'accent' : 'default'} onPress={() => setRewriteMode(mode)} disabled={operation !== null} />)}</View>
                <NovelFormField label="修改要求" value={rewriteInstruction} onChangeText={setRewriteInstruction} editable={operation === null} multiline minHeight={76} placeholder="例如：改为高中返校，以生前生后的差异制造笑点，保留章末发现的线索。" />
                <ActionButton label={operation === 'candidate' ? '正在生成修改候选…' : '生成修改候选'} onPress={() => void handleRewriteCandidate()} disabled={operation !== null || !content.trim() || (rewriteMode !== 'polish' && !rewriteInstruction.trim())} tone="accent" />
                {candidate && <View style={[styles.auditCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
                  <ThemedText type="smallBold">修改候选 · {candidate.content.replace(/\s/g, '').length} 字</ThemedText>
                  <ThemedText selectable>{candidate.content}</ThemedText>
                  <View style={styles.actions}><ActionButton label="采纳为草稿" onPress={adoptCandidate} disabled={operation !== null} tone="primary" /><ActionButton label="舍弃候选" onPress={() => setCandidate(null)} disabled={operation !== null} /></View>
                </View>}
              </View>

              {audits.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="smallBold">最近审查</ThemedText>
                  {audits.map((audit) => (
                    <View
                      key={audit.id}
                      style={[
                        styles.auditCard,
                        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                      ]}>
                      <ThemedText type="small">
                        {!auditIsCurrent(audit) ? '历史报告 · 正文或设定已变化，需重新审查' : audit.passed
                          ? '✅ 未发现一致性问题'
                          : `⚠️ ${audit.issues.length} 项问题`}
                      </ThemedText>
                      {audit.issues.slice(0, 6).map((issue) => (
                        <ThemedText key={issue.id} type="small" themeColor="textMuted">
                          · [{AUDIT_CATEGORY_LABELS[issue.category]} ·{' '}
                          {issue.severity === 'high' ? '高' : issue.severity === 'medium' ? '中' : '低'}]
                          {issue.message}
                        </ThemedText>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              {rewriteAudits.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="smallBold">AI 审查报告（8 维）</ThemedText>
                  {rewriteAudits.map((audit) => (
                    <View
                      key={audit.auditId}
                      style={[
                        styles.auditCard,
                        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                      ]}>
                      <ThemedText type="small">
                        {!auditIsCurrent(audit) ? '历史报告 · 正文或设定已变化，需重新审查' : audit.passed
                          ? `✅ 审查通过（${audit.score} 分）`
                          : `⚠️ ${audit.issues.length} 项问题（${audit.score} 分）`}
                      </ThemedText>
                      {audit.issues.slice(0, 6).map((issue) => (
                        <ThemedText key={issue.id} type="small" themeColor="textMuted">
                          · [{issue.severity} · {issue.category}]{issue.description}
                          {issue.repairScope === 'structural' ? '（需确认）' : ''}
                        </ThemedText>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              {backups.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText type="smallBold">历史版本（回退）</ThemedText>
                  {backups
                    .slice()
                    .reverse()
                    .map((backup) => (
                      <Pressable
                        key={backup.id}
                        onPress={() => handleRollback(backup.id)}
                        style={({ pressed }) => [
                          styles.backupRow,
                          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                          pressed && { opacity: 0.7 },
                        ]}>
                        <ThemedText type="small">{backup.title}</ThemedText>
                        <ThemedText type="small" themeColor="textMuted">
                          {new Date(backup.createdAt).toLocaleString()}
                        </ThemedText>
                      </Pressable>
                    ))}
                </View>
              ) : null}
            </KeyboardAwareScrollView>
          </View>
        </SafeAreaContainer>
      </View>
      <NovelComicModal
        visible={isComicOpen}
        novelId={novelId}
        sourceId={activeChapter.id}
        sourceKind="chapter"
        sourceTitle={title || `第${activeChapter.index}章`}
        content={content}
        onClose={() => setIsComicOpen(false)}
      />
    </KeyboardSafeModal>
  );
}

function SafeAreaContainer({
  insets,
  children,
}: {
  insets: { top: number; bottom: number };
  children: ReactNode;
}) {
  return (
    <View style={[styles.safeArea, { paddingTop: insets.top + 20 }]}>{children}</View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  tone = 'default',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'accent' | 'danger';
}) {
  const theme = useTheme();
  const colors = {
    default: theme.backgroundElement,
    primary: theme.accent,
    accent: theme.accentMuted,
    danger: 'rgba(196, 92, 58, 0.12)',
  };
  const textColors = {
    default: theme.text,
    primary: '#120c09',
    accent: theme.accent,
    danger: '#c45c3a',
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: colors[tone], borderColor: theme.border },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.4 },
      ]}>
      <ThemedText type="smallBold" style={{ color: textColors[tone] }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  desktopSheet: { width: '90%', maxWidth: 1100, alignSelf: 'center', borderRadius: 14, marginBottom: 40 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headerText: {
    gap: 2,
  },
  closeButton: {
    padding: 8,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  actionButton: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: Spacing.two,
  },
  auditCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    gap: 4,
  },
  backupRow: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
