import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AccordionSection } from '@/components/novel-create/AccordionSection';
import { ThemedText } from '@/components/themed-text';
import {
  DEFAULT_LONG_TERM_MEMORY_PROMPT,
  DEFAULT_MID_TERM_MEMORY_PROMPT,
  DEFAULT_SHORT_TERM_MEMORY_PROMPT,
  MID_TERM_MEMORY_BATCH_SIZE,
  SHORT_TERM_MEMORY_BATCH_SIZE,
} from '@/constants/novel-memory';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

/**
 * Memory prompt defaults — edited in「小说配置」.
 * Default narrative / writing-style prompts live on create step 3.
 */
export function NovelPromptDefaultsPanel() {
  const theme = useTheme();
  const novelPromptDefaults = useTavernStore((state) => state.novelPromptDefaults);
  const updateNovelPromptDefaults = useTavernStore((state) => state.updateNovelPromptDefaults);

  return (
    <AccordionSection
      title="记忆规则"
      sectionNumber="03"
      description="近期、过往与长期记忆的压缩策略"
      variant="settings">
      <ThemedText type="small" themeColor="textMuted">
        8-5-1 阶梯：每轮写入近期；满 {SHORT_TERM_MEMORY_BATCH_SIZE} 条并入过往；过往满{' '}
        {MID_TERM_MEMORY_BATCH_SIZE} 条并入长期总结。新建时一并写入小说。默认提示词 /
        文风请在「新建小说 › 第 3 步」编辑。
      </ThemedText>

      <ThemedText type="smallBold">近期（每轮压缩）</ThemedText>
      <TextInput
        value={novelPromptDefaults.shortTermMemoryPrompt}
        onChangeText={(shortTermMemoryPrompt) =>
          updateNovelPromptDefaults({ shortTermMemoryPrompt })
        }
        placeholder={DEFAULT_SHORT_TERM_MEMORY_PROMPT}
        placeholderTextColor={theme.textMuted}
        multiline
        textAlignVertical="top"
        style={[
          styles.input,
          styles.multiline,
          {
            minHeight: 140,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />

      <ThemedText type="smallBold">过往（近期满批合并）</ThemedText>
      <TextInput
        value={novelPromptDefaults.midTermMemoryPrompt}
        onChangeText={(midTermMemoryPrompt) =>
          updateNovelPromptDefaults({ midTermMemoryPrompt })
        }
        placeholder={DEFAULT_MID_TERM_MEMORY_PROMPT}
        placeholderTextColor={theme.textMuted}
        multiline
        textAlignVertical="top"
        style={[
          styles.input,
          styles.multiline,
          {
            minHeight: 140,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />

      <ThemedText type="smallBold">长期总结（过往满批合并）</ThemedText>
      <TextInput
        value={novelPromptDefaults.longTermMemoryPrompt}
        onChangeText={(longTermMemoryPrompt) =>
          updateNovelPromptDefaults({ longTermMemoryPrompt })
        }
        placeholder={DEFAULT_LONG_TERM_MEMORY_PROMPT}
        placeholderTextColor={theme.textMuted}
        multiline
        textAlignVertical="top"
        style={[
          styles.input,
          styles.multiline,
          {
            minHeight: 140,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />

      <View style={styles.actions}>
        <Pressable
          onPress={() =>
            updateNovelPromptDefaults({
              shortTermMemoryPrompt: DEFAULT_SHORT_TERM_MEMORY_PROMPT,
              midTermMemoryPrompt: DEFAULT_MID_TERM_MEMORY_PROMPT,
              longTermMemoryPrompt: DEFAULT_LONG_TERM_MEMORY_PROMPT,
            })
          }
          style={({ pressed }) => [
            styles.ghostButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="code" themeColor="accent">
            恢复默认
          </ThemedText>
        </Pressable>
      </View>
    </AccordionSection>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  multiline: {
    paddingVertical: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  ghostButton: {
    borderWidth: 1,
    borderRadius: 16,
    minHeight: 36,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
