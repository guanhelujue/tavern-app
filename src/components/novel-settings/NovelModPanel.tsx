import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccordionSection } from '@/components/novel-create/AccordionSection';
import { ThemedText } from '@/components/themed-text';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { Spacing } from '@/constants/theme';
import { DEFAULT_MOD_EXTRACTION_PROMPT } from '@/constants/writing-mod';
import { useTheme } from '@/hooks/use-theme';
import { extractWritingMod } from '@/services/writing-mod-extraction';
import { resolveApiSettings, useTavernStore } from '@/store/tavern-store';
import type { WritingMod } from '@/types/tavern';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { generateId } from '@/utils/helpers';
import { pickWritingModArticle } from '@/utils/writing-mod-import';
import { normalizeWritingModSettings, prepareWritingModSamples, type WritingModSample } from '@/utils/writing-mods';

export function NovelModPanel() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useTavernStore((state) => state.contentStyleSettings);
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const extractionModel = resolveApiSettings(providers, generationSettings, { purpose: 'utility' });
  const updateSettings = useTavernStore((state) => state.updateContentStyleSettings);
  const { modLibrary, modExtractionPrompt } = normalizeWritingModSettings(settings);
  const [mode, setMode] = useState<'edit' | 'extract' | null>(null);
  const [draft, setDraft] = useState<WritingMod | null>(null);
  const [originalDraft, setOriginalDraft] = useState<WritingMod | null>(null);
  const [sampleText, setSampleText] = useState('');
  const [files, setFiles] = useState<WritingModSample[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const request = useRef<AbortController | null>(null);
  const importLock = useRef(false);
  useEffect(() => () => { request.current?.abort(); }, []);
  const inputTheme = { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement };
  const samples = [...files, ...(sampleText.trim() ? [{ name: '粘贴的文章', text: sampleText }] : [])];
  const totalChars = samples.reduce((sum, sample) => sum + sample.text.length, 0);

  function editMod(mod?: WritingMod) {
    const next = mod ?? { id: generateId('mod'), name: '', content: '', enabled: false };
    setDraft({ ...next });
    setOriginalDraft({ ...next });
    setMode('edit');
  }

  async function closeModal() {
    if (importLock.current) return;
    if (mode === 'edit' && draft && (draft.name !== originalDraft?.name || draft.content !== originalDraft?.content)) {
      if (!await confirmAppAction('放弃未保存的修改？', 'MOD 尚未保存，返回后这些修改将丢失。', { confirmLabel: '放弃修改' })) return;
    }
    request.current?.abort();
    request.current = null;
    setBusy(false);
    setMode(null);
  }

  function saveMod() {
    if (!draft?.name.trim() || !draft.content.trim()) {
      showAppAlert('尚未填写完整', '请填写 MOD 名称和内容。');
      return;
    }
    const latest = normalizeWritingModSettings(useTavernStore.getState().contentStyleSettings);
    const saved = { ...draft, name: draft.name.trim(), content: draft.content.trim(),
      enabled: latest.modLibrary.find((item) => item.id === draft.id)?.enabled ?? false };
    updateSettings({
      modLibrary: latest.modLibrary.some((item) => item.id === saved.id)
        ? latest.modLibrary.map((item) => item.id === saved.id ? saved : item)
        : [...latest.modLibrary, saved],
    });
    setMode(null);
  }

  async function deleteMod() {
    if (!draft || !await confirmAppAction('删除 MOD', `确定删除「${draft.name}」？`, { confirmLabel: '删除' })) return;
    const latest = normalizeWritingModSettings(useTavernStore.getState().contentStyleSettings);
    updateSettings({
      modLibrary: latest.modLibrary.filter((item) => item.id !== draft.id),
    });
    setMode(null);
  }

  function toggleMod(id: string, enabled: boolean) {
    const latest = normalizeWritingModSettings(useTavernStore.getState().contentStyleSettings);
    updateSettings({ modLibrary: latest.modLibrary.map((item) => item.id === id ? { ...item, enabled } : item) });
  }

  async function importSample() {
    if (importLock.current || request.current) return;
    importLock.current = true;
    setImporting(true);
    try {
      const picked = await pickWritingModArticle();
      if (picked) setFiles((previous) => [...previous, picked]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取文章失败。';
      if (!message.includes('已取消')) showAppAlert('导入失败', message);
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  }

  async function extract() {
    if (request.current || importLock.current || !samples.length) return;
    const state = useTavernStore.getState();
    const apiSettings = resolveApiSettings(state.providers, state.generationSettings, { purpose: 'utility' });
    if (!apiSettings.apiKey.trim()) {
      showAppAlert('未配置 API Key', '请先在系统设置中配置后台模型或其跟随的写作模型的 API Key。');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const result = await extractWritingMod({
        apiSettings,
        sampleText: prepareWritingModSamples(samples),
        extractionPrompt: modExtractionPrompt,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const next = { id: generateId('mod'), ...result };
      setDraft(next);
      // Generated content is unsaved and requires the same discard protection as manual edits.
      setOriginalDraft({ id: next.id, name: '', content: '' });
      setMode('edit');
    } catch (error) {
      if (!controller.signal.aborted) showAppAlert('提取失败', error instanceof Error ? error.message : '请重试。');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <AccordionSection title="MOD" sectionNumber="02" description="独立启停 · 可同时启用多个" variant="settings" defaultOpen>
      {modLibrary.length ? (
        <View style={styles.stack}>
          <ThemedText type="smallBold">已启用 {modLibrary.filter((mod) => mod.enabled && mod.content.trim()).length} 个 MOD</ThemedText>
          {modLibrary.map((mod) => (
            <View key={mod.id} style={[styles.modRow, { borderColor: mod.enabled ? theme.accent : theme.border, backgroundColor: mod.enabled ? theme.accentMuted : theme.backgroundElement }]}>
              <Pressable accessibilityRole="button" accessibilityLabel={`查看 MOD：${mod.name}`}
                onPress={() => editMod(mod)} style={styles.modSelect}>
                <ThemedText type="smallBold">{mod.name}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">{mod.content.length} 字 · {mod.enabled ? '已启用' : '未启用'}</ThemedText>
              </Pressable>
              <ModButton label="查看内容 →" accessibilityLabel={`编辑 MOD：${mod.name}`} onPress={() => editMod(mod)} />
              <Switch accessibilityLabel={`启用 MOD：${mod.name}`} value={mod.enabled === true} disabled={!mod.content.trim()}
                onValueChange={(enabled) => toggleMod(mod.id, enabled)}
                trackColor={{ false: theme.backgroundSelected, true: theme.accentMuted }} thumbColor={mod.enabled ? theme.accent : theme.textMuted} />
            </View>
          ))}
        </View>
      ) : <ThemedText type="small" themeColor="textMuted">还没有 MOD。手动写下规则，或用一篇、几篇文章提炼出第一份。</ThemedText>}
      <View style={styles.actions}>
        <ModButton label="＋ 新建 MOD" onPress={() => editMod()} />
        <ModButton label="从文章提取" onPress={() => setMode('extract')} />
      </View>
      <ThemedText type="small" themeColor="textMuted">每个 MOD 独立启停，已启用的内容按列表顺序一起用于小说正文、小传与灵感对话。新建后默认关闭，编辑保留原状态。</ThemedText>

      <KeyboardSafeModal visible={mode !== null} onRequestClose={() => { void closeModal(); }}>
        <View style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <View style={styles.header}>
              <View style={styles.copy}>
                <ThemedText type="small" themeColor="accent">WRITING / MOD</ThemedText>
                <ThemedText type="smallBold">{mode === 'extract' ? '从文章提炼写作 MOD' : 'MOD 内容'}</ThemedText>
              </View>
              <ModButton label={busy ? '取消提取并返回' : '返回'} disabled={importing} onPress={() => { void closeModal(); }} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              {mode === 'edit' && draft ? <>
                <ThemedText type="smallBold">MOD 名称</ThemedText>
                <TextInput accessibilityLabel="MOD 名称" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })}
                  placeholder="例如：克制叙事、对白潜台词" placeholderTextColor={theme.textMuted} style={[styles.input, inputTheme]} />
                <ThemedText type="smallBold">写作规则与方法</ThemedText>
                <TextInput accessibilityLabel="MOD 内容" value={draft.content} onChangeText={(content) => setDraft({ ...draft, content })}
                  multiline textAlignVertical="top" placeholder="文风定位、核心写法、场景调度与偏离自检……" placeholderTextColor={theme.textMuted}
                  style={[styles.input, styles.contentInput, inputTheme]} />
                <ThemedText type="small" themeColor="textMuted">可直接修改。只有保存后的内容才会参与写作，文章样本和提取提示词不会一起注入。</ThemedText>
                <View style={styles.actions}>
                  {modLibrary.some((item) => item.id === draft.id) ? <ModButton label="删除 MOD" onPress={() => { void deleteMod(); }} /> : null}
                  <ModButton label="保存 MOD" onPress={saveMod} />
                </View>
              </> : null}
              {mode === 'extract' ? <>
                <ThemedText type="small" themeColor="textMuted">可粘贴文章，并逐篇导入最多 5 个 txt 文件。全文一次发送，不抽样、不截取；结果先预览，保存后进入 MOD 列表。</ThemedText>
                <ThemedText type="smallBold">当前提取模型：{extractionModel.model || '未配置'}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">在「系统设置 → 后台模型」切换比较模型；未单独设置时跟随写作模型。</ThemedText>
                <TextInput accessibilityLabel="文章样本" value={sampleText} onChangeText={setSampleText} editable={!busy && !importing}
                  multiline textAlignVertical="top" placeholder="粘贴文章正文；多篇可用标题分隔……" placeholderTextColor={theme.textMuted}
                  style={[styles.input, styles.sampleInput, inputTheme]} />
                {files.map((file, index) => <View key={index} style={[styles.modRow, { borderColor: theme.border }]}>
                  <View style={styles.copy}><ThemedText type="smallBold">{file.name}</ThemedText><ThemedText type="small" themeColor="textMuted">已载入全文 · {file.text.length.toLocaleString()} 字符</ThemedText></View>
                  <ModButton label="移除" disabled={busy || importing} onPress={() => setFiles(files.filter((_, i) => i !== index))} />
                </View>)}
                <ModButton label={importing ? '正在导入…' : '＋ 导入 txt 文章'} disabled={busy || importing || files.length >= 5} onPress={() => { void importSample(); }} />
                <ThemedText type="smallBold">待发送全文：{samples.length} 份 · {totalChars.toLocaleString()} 字符</ThemedText>
                <ThemedText type="small" themeColor="textMuted">字符数不等于 token 数，请选用容量足够的模型。超限时显示接口错误，不自动裁剪或改发摘要。原文仅供此次提取，不写入 MOD 设置。</ThemedText>
                <ModButton label={showPrompt ? '收起专属提取提示词 ↑' : '查看 / 编辑专属提取提示词 ↓'} onPress={() => setShowPrompt(!showPrompt)} />
                {showPrompt ? <View style={styles.stack}>
                  <ThemedText type="small" themeColor="textMuted">修改自动保存，仅影响 MOD 提取。留空时使用默认提示词。</ThemedText>
                  <TextInput accessibilityLabel="MOD 专属提取提示词" value={modExtractionPrompt} onChangeText={(modExtractionPrompt) => updateSettings({ modExtractionPrompt })}
                    editable={!busy} multiline textAlignVertical="top" style={[styles.input, styles.contentInput, inputTheme]} />
                  <ModButton label="恢复默认提取提示词" disabled={busy} onPress={() => updateSettings({ modExtractionPrompt: DEFAULT_MOD_EXTRACTION_PROMPT })} />
                </View> : null}
                <ModButton label={busy ? '正在分析文章并提炼…' : '提取并预览 MOD'} disabled={busy || importing || !samples.length} onPress={() => { void extract(); }} />
              </> : null}
            </ScrollView>
          </View>
        </View>
      </KeyboardSafeModal>
    </AccordionSection>
  );
}

function ModButton({ label, onPress, disabled = false, accessibilityLabel }: {
  label: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, { borderColor: theme.border, opacity: disabled ? 0.4 : pressed ? 0.65 : 1 }]}>
    <ThemedText type="smallBold" themeColor="accent">{label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  copy: { flex: 1, gap: 4 },
  stack: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two, borderWidth: 1, borderRadius: 12 },
  modSelect: { flex: 1, gap: 4, paddingVertical: Spacing.two },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, padding: Spacing.three, fontSize: 16 },
  contentInput: { minHeight: 320, lineHeight: 24 },
  sampleInput: { minHeight: 180, lineHeight: 24 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: Spacing.three },
  sheet: { maxHeight: '100%', width: '100%', maxWidth: 760, alignSelf: 'center', borderWidth: 1, borderRadius: 20, overflow: 'hidden', flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, gap: Spacing.two },
  body: { padding: Spacing.three, gap: Spacing.three },
});
