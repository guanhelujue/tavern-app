import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AccordionSection } from '@/components/novel-create/AccordionSection';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { polishWritingExtensionPrompt } from '@/services/novel-create-ai';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import { showAppAlert } from '@/utils/app-alert';
import { DEFAULT_JAILBREAK_PROMPT, normalizeWritingPromptExtensions } from '@/utils/writing-prompt-extensions';
import { NovelModPanel } from './NovelModPanel';

export function NovelWritingExtensionPanel({ kind }: { kind: 'jailbreak' | 'mod' }) {
  return kind === 'mod' ? <NovelModPanel /> : <WritingExtensionTextPanel />;
}

function WritingExtensionTextPanel() {
  const theme = useTheme();
  const contentStyleSettings = useTavernStore((state) => state.contentStyleSettings);
  const updateContentStyleSettings = useTavernStore((state) => state.updateContentStyleSettings);
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const [isPolishing, setIsPolishing] = useState(false);

  const settings = normalizeWritingPromptExtensions(contentStyleSettings);
  const title = '破限词';
  const enabled = settings.jailbreakEnabled;
  const prompt = settings.jailbreakPrompt;
  function updatePrompt(value: string) {
    updateContentStyleSettings({ jailbreakPrompt: value });
  }

  async function handlePolishPrompt() {
    if (isPolishing || !prompt.trim()) {
      return;
    }

    setIsPolishing(true);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        purpose: 'utility',
        task: 'prompt',
      });

      if (
        !apiSettings.apiKey.trim()
      ) {
        showAppAlert('未配置 API Key', '请先配置小模型或默认厂商的 API Key。');
        return;
      }

      const polished = await polishWritingExtensionPrompt({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        draft: prompt,
      });
      updatePrompt(polished);
      showAppAlert('已润色', `${title}提示词已更新，可再手工微调。`);
    } catch (error) {
      showAppAlert('润色失败', error instanceof Error ? error.message : '无法润色提示词。');
    } finally {
      setIsPolishing(false);
    }
  }

  return (
    <AccordionSection
      title={title}
      sectionNumber="01"
      description="独立控制提示词注入"
      variant="settings"
      defaultOpen>
      <View style={styles.switchRow}>
        <View style={styles.switchCopy}>
          <ThemedText type="smallBold">启用{title}</ThemedText>
          <ThemedText type="small" themeColor="textMuted">
            开启时注入下方提示词；关闭时保留文本，不注入。
          </ThemedText>
        </View>
        <Switch
          accessibilityLabel={`启用${title}`}
          value={enabled}
          onValueChange={(value) => updateContentStyleSettings(
            { jailbreakEnabled: value },
          )}
          trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }}
          thumbColor={enabled ? theme.accent : theme.textMuted}
        />
      </View>

      <ThemedText type="smallBold">{title}提示词</ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        用于小说正文、小传与灵感对话。角色档案补全使用独立提示词。
      </ThemedText>
      <TextInput
        accessibilityLabel={`${title}提示词`}
        value={prompt}
        onChangeText={updatePrompt}
        editable={!isPolishing}
        placeholder="填写破限词提示词…"
        placeholderTextColor={theme.textMuted}
        multiline
        textAlignVertical="top"
        style={[
          styles.input,
          styles.multiline,
          {
            minHeight: 200,
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />
      <TaskModelSelector task="prompt" disabled={isPolishing} />
      <View style={styles.actions}>
        <Pressable
          disabled={isPolishing}
          onPress={() => updatePrompt(DEFAULT_JAILBREAK_PROMPT)}
          style={({ pressed }) => [
            styles.ghostButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: isPolishing ? 0.55 : 1,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="code" themeColor="accent">
            恢复默认
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={isPolishing || !prompt.trim()}
          onPress={() => {
            void handlePolishPrompt();
          }}
          style={({ pressed }) => [
            styles.ghostButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: isPolishing || !prompt.trim() ? 0.55 : 1,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="code" themeColor="accent">
            {isPolishing ? '润色中…' : 'AI 润色'}
          </ThemedText>
        </Pressable>
      </View>
    </AccordionSection>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  switchCopy: {
    flex: 1,
    gap: 2,
  },
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
