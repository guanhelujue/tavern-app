import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { MAX_NOVEL_SAVE_SLOTS } from '@/constants/novel-slots';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NovelSaveSlot } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { formatSlotPreview } from '@/utils/novel-slots';

type SaveSlotsModalProps = {
  visible: boolean;
  slots: NovelSaveSlot[];
  activeSlotId: string | null;
  canRollback: boolean;
  hasRegressionEcho?: boolean;
  liveMessageCount?: number;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onSwitch: (slotId: string, options?: { withEcho?: boolean }) => Promise<void>;
  onRename: (slotId: string, name: string) => Promise<void>;
  onDelete: (slotId: string) => Promise<void>;
  onRollback: () => Promise<void>;
  onClearEcho?: () => void;
};

export function SaveSlotsModal({
  visible,
  slots,
  activeSlotId,
  canRollback,
  hasRegressionEcho = false,
  liveMessageCount,
  onClose,
  onCreate,
  onSwitch,
  onRename,
  onDelete,
  onRollback,
  onClearEcho,
}: SaveSlotsModalProps) {
  const theme = useTheme();
  const [draftName, setDraftName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        setDraftName('');
        setRenamingId(null);
        setRenameDraft('');
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const atLimit = slots.length >= MAX_NOVEL_SAVE_SLOTS;

  async function handleCreate() {
    if (pendingRef.current) return;
    if (atLimit) {
      showAppAlert('记忆点已满', `最多 ${MAX_NOVEL_SAVE_SLOTS} 个记忆点。`);
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      await onCreate(draftName.trim());
      setDraftName('');
    } catch (error) {
      showAppAlert('保存失败', error instanceof Error ? error.message : '无法保存记忆点。');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function confirmDelete(slot: NovelSaveSlot) {
    if (slots.length <= 1) {
      showAppAlert('无法删除', '至少保留一个记忆点（当前进度线）。');
      return;
    }

    const confirmed = await confirmAppAction(
      '删除记忆点',
      `确定删除「${slot.name}」？此操作不可撤销。`,
      { confirmLabel: '删除' },
    );
    if (confirmed && !pendingRef.current) {
      pendingRef.current = true;
      setPending(true);
      try {
        await onDelete(slot.id);
      } catch (error) {
        showAppAlert('删除失败', error instanceof Error ? error.message : '无法删除记忆点。');
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  async function confirmLoad(slot: NovelSaveSlot, withEcho: boolean) {
    if (slot.id === activeSlotId) {
      return;
    }

    const confirmed = await confirmAppAction(
      withEcho ? '带着残响读取' : '读取记忆点',
      withEcho
        ? `读取「${slot.name}」，并把当前线的教训作为【回归残响】带回去（当前进度会先写入原记忆点）。`
        : `读取「${slot.name}」？当前进度会先保存到原记忆点，仅恢复聊天和记忆，已定稿章节、世界设定不会回退。`,
      { confirmLabel: withEcho ? '带着残响读取' : '读取' },
    );
    if (confirmed && !pendingRef.current) {
      pendingRef.current = true;
      setPending(true);
      try {
        await onSwitch(slot.id, { withEcho });
      } catch (error) {
        showAppAlert('读取失败', error instanceof Error ? error.message : '无法读取记忆点。');
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  async function confirmRollback() {
    const confirmed = await confirmAppAction(
      '撤销上次读取',
      '恢复到上次读取记忆点之前的进度？',
      { confirmLabel: '撤销' },
    );
    if (confirmed && !pendingRef.current) {
      pendingRef.current = true;
      setPending(true);
      try {
        await onRollback();
      } catch (error) {
        showAppAlert('撤销失败', error instanceof Error ? error.message : '无法撤销读取。');
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={pending ? () => undefined : onClose} scrollable>
      <View style={styles.overlay}>
        <Pressable disabled={pending} style={styles.backdrop} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              记忆点
            </ThemedText>
            <Pressable disabled={pending} onPress={onClose} hitSlop={8} style={styles.closeButton}>
              <ThemedText themeColor="textMuted">✕</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            保存：冻结当前进度为记忆点，继续往下玩。读取：恢复该点的聊天和记忆，已定稿章节与世界设定不会回退。可选「带着残响」：类似死亡回归，把当前线教训带回去。最多{' '}
            {MAX_NOVEL_SAVE_SLOTS} 个。
          </ThemedText>

          {slots.every((slot) => slot.id === activeSlotId) ? (
            <ThemedText type="small" themeColor="textMuted">
              提示：先点「保存」冻结一个记忆点，再继续聊几轮；旧记忆点上会出现「读取」和「带着残响」。
            </ThemedText>
          ) : null}

          {hasRegressionEcho ? (
            <View
              style={[
                styles.echoBanner,
                { borderColor: theme.accent, backgroundColor: theme.accentMuted },
              ]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.echoText}>
                当前线带有【回归残响】，模型会参考这段过往印象。
              </ThemedText>
              {onClearEcho ? (
                <Pressable disabled={pending} onPress={onClearEcho} hitSlop={6}>
                  <ThemedText type="code" themeColor="accent">
                    清除残响
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {slots.map((slot) => {
              const active = slot.id === activeSlotId;
              const preview = formatSlotPreview(slot);
              const messageCount =
                active && typeof liveMessageCount === 'number'
                  ? liveMessageCount
                  : preview.messageCount;

              return (
                <View
                  key={slot.id}
                  style={[
                    styles.slotRow,
                    {
                      borderColor: active ? theme.accent : theme.border,
                      backgroundColor: active ? theme.accentMuted : theme.background,
                    },
                  ]}>
                  {renamingId === slot.id ? (
                    <View style={styles.renameBlock}>
                      <TextInput
                        value={renameDraft}
                        onChangeText={setRenameDraft}
                        placeholder="记忆点名称"
                        placeholderTextColor={theme.textMuted}
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.surface,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        autoFocus
                      />
                      <View style={styles.rowActions}>
                        <Pressable disabled={pending}
                          onPress={() => {
                            setRenamingId(null);
                            setRenameDraft('');
                          }}
                          hitSlop={6}>
                          <ThemedText type="code" themeColor="textMuted">
                            取消
                          </ThemedText>
                        </Pressable>
                        <Pressable disabled={pending}
                          onPress={async () => {
                            const next = renameDraft.trim();
                            if (next) {
                              if (pendingRef.current) return;
                              pendingRef.current = true;
                              setPending(true);
                              try {
                                await onRename(slot.id, next);
                                setRenamingId(null);
                                setRenameDraft('');
                              } catch (error) {
                                showAppAlert('重命名失败', error instanceof Error ? error.message : '无法重命名记忆点。');
                              } finally {
                                pendingRef.current = false;
                                setPending(false);
                              }
                              return;
                            }
                            setRenamingId(null);
                            setRenameDraft('');
                          }}
                          hitSlop={6}>
                          <ThemedText type="code" themeColor="accent">
                            确定
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.slotMain}>
                        <View style={styles.slotTitleRow}>
                          <ThemedText type="smallBold" style={styles.slotName}>
                            {slot.name}
                          </ThemedText>
                          {active ? (
                            <ThemedText type="code" themeColor="accent">
                              当前
                            </ThemedText>
                          ) : null}
                        </View>
                        <ThemedText type="small" themeColor="textMuted">
                          {messageCount} 条消息 · {preview.timeLabel}
                          {slot.regressionEcho?.trim() ? ' · 含残响' : ''}
                        </ThemedText>
                      </View>
                      <View style={styles.rowActions}>
                        {!active ? (
                          <>
                            <Pressable disabled={pending} onPress={() => void confirmLoad(slot, false)} hitSlop={6}>
                              <ThemedText type="code" themeColor="accent">
                                读取
                              </ThemedText>
                            </Pressable>
                            <Pressable disabled={pending} onPress={() => void confirmLoad(slot, true)} hitSlop={6}>
                              <ThemedText type="code" themeColor="accent">
                                带着残响
                              </ThemedText>
                            </Pressable>
                          </>
                        ) : null}
                        <Pressable disabled={pending}
                          onPress={() => {
                            setRenamingId(slot.id);
                            setRenameDraft(slot.name);
                          }}
                          hitSlop={6}>
                          <ThemedText type="code" themeColor="accent">
                            重命名
                          </ThemedText>
                        </Pressable>
                        <Pressable disabled={pending} onPress={() => void confirmDelete(slot)} hitSlop={6}>
                          <ThemedText type="code" themeColor="textMuted">
                            删除
                          </ThemedText>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.createRow}>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder={atLimit ? '已达上限' : '新记忆点名称（可选）'}
              placeholderTextColor={theme.textMuted}
              editable={!atLimit && !pending}
              style={[
                styles.input,
                styles.createInput,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.border,
                  color: theme.text,
                  opacity: atLimit ? 0.5 : 1,
                },
              ]}
            />
            <Pressable
              disabled={atLimit || pending}
              onPress={() => void handleCreate()}
              style={({ pressed }) => [
                styles.createButton,
                { backgroundColor: theme.accent, opacity: atLimit ? 0.4 : pressed ? 0.8 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.createButtonText}>
                保存
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Pressable
              disabled={!canRollback || pending}
              onPress={() => void confirmRollback()}
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: !canRollback ? 0.4 : pressed ? 0.7 : 1 },
              ]}>
              <ThemedText type="smallBold" themeColor="accent">
                撤销读取
              </ThemedText>
            </Pressable>
            <Pressable disabled={pending} onPress={onClose} style={styles.secondaryButton}>
              <ThemedText type="smallBold" themeColor="accent">
                完成
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardSafeModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(23, 18, 15, 0.28)',
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.three,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  echoBanner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  echoText: {
    flex: 1,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  slotRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  slotMain: {
    gap: 4,
  },
  slotTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  slotName: {
    flex: 1,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing.three,
  },
  renameBlock: {
    gap: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  createInput: {
    flex: 1,
  },
  createButton: {
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: {
    color: '#120c09',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  secondaryButton: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
});
