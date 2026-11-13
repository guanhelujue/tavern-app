import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { TaskModelSelector } from '@/components/TaskModelSelector';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { COMIC_DIMENSIONS } from '@/constants/novel-comic';
import { IMAGE_MODEL_CATALOG, LOCAL_IMAGE_MODEL_IDS, type LocalImageModelId } from '@/constants/image-models';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore, resolveApiSettings } from '@/store/tavern-store';
import { comicSourceHash, planNovelComic, type ComicStoryMode } from '@/services/novel-comic-planner';
import { loadNovelComic, saveNovelComic } from '@/services/novel-comic-storage';
import { collectComicCharacters, generateNovelComicImages } from '@/services/novel-comic-renderer';
import { resolveNovelImageUri } from '@/utils/novel-images';
import type { ComicPage, ComicPanel, ComicSourceKind, NovelComicDocument } from '@/types/novel-comic';
import type { ImageApiSettings } from '@/services/image-generation';

type Props = {
  visible: boolean;
  novelId: string;
  sourceId: string;
  sourceKind: ComicSourceKind;
  sourceTitle: string;
  content: string;
  onClose: () => void;
};

const MODEL_OPTIONS = LOCAL_IMAGE_MODEL_IDS;
const LAYOUT_LABELS: Record<string, string> = { 'daily-grid': '日常四格', 'daily-focus': '日常主镜头', 'battle-action': '战斗动作', 'battle-impact': '战斗冲击' };
const ASPECT_LABELS: Record<string, string> = { portrait: '竖幅', square: '方形', landscape: '横幅', wide: '宽幅', tall: '长竖幅' };

export function NovelComicModal({ visible, novelId, sourceId, sourceKind, sourceTitle, content, onClose }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  const providers = useTavernStore((state) => state.providers);
  const generationSettings = useTavernStore((state) => state.generationSettings);
  const [document, setDocument] = useState<NovelComicDocument | null>(null);
  const [pageCount, setPageCount] = useState('2');
  const [storyMode, setStoryMode] = useState<ComicStoryMode>('auto');
  const [modelId, setModelId] = useState<LocalImageModelId>('qwen-image-2.1');
  const [previewMode, setPreviewMode] = useState<'pages' | 'panels'>('pages');
  const [busy, setBusy] = useState<'loading' | 'planning' | 'generating' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const mountedRef = useRef(true);

  const sourceChanged = Boolean(document && document.sourceHash !== comicSourceHash(content.trim()));
  const hasPlan = Boolean(document?.pages.length);
  const canGenerate = Boolean(document && !sourceChanged && document.pages.length && document.pages.some((p) => p.status !== 'completed' || !p.imageUri || p.panels.some((panel) => panel.status !== 'completed' || !panel.imageUri)));
  const imageSettings = useTavernStore((state) => state.imageGenerationSettings);
  const imageProvider = imageSettings.providers[imageSettings.providerId];
  const imageApiSettings = useMemo(() => imageProvider && imageProvider.protocol === 'comfyui'
    ? { ...imageProvider, providerId: imageProvider.id, providerName: imageProvider.name,
        debugPromptInspectorEnabled: generationSettings.debugPromptInspectorEnabled } satisfies ImageApiSettings
    : null, [imageProvider, generationSettings.debugPromptInspectorEnabled]);
  const imageError = imageProvider ? (imageProvider.protocol === 'comfyui' ? null : '当前图片服务不是本地 ComfyUI，请在图片设置中选择 ComfyUI。') : '未配置图片生成服务，请先在图片设置中配置 ComfyUI。';

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current += 1; controller.current?.abort(); controller.current = null; };
  }, []);

  useEffect(() => {
    if (!visible) {
      controller.current?.abort();
      controller.current = null;
      return;
    }
    let cancelled = false;
    const operation = ++operationRef.current;
    const active = () => !cancelled && mountedRef.current && operation === operationRef.current;
    void Promise.resolve().then(() => { if (!active()) return; setError(null); setStatus(''); setBusy('loading'); return loadNovelComic(novelId, sourceKind, sourceId); })
      .then((loaded) => { if (active()) { setDocument(loaded ?? null); setPageCount(String(loaded?.pages.length ?? 2)); setModelId(loaded && LOCAL_IMAGE_MODEL_IDS.includes(loaded.modelId as LocalImageModelId) ? loaded.modelId as LocalImageModelId : 'qwen-image-2.1'); } })
      .catch((cause) => { if (active()) setError(cause instanceof Error ? cause.message : '读取分镜失败。'); })
      .finally(() => { if (active()) setBusy(null); });
    return () => { cancelled = true; controller.current?.abort(); };
  }, [visible, novelId, sourceId, sourceKind]);

  async function handlePlan() {
    if (!content.trim() || busy) return;
    setError(null); setStatus('正在让语言模型拆分正文…'); setBusy('planning');
    const nextController = new AbortController(); controller.current = nextController; const operation = ++operationRef.current;
    try {
      if (!novel) throw new Error('找不到当前小说。');
      const characters = collectComicCharacters(novel, content);
      const planned = await planNovelComic({
        novelId, sourceId, sourceKind, sourceTitle, content,
        characters,
        apiSettings: resolveApiSettings(providers, generationSettings, { task: 'comic', purpose: 'utility' }),
        pageCount: Math.max(1, Math.min(6, Number(pageCount) || 2)), storyMode,
        signal: nextController.signal,
      });
      planned.modelId = modelId;
      if (!mountedRef.current || operation !== operationRef.current) return;
      await saveNovelComic(planned);
      if (!mountedRef.current || operation !== operationRef.current) return;
      setDocument(planned);
      setStatus(`已规划 ${planned.pages.length} 页，共 ${planned.pages.reduce((n, page) => n + page.panels.length, 0)} 格。`);
    } catch (cause) {
      if (!nextController.signal.aborted && mountedRef.current && operation === operationRef.current) setError(cause instanceof Error ? cause.message : '规划分镜失败。');
    } finally { if (controller.current === nextController) controller.current = null; if (operation === operationRef.current && mountedRef.current) setBusy(null); }
  }

  async function handleGenerate() {
    if (!document || sourceChanged || busy || !canGenerate || !imageApiSettings) return;
    setError(null); setBusy('generating'); setStatus('正在生成写实分镜…');
    const nextController = new AbortController(); controller.current = nextController; const operation = ++operationRef.current;
    const selected = { ...document, modelId };
    if (mountedRef.current) setDocument(selected);
    try {
      await generateNovelComicImages({
        document: selected,
        apiSettings: imageApiSettings,
        signal: nextController.signal,
        onUpdate: async (next: NovelComicDocument) => { await saveNovelComic(next); if (mountedRef.current && operation === operationRef.current) setDocument(next); },
        onProgress: (message) => { if (mountedRef.current && operation === operationRef.current) setStatus(message); },
      });
      if (mountedRef.current && operation === operationRef.current) setStatus('分镜图片已生成。');
    } catch (cause) {
        if (!nextController.signal.aborted && operation === operationRef.current) setError(cause instanceof Error ? cause.message : '生成分镜失败。');
    } finally { if (controller.current === nextController) controller.current = null; if (operation === operationRef.current && mountedRef.current) setBusy(null); }
  }

  function stop() { operationRef.current += 1; controller.current?.abort(); controller.current = null; if (mountedRef.current) { setBusy(null); setStatus('已停止，可继续生成未完成的分镜。'); } }
  function closeModal() { stop(); onClose(); }

  async function selectModel(nextModel: LocalImageModelId) {
    if (busy || nextModel === modelId) return;
    if (!document) { setModelId(nextModel); return; }
    const next: NovelComicDocument = { ...document, modelId: nextModel, status: 'planned', error: undefined,
      updatedAt: new Date().toISOString(),
      characters: document.characters.map((character) => ({ ...character, referenceComfyPromptId: undefined })),
      pages: document.pages.map((page) => ({ ...page, status: 'pending', imageUri: undefined,
        comfyPromptId: undefined, comfyOutput: undefined, error: undefined,
        panels: page.panels.map((panel) => ({ ...panel, status: 'pending', imageUri: undefined,
          comfyPromptId: undefined, comfyOutput: undefined, error: undefined })),
      })),
    };
    try { await saveNovelComic(next); setModelId(nextModel); setDocument(next); setStatus('已切换模型，角色原图继续沿用，分镜将重新生成。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存模型选择失败。'); }
  }

  async function updatePanel(panel: ComicPanel, prompt: string) {
    if (busy) return;
    if (!document || !prompt.trim()) { setError('提示词不能为空。'); return; }
    const page = document.pages.find((item) => item.panels.some((candidate) => candidate.id === panel.id));
    if (!page) return;
    const next: NovelComicDocument = {
      ...document,
      updatedAt: new Date().toISOString(),
      status: 'planned',
      pages: document.pages.map((item) => item.id === page.id ? { ...item, imageUri: undefined, comfyPromptId: undefined, comfyOutput: undefined, status: 'pending', panels: item.panels.map((candidate) => candidate.id === panel.id ? { ...candidate, prompt: prompt.trim(), imageUri: undefined, comfyPromptId: undefined, comfyOutput: undefined, status: 'pending', error: undefined } : candidate) } : item),
    };
    try { await saveNovelComic(next); setDocument(next); } catch (cause) { setError(cause instanceof Error ? cause.message : '保存提示词失败。'); }
  }

  async function rerenderPanel(panel: ComicPanel) {
    if (!document || busy || sourceChanged || !imageApiSettings) return;
    const operation = ++operationRef.current; const nextController = new AbortController(); controller.current = nextController;
    setBusy('generating'); setError(null); setStatus(`重新生成第 ${panel.index + 1} 格…`);
    try { await generateNovelComicImages({ document: { ...document, modelId }, apiSettings: imageApiSettings, signal: nextController.signal, onlyPanelId: panel.id, onUpdate: async (next) => { await saveNovelComic(next); if (mountedRef.current && operation === operationRef.current) setDocument(next); }, onProgress: (message) => { if (mountedRef.current && operation === operationRef.current) setStatus(message); } }); }
    catch (cause) { if (!nextController.signal.aborted && operation === operationRef.current) setError(cause instanceof Error ? cause.message : '重新生成失败。'); }
    finally { if (controller.current === nextController) controller.current = null; if (operation === operationRef.current && mountedRef.current) setBusy(null); }
  }

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={closeModal}>
      <View style={[styles.overlay, { backgroundColor: theme.scrim }]}>
        <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: insets.bottom }]}>
          <View style={styles.header}><View><ThemedText type="smallBold">写实连续分镜</ThemedText><ThemedText type="small" themeColor="textMuted">{sourceTitle || '当前正文'}</ThemedText></View><Pressable onPress={closeModal}><ThemedText themeColor="textMuted">✕</ThemedText></Pressable></View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <TaskModelSelector task="comic" disabled={Boolean(busy)} />
            <>
              <ThemedText type="small" themeColor="textSecondary">先让语言模型按正文拆分页面和镜头，再把提示词送入 ComfyUI。输出是现实世界摄影，不是漫画风格。</ThemedText>
              <View style={styles.row}><Field label="页数" value={pageCount} onChangeText={setPageCount} keyboardType="number-pad" /><View style={styles.modeBox}><ThemedText type="small" themeColor="textMuted">故事模式</ThemedText><View style={styles.chips}>{(['auto', 'daily', 'battle'] as ComicStoryMode[]).map((mode) => <Chip key={mode} label={mode === 'auto' ? '自动' : mode === 'daily' ? '日常' : '战斗'} selected={storyMode === mode} onPress={() => setStoryMode(mode)} />)}</View></View></View>
            </>
            <View style={styles.section}><ThemedText type="smallBold">图像模型</ThemedText><ThemedText type="small" themeColor="textMuted">默认 Qwen。切换模型会重新生成分镜，角色原图继续沿用。</ThemedText><View style={styles.chips}>{MODEL_OPTIONS.map((id) => <Chip key={id} label={IMAGE_MODEL_CATALOG.find((entry) => entry.id === id)?.label ?? id} selected={modelId === id} onPress={() => void selectModel(id)} />)}</View></View>
            {imageError ? <ThemedText type="small" style={{ color: theme.error }}>{imageError}</ThemedText> : null}
            <View style={styles.actions}><Action label={busy === 'planning' ? '规划中…' : hasPlan ? '重新规划分镜' : '规划分镜'} onPress={() => void handlePlan()} disabled={Boolean(busy) || !content.trim()} primary /><Action label={busy === 'generating' ? '生成中…' : canGenerate ? '生成图片' : '继续生成未完成'} onPress={() => void handleGenerate()} disabled={Boolean(busy) || !canGenerate || !imageApiSettings} /><Action label="停止" onPress={stop} disabled={!busy} /></View>
            {sourceChanged ? <ThemedText type="small" style={{ color: theme.error }}>正文已变化，请重新规划后再生成。</ThemedText> : null}
            {status ? <ThemedText type="small" themeColor="textSecondary">{status}</ThemedText> : null}
            {error ? <ThemedText type="small" style={{ color: theme.error }}>{error}</ThemedText> : null}
            {document?.pages.length ? <View style={styles.section}><View style={styles.chips}><Chip label="页面预览" selected={previewMode === 'pages'} onPress={() => setPreviewMode('pages')} /><Chip label="逐幕预览" selected={previewMode === 'panels'} onPress={() => setPreviewMode('panels')} /></View></View> : null}
            {document?.pages.map((page) => <PageEditor key={page.id} page={page} theme={theme} previewMode={previewMode} busy={Boolean(busy) || sourceChanged} onCommit={(panel, prompt) => void updatePanel(panel, prompt)} onRerender={(panel) => void rerenderPanel(panel)} />)}
          </ScrollView>
        </View>
      </View>
    </KeyboardSafeModal>
  );
}

function PageEditor({ page, theme, previewMode, busy, onCommit, onRerender }: { page: ComicPage; theme: ReturnType<typeof useTheme>; previewMode: 'pages' | 'panels'; busy: boolean; onCommit: (panel: ComicPanel, prompt: string) => void; onRerender: (panel: ComicPanel) => void }) {
  return <View style={[styles.pageCard, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">第 {page.index + 1} 页 · {page.kind === 'battle' ? '战斗' : '日常'} · {LAYOUT_LABELS[page.layout] ?? page.layout}</ThemedText>{previewMode === 'pages' && resolveNovelImageUri(page.imageUri) ? <Image source={{ uri: resolveNovelImageUri(page.imageUri) }} style={styles.pagePreview} contentFit="contain" /> : null}{page.panels.map((panel) => <PanelEditor key={`${panel.id}:${panel.prompt}`} panel={panel} theme={theme} onCommit={(prompt) => onCommit(panel, prompt)} onRerender={() => onRerender(panel)} hideImage={previewMode === 'pages'} busy={busy} />)}</View>;
}

function PanelEditor({ panel, theme, onCommit, onRerender, hideImage, busy }: { panel: ComicPanel; theme: ReturnType<typeof useTheme>; onCommit: (prompt: string) => void; onRerender: () => void; hideImage: boolean; busy: boolean }) {
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState(panel.prompt);
  const dimensions = COMIC_DIMENSIONS[panel.aspect];
  return <View style={[styles.panel, { borderColor: theme.border }]}><Pressable onPress={() => setOpen(!open)} style={styles.panelHeader}><View style={{ flex: 1 }}><ThemedText type="smallBold">第 {panel.index + 1} 格 · {panel.status === 'completed' ? '已完成' : panel.status === 'error' ? '失败' : '待生成'}</ThemedText><ThemedText type="small" themeColor="textMuted">{ASPECT_LABELS[panel.aspect] ?? panel.aspect} · {dimensions.width}×{dimensions.height}</ThemedText></View><ThemedText themeColor="accent">{open ? '收起' : '编辑'}</ThemedText></Pressable>{!hideImage && resolveNovelImageUri(panel.imageUri) ? <Image source={{ uri: resolveNovelImageUri(panel.imageUri) }} style={[styles.preview, { aspectRatio: panel.width / panel.height }]} contentFit="contain" /> : null}{panel.status === 'completed' ? <Pressable disabled={busy} onPress={onRerender} style={[styles.rerender, { borderColor: theme.border }, busy && { opacity: 0.4 }]}><ThemedText type="small" themeColor="accent">重新生成这一幕</ThemedText></Pressable> : null}{open ? <><TextInput editable={!busy} value={draft} onChangeText={setDraft} multiline style={[styles.prompt, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]} /><Pressable disabled={busy} onPress={() => onCommit(draft.trim())} style={[styles.savePrompt, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: '#120c09' }}>保存此格提示词</ThemedText></Pressable></> : null}</View>;
}

function Field({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'number-pad' }) { return <View style={{ width: 90, gap: 4 }}><ThemedText type="small" themeColor="textMuted">{label}</ThemedText><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={styles.input} /></View>; }
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { const theme = useTheme(); return <Pressable onPress={onPress} style={[styles.chip, { borderColor: selected ? theme.accent : theme.border, backgroundColor: selected ? theme.accentMuted : 'transparent' }]}><ThemedText type="small" style={{ color: selected ? theme.accent : theme.text }}>{label}</ThemedText></Pressable>; }
function Action({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) { const theme = useTheme(); return <Pressable disabled={disabled} onPress={onPress} style={[styles.action, { backgroundColor: primary ? theme.accent : theme.backgroundElement, borderColor: theme.border }, disabled && { opacity: 0.4 }]}><ThemedText type="smallBold" style={primary ? { color: '#120c09' } : undefined}>{label}</ThemedText></Pressable>; }

const styles = StyleSheet.create({ overlay: { flex: 1 }, sheet: { flex: 1, marginTop: 36, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three }, body: { padding: Spacing.three, gap: Spacing.three }, row: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-end' }, modeBox: { flex: 1, gap: 6 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 }, section: { gap: 6 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, action: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 40, alignItems: 'center', justifyContent: 'center' }, pageCard: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 10 }, panel: { borderWidth: 1, borderRadius: 12, padding: 8, gap: 8 }, panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, preview: { width: '100%', aspectRatio: 0.75, borderRadius: 8 }, pagePreview: { width: '100%', aspectRatio: 1536 / 2304, borderRadius: 8 }, rerender: { borderWidth: 1, borderRadius: 8, padding: 8, alignItems: 'center' }, prompt: { minHeight: 130, borderWidth: 1, borderRadius: 8, padding: 8, textAlignVertical: 'top' }, savePrompt: { borderRadius: 8, padding: 10, alignItems: 'center' }, input: { borderWidth: 1, borderColor: '#777', borderRadius: 8, padding: 8, color: '#fff' } });
