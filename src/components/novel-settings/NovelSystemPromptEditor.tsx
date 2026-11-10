import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { DEFAULT_NOVEL_SYSTEM_PROMPT } from '@/constants/novel-memory';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  polishNovelSystemPrompt,
  summarizeWritingStyleFromNovelSample,
} from '@/services/novel-create-ai';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import {
  appendWritingStyleToSystemPrompt,
  pickNovelTxtSample,
  stripWritingStyleBlock,
  WRITING_STYLE_SUMMARY_MAX_CHARS,
} from '@/utils/novel-style-sample';
import { showAppAlert } from '@/utils/app-alert';

type NovelSystemPromptEditorProps = {
  /** Extra muted hint above the editor. */
  hint?: string;
};

/**
 * Default narrative prompt + optional【文风】block.
 * Edits `novelPromptDefaults.systemPrompt` (used when creating novels).
 */
export function NovelSystemPromptEditor({ hint }: NovelSystemPromptEditorProps) {
  const theme = useTheme();
  const novelPromptDefaults = useTavernStore((state) => state.novelPromptDefaults);
  const updateNovelPromptDefaults = useTavernStore((state) => state.updateNovelPromptDefaults);
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const [isPolishingSystemPrompt, setIsPolishingSystemPrompt] = useState(false);
  const [isExtractingStyle, setIsExtractingStyle] = useState(false);
  const [styleMaxChars, setStyleMaxChars] = useState(String(WRITING_STYLE_SUMMARY_MAX_CHARS));

  function resolveStyleMaxChars() {
    const parsed = Number.parseInt(styleMaxChars, 10);
    if (!Number.isFinite(parsed)) {
      return WRITING_STYLE_SUMMARY_MAX_CHARS;
    }
    return Math.max(60, Math.min(300, parsed));
  }

  async function handlePolishSystemPrompt() {
    if (isPolishingSystemPrompt || isExtractingStyle) {
      return;
    }

    setIsPolishingSystemPrompt(true);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        purpose: 'utility',
        task: 'prompt',
      });

      if (
        !apiSettings.apiKey.trim()
      ) {
        showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
        return;
      }

      const polished = await polishNovelSystemPrompt({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        draft: novelPromptDefaults.systemPrompt.trim() || DEFAULT_NOVEL_SYSTEM_PROMPT,
      });
      updateNovelPromptDefaults({ systemPrompt: polished });
      showAppAlert('已润色', '默认提示词已更新，可再手工微调。');
    } catch (error) {
      showAppAlert('润色失败', error instanceof Error ? error.message : '无法润色默认提示词。');
    } finally {
      setIsPolishingSystemPrompt(false);
    }
  }

  async function handleExtractStyleFromTxt() {
    if (isExtractingStyle || isPolishingSystemPrompt) {
      return;
    }

    setIsExtractingStyle(true);
    try {
      const apiSettings = resolveApiSettings(providers, generationSettings, {
        purpose: 'utility',
        task: 'style',
      });

      if (
        !apiSettings.apiKey.trim()
      ) {
        showAppAlert('未配置 API Key', '请先在系统设置中填写小模型或默认厂商的 API Key。');
        return;
      }

      const picked = await pickNovelTxtSample(
        generationSettings.writingStyleSampleMaxChars ?? 12000,
      );
      const maxChars = resolveStyleMaxChars();
      const summary = await summarizeWritingStyleFromNovelSample({
        apiSettings,
        novelCreateMaxTokens: generationSettings.novelCreateMaxTokens,
        sampleText: picked.text,
        maxChars,
        sourceName: picked.fileName,
      });

      const nextPrompt = appendWritingStyleToSystemPrompt(
        novelPromptDefaults.systemPrompt.trim() || DEFAULT_NOVEL_SYSTEM_PROMPT,
        summary,
        maxChars,
      );
      updateNovelPromptDefaults({ systemPrompt: nextPrompt });
      showAppAlert(
        '已拼接文风',
        `来自「${picked.fileName}」（样本 ${picked.sampledChars}/${picked.rawChars} 字）。文风约 ${maxChars} 字上限；再次导入会替换旧【文风】块。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法提取文风。';
      if (message.includes('已取消')) {
        return;
      }
      showAppAlert('提取失败', message);
    } finally {
      setIsExtractingStyle(false);
    }
  }

  function handleClearStyleBlock() {
    const next = stripWritingStyleBlock(
      novelPromptDefaults.systemPrompt.trim() || DEFAULT_NOVEL_SYSTEM_PROMPT,
    );
    updateNovelPromptDefaults({
      systemPrompt: next || DEFAULT_NOVEL_SYSTEM_PROMPT,
    });
  }

  const busy = isPolishingSystemPrompt || isExtractingStyle;

  return (
    <View style={styles.wrap}>
      <ThemedText type="small" themeColor="textMuted">
        {hint ??
          '默认提示词管叙事规则（包括每章篇幅、叙事节奏等）；文风可选，从参考 txt 总结后拼到文末【文风】。此处修改会写入全局默认，新建小说会带上。'}
      </ThemedText>
      <TaskModelSelector task="prompt" disabled={busy} />
      <TextInput
        value={novelPromptDefaults.systemPrompt}
        onChangeText={(systemPrompt) => updateNovelPromptDefaults({ systemPrompt })}
        placeholder={DEFAULT_NOVEL_SYSTEM_PROMPT}
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

      <View style={styles.styleRow}>
        <ThemedText type="smallBold">文风字数上限</ThemedText>
        <TaskModelSelector task="style" disabled={isExtractingStyle || isPolishingSystemPrompt} />
        <TextInput
          value={styleMaxChars}
          onChangeText={setStyleMaxChars}
          keyboardType="number-pad"
          placeholder={String(WRITING_STYLE_SUMMARY_MAX_CHARS)}
          placeholderTextColor={theme.textMuted}
          style={[
            styles.input,
            styles.charCapInput,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
        <ThemedText type="code" themeColor="textMuted">
          60–300
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <Pressable
          disabled={busy}
          onPress={() =>
            updateNovelPromptDefaults({ systemPrompt: DEFAULT_NOVEL_SYSTEM_PROMPT })
          }
          style={({ pressed }) => [
            styles.ghostButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: busy ? 0.55 : 1,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="code" themeColor="accent">
            恢复默认
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={handleClearStyleBlock}
          style={({ pressed }) => [
            styles.ghostButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: busy ? 0.55 : 1,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="code" themeColor="accent">
            清除文风块
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => {
            void handleExtractStyleFromTxt();
          }}
          style={({ pressed }) => [
            styles.ghostButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: busy ? 0.55 : 1,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="code" themeColor="accent">
            {isExtractingStyle ? '提取中…' : '从 txt 提取文风'}
          </ThemedText>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => {
            void handlePolishSystemPrompt();
          }}
          style={({ pressed }) => [
            styles.ghostButton,
            {
              borderColor: theme.border,
              backgroundColor: theme.backgroundElement,
              opacity: busy ? 0.55 : 1,
            },
            pressed && styles.pressed,
          ]}>
          <ThemedText type="code" themeColor="accent">
            {isPolishingSystemPrompt ? '润色中…' : 'AI 润色'}
          </ThemedText>
        </Pressable>
      </View>
      <ThemedText type="small" themeColor="textMuted">
        请选 UTF-8 的 .txt；过长会按「系统设置 › 高级设置 › 文风提取样本字数」均匀抽取多段。
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
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
  styleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  charCapInput: {
    minWidth: 72,
    maxWidth: 88,
    minHeight: 40,
    textAlign: 'center',
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
