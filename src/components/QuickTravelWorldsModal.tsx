import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { WorldPack } from '@/types/tavern';

type QuickTravelWorldsModalProps = {
  visible: boolean;
  busy?: boolean;
  worlds: WorldPack[];
  activeWorldId?: string;
  onClose: () => void;
  onSelect: (worldId: string) => void;
  onAdd: (name: string) => void;
  onEdit?: (worldId: string) => void;
  onEditOutline?: (worldId: string) => void;
  onDelete?: (worldId: string) => void;
  onSettle?: () => void;
};

export function QuickTravelWorldsModal({
  visible,
  busy = false,
  worlds,
  activeWorldId,
  onClose,
  onSelect,
  onAdd,
  onEdit,
  onEditOutline,
  onDelete,
  onSettle,
}: QuickTravelWorldsModalProps) {
  const theme = useTheme();
  const [name, setName] = useState('');

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={busy ? () => undefined : onClose} scrollable>
      <View style={styles.overlay}>
        <View pointerEvents={busy ? "none" : "auto"} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.header}>
            <ThemedText type="subtitle">快穿世界</ThemedText>
            <Pressable onPress={onClose}>
              <ThemedText type="code" themeColor="accent">关闭</ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {worlds.map((world) => {
              const active = world.id === activeWorldId;
              return (
                <Pressable
                  key={world.id}
                  onPress={() => onSelect(world.id)}
                  style={[styles.world, { borderColor: active ? theme.accent : theme.border }]}>
                  <ThemedText type="smallBold">{world.name || '未命名世界'}</ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    {world.isMainWorld
                      ? '主世界 · 层级根节点'
                      : active
                        ? '当前世界'
                        : world.status === 'completed'
                          ? '已完成'
                          : world.status === 'failed'
                            ? '已失败'
                            : '未进入'}
                  </ThemedText>
                  <View style={styles.worldActions}>
                    {onEditOutline && !world.isMainWorld ? <Pressable onPress={() => onEditOutline(world.id)}><ThemedText type="code" themeColor="accent">⚙️ 大纲</ThemedText></Pressable> : null}
                    {onEdit ? <Pressable onPress={() => onEdit(world.id)}><ThemedText type="code" themeColor="accent">编辑世界设定</ThemedText></Pressable> : null}
                    {onDelete && worlds.length > 1 && !world.isMainWorld ? <Pressable onPress={() => onDelete(world.id)}><ThemedText type="code" themeColor="textMuted">删除</ThemedText></Pressable> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          {onSettle && !worlds.find((world) => world.id === activeWorldId)?.isMainWorld ? (
            <Pressable onPress={onSettle} style={[styles.settleButton, { borderColor: theme.accent }]}>
              <ThemedText type="smallBold" themeColor="accent">完成当前世界并结算</ThemedText>
            </Pressable>
          ) : null}
          <View style={styles.addRow}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="新世界名称"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
            />
            <Pressable
              onPress={() => {
                const next = name.trim();
                if (!next) return;
                onAdd(next);
                setName('');
              }}
              style={[styles.addButton, { backgroundColor: theme.accent }]}>
              <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>新增</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </KeyboardSafeModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { maxHeight: '80%', borderTopWidth: 1, borderRadius: 24, padding: Spacing.four, gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { gap: Spacing.two },
  world: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: 4 },
  worldActions: { flexDirection: 'row', gap: Spacing.three, marginTop: 4 },
  addRow: { flexDirection: 'row', gap: Spacing.two },
  input: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three },
  addButton: { minWidth: 64, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three },
  settleButton: { minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
