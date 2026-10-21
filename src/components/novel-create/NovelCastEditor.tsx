import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NovelCastCharacterModal } from '@/components/novel-create/NovelCastCharacterModal';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createEmptyCastCharacter, type NovelFrameworkDraft } from '@/services/novel-create-ai';
import type { NovelCastCharacter } from '@/types/tavern';
import { confirmAppAction } from '@/utils/app-alert';
import { stripCastRelationsToSubject } from '@/utils/novel-relations';

type NovelCastEditorProps = {
  cast: NovelCastCharacter[];
  novelName: string;
  /** Unified work intro for cast AI context. */
  intro: string;
  framework: Omit<NovelFrameworkDraft, 'cast'>;
  onChange: (cast: NovelCastCharacter[]) => void;
  /** Novel-level character-card appearance id. */
  appearanceId?: string | null;
  /** Full active quick-travel world context for character generation. */
  worldContext?: string;
};

export function NovelCastEditor({
  cast,
  novelName,
  intro,
  framework,
  onChange,
  appearanceId,
  worldContext,
}: NovelCastEditorProps) {
  const theme = useTheme();
  const [editing, setEditing] = useState<NovelCastCharacter | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  function openCreate() {
    setEditing(null);
    setIsModalOpen(true);
  }

  function openEdit(character: NovelCastCharacter) {
    setEditing(character);
    setIsModalOpen(true);
  }

  function handleSave(character: NovelCastCharacter, _experience: string) {
    const exists = cast.some((item) => item.id === character.id);
    const nextCast = exists
      ? cast.map((item) => (item.id === character.id ? character : item))
      : [...cast, character];
    onChange(nextCast);
    setIsModalOpen(false);
    setEditing(null);
  }

  async function handleRemove(characterId: string) {
    const confirmed = await confirmAppAction('删除角色', '确认删除该角色设定？其他角色中指向该人的关系也会移除。', {
      confirmLabel: '删除',
    });
    if (!confirmed) {
      return;
    }
    const removed = cast.find((item) => item.id === characterId);
    let nextCast = cast.filter((item) => item.id !== characterId);
    if (removed) {
      nextCast = stripCastRelationsToSubject(nextCast, removed);
    }
    onChange(nextCast);
  }

  // Do not silently assign the first card to the protagonist role. In
  // particular, quick-travel novels may have a host identity without a cast
  // card; the user must explicitly choose "是否主角".
  const createInitial = editing ?? createEmptyCastCharacter();

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold">角色设定</ThemedText>
          <ThemedText style={styles.required}>*</ThemedText>
          <ThemedText type="code" themeColor="textMuted">
            ({cast.length})
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          请至少添加一名主角（可勾选多名，如男女主）。配角提到名字时才会带上详细设定。
        </ThemedText>
      </View>

      <View style={styles.list}>
        {cast.map((character) => (
          <View
            key={character.id}
            style={[
              styles.card,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
            ]}>
            <Pressable
              onPress={() => openEdit(character)}
              style={({ pressed }) => [styles.cardMain, pressed && { opacity: 0.8 }]}>
              <View style={styles.cardTitleRow}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.cardName}>
                  {character.name || '未命名角色'}
                </ThemedText>
                {character.isProtagonist ? (
                  <ThemedText type="code" themeColor="accent">
                    主角
                  </ThemedText>
                ) : null}
                {character.generatedFromReply && character.sourceChapter ? (
                  <ThemedText type="code" themeColor="textSecondary">
                    {character.sourceChapter}
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText type="code" themeColor="textMuted" numberOfLines={1}>
                {[character.profession, character.gender, character.age, character.height]
                  .filter(Boolean)
                  .join(' · ') || '点击编辑'}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                void handleRemove(character.id);
              }}
              hitSlop={8}
              style={({ pressed }) => [
                styles.deleteBtn,
                {
                  borderColor: theme.border,
                  backgroundColor: theme.surface,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`删除 ${character.name || '未命名角色'}`}>
              <ThemedText type="code" style={styles.deleteBtnText}>
                删除
              </ThemedText>
            </Pressable>
          </View>
        ))}

        <Pressable
          onPress={openCreate}
          style={({ pressed }) => [
            styles.addCard,
            {
              borderColor: theme.border,
              backgroundColor: theme.surface,
            },
            pressed && { opacity: 0.8 },
          ]}>
          <ThemedText style={[styles.plus, { color: theme.accent }]}>+</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            添加角色
          </ThemedText>
        </Pressable>
      </View>

      <NovelCastCharacterModal
        visible={isModalOpen}
        initial={isModalOpen ? createInitial : null}
        novelName={novelName}
        intro={intro}
        framework={framework}
        existingCast={cast}
        appearanceId={appearanceId}
        worldContext={worldContext}
        requireName
        onClose={() => {
          setIsModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  header: {
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  required: {
    color: '#c45c3a',
    fontWeight: '700',
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  card: {
    width: '47%',
    minHeight: 84,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.two,
    gap: Spacing.two,
  },
  cardMain: {
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardName: {
    flex: 1,
  },
  deleteBtn: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  deleteBtnText: {
    color: '#c45c3a',
    fontWeight: '700',
  },
  addCard: {
    width: '47%',
    minHeight: 84,
    borderWidth: 1,
    borderRadius: 16,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  plus: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '300',
  },
});
