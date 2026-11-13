import { KeyboardAwareScrollView as ScrollView, KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing, type ThemePalette } from '@/constants/theme';
import { imageModelCatalogEntry } from '@/constants/image-models';
import { useTheme } from '@/hooks/use-theme';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { ModelRoutePicker } from '@/components/ModelRoutePicker';
import { buildImageModelRouteCatalog, imageModelDisplayName, resolveImageModelRoute } from '@/utils/image-model-route-catalog';
import { canAutoStartLocalComfy } from '@/services/local-comfy-launcher';
import { useTavernStore } from '@/store/tavern-store';
import {
  generateImage,
  imageProtocolSupportsReferenceImage,
} from '@/services/image-generation';
import { showAppAlert } from '@/utils/app-alert';
import {
  buildCharacterPrivatePortraitPrompt,
  buildCharacterPortraitPrompt,
  type CharacterPrivatePortraitPromptInput,
} from '@/utils/character-card-portraits';
import { pickNovelImage } from '@/utils/novel-images';
import { detectPortraitFocus, type PortraitFocus } from '@/utils/portrait-focus';

type CharacterPortraitPickerModalProps = {
  visible: boolean;
  gender?: string | null;
  currentUri?: string | null;
  /** Public portrait available as a face reference for private generations. */
  identityReferenceUri?: string | null;
  /** Private portrait available as a face reference for public generations. */
  privateReferenceUri?: string | null;
  portraitPrompt?: string;
  portraitPromptInput?: CharacterPrivatePortraitPromptInput;
  mode?: 'public' | 'private';
  onClose: () => void;
  onSelect: (uri: string | undefined, portraitFocus?: PortraitFocus) => void;
};

type PortraitReferenceSource = 'none' | 'current' | 'alternate';

export function CharacterPortraitPickerModal({
  visible,
  gender,
  currentUri,
  identityReferenceUri,
  privateReferenceUri,
  portraitPrompt,
  portraitPromptInput,
  mode = 'public',
  onClose: onCloseProp,
  onSelect,
}: CharacterPortraitPickerModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const imageGenerationSettings = useTavernStore((state) => state.imageGenerationSettings);
  const debugPromptInspectorEnabled = useTavernStore((state) => state.generationSettings.debugPromptInspectorEnabled);
  const [view, setView] = useState<'album' | 'generate'>('album');
  const [picking, setPicking] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState('');
  const [shootOutfit, setShootOutfit] = useState('');
  const [shootAction, setShootAction] = useState('');
  const [referenceSource, setReferenceSource] = useState<PortraitReferenceSource>('none');
  const [imageSize, setImageSize] = useState<'portrait' | 'square' | 'landscape'>('portrait');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [generationProgress, setGenerationProgress] = useState('');
  const [generationProviderId, setGenerationProviderId] = useState('');
  const [generationModelId, setGenerationModelId] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const generationAbortRef = useRef<AbortController | null>(null);

  function stopGeneration() {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setGenerating(false);
    setGenerationProgress('');
  }

  function handleClose() {
    stopGeneration();
    setModelPickerOpen(false);
    onCloseProp();
  }

  useEffect(() => {
    if (!visible) {
      generationAbortRef.current?.abort();
      generationAbortRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      const currentReference = currentUri?.trim() || '';
      const alternateReference = (
        mode === 'private' ? identityReferenceUri : privateReferenceUri
      )?.trim() || '';
      setReferenceSource(
        mode === 'private'
          ? alternateReference
            ? 'alternate'
            : currentReference
              ? 'current'
              : 'none'
          : currentReference
            ? 'current'
            : alternateReference
              ? 'alternate'
              : 'none',
      );
      setImageSize('portrait');
      setShootOutfit('');
      setShootAction('');
      setGenerationPrompt(
        portraitPromptInput
          ? mode === 'private'
            ? buildCharacterPrivatePortraitPrompt(portraitPromptInput, undefined, 0)
            : buildCharacterPortraitPrompt(portraitPromptInput, undefined, 0)
          : portraitPrompt?.trim() ?? '',
      );
      setGenerationError('');
      setGenerationProgress('');
      const imageSettings = useTavernStore.getState().imageGenerationSettings;
      setGenerationProviderId(imageSettings.providerId);
      setGenerationModelId(imageSettings.providers[imageSettings.providerId]?.modelId ?? '');
      setModelPickerOpen(false);
      setGenerating(false);
      setView(mode === 'private' ? 'generate' : 'album');
    }, 0);
    return () => clearTimeout(timer);
  }, [
    currentUri,
    identityReferenceUri,
    mode,
    portraitPrompt,
    portraitPromptInput,
    privateReferenceUri,
    visible,
  ]);

  useEffect(() => () => {
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
  }, []);

  const alternateReferenceUri = useMemo(
    () => (mode === 'private' ? identityReferenceUri : privateReferenceUri)?.trim() || '',
    [identityReferenceUri, mode, privateReferenceUri],
  );

  const referenceOptions = useMemo(() => {
    const currentReference = currentUri?.trim() || '';
    return [
      {
        id: 'current' as const,
        label: mode === 'private' ? '当前私密照片' : '当前公开立绘',
        uri: currentReference,
      },
      {
        id: 'alternate' as const,
        label: mode === 'private' ? '公开立绘' : '私密照片',
        uri: alternateReferenceUri,
      },
    ].filter((option) => Boolean(option.uri));
  }, [alternateReferenceUri, currentUri, mode]);

  const referenceUri = useMemo(() => {
    const option = referenceOptions.find((item) => item.id === referenceSource);
    return option?.uri || '';
  }, [referenceOptions, referenceSource]);

  async function handlePickAlbum() {
    if (picking) {
      return;
    }
    setPicking(true);
    try {
      const uri = await pickNovelImage('portrait');
      if (uri) {
        const portraitFocus = await detectPortraitFocus(uri, gender);
        onSelect(uri, portraitFocus);
        handleClose();
      }
    } catch (error) {
      showAppAlert(
        '选择失败',
        error instanceof Error ? error.message : '无法选择图片。',
      );
    } finally {
      setPicking(false);
    }
  }

  async function handleGeneratePortrait() {
    if (generating) {
      return;
    }
    let route: ReturnType<typeof resolveImageModelRoute>;
    try {
      route = resolveImageModelRoute(imageGenerationSettings.providers, generationModelId, generationProviderId);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '请先选择可用的图像模型。');
      return;
    }
    const { provider, modelId: model } = route;
    const baseUrl = provider.baseUrl.trim();
    const basePrompt = generationPrompt.trim();
    const cleanPrompt = [
      basePrompt,
      shootOutfit.trim() ? `本次穿搭：${shootOutfit.trim()}。` : '',
      shootAction.trim() ? `本次动作：${shootAction.trim()}。` : '',
    ].filter(Boolean).join('\n');

    if ((provider.auth === 'bearer' || provider.auth === 'x-api-key' || provider.auth === 'x-goog-api-key') && !provider.apiKey.trim()) {
      setGenerationError(`请先在「模型连接 → 图像引擎」填写「${provider.name}」的 API Key。`);
      return;
    }
    if (!basePrompt) {
      setGenerationError('请先填写人像提示词。');
      return;
    }
    if (referenceUri && !supportsIdentityReference) {
      setGenerationError('当前图像模型不支持通过此接口使用参考图，请切换模型或取消参考图。');
      return;
    }

    const dimensions = imageSize === 'square'
      ? { width: 1024, height: 1024 }
      : imageSize === 'landscape'
        ? { width: 1024, height: 768 }
        : { width: 768, height: 1024 };

    setGenerating(true);
    setGenerationError('');
    setGenerationProgress(`准备提交到${provider.name}…`);
    const controller = new AbortController();
    generationAbortRef.current = controller;
    try {
      const result = await generateImage({
        apiSettings: {
          baseUrl,
          apiKey: provider.apiKey,
          protocol: provider.protocol,
          auth: provider.auth,
          providerId: provider.id,
          providerName: provider.name,
          debugPromptInspectorEnabled,
        },
        purpose: 'portrait',
        prompt: cleanPrompt,
        model,
        referenceImageUri: referenceUri || undefined,
        ...dimensions,
        signal: controller.signal,
        onProgress: (progress) => {
          if (generationAbortRef.current === controller && !controller.signal.aborted) {
            setGenerationProgress(progress.message ?? progress.phase);
          }
        },
      });
      if (controller.signal.aborted || !visible) return;
      const portraitFocus = await detectPortraitFocus(result.uri, gender);
      if (controller.signal.aborted || !visible) return;
      onSelect(result.uri, portraitFocus);
      handleClose();
    } catch (error) {
      if (controller.signal.aborted) return;
      setGenerationError(error instanceof Error ? error.message : '图像生成失败，请稍后重试。');
    } finally {
      if (generationAbortRef.current === controller) {
        generationAbortRef.current = null;
        setGenerating(false);
        setGenerationProgress('');
      }
    }
  }

  const selectedImageProvider = generationProviderId
    ? imageGenerationSettings.providers[generationProviderId]
    : undefined;
  const selectedImageModel = imageModelCatalogEntry(generationModelId);
  const selectedImageProtocol =
    !selectedImageProvider?.protocol || selectedImageProvider.protocol === 'auto'
      ? selectedImageModel?.protocol
      : selectedImageProvider.protocol;
  const supportsIdentityReference = imageProtocolSupportsReferenceImage(selectedImageProtocol);
  const imageModelCatalog = useMemo(() => buildImageModelRouteCatalog(
    imageGenerationSettings.providers, generationProviderId,
  ), [imageGenerationSettings.providers, generationProviderId]);

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={handleClose} scrollable>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={handleClose} />
        <View
          style={[
            styles.sheet,
            {
              maxHeight: height * 0.88,
              paddingBottom: Math.max(insets.bottom, Spacing.three),
            },
          ]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{mode === 'private' ? '私密影像' : '选择立绘'}</Text>
              <Text style={styles.subtitle}>
                {mode === 'private'
                  ? '与公开立绘分开保存，可把公开立绘或现有私密照片作为脸部参考；场景、服装与动作由本次拍摄决定。'
                  : '为当前角色上传独立图片，或根据人物档案生成专属立绘。'}
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={8}>
              <Text style={styles.link}>关闭</Text>
            </Pressable>
          </View>

          <View style={styles.viewTabs}>
            <Pressable
              onPress={() => setView('album')}
              style={[styles.viewTab, view === 'album' && styles.viewTabActive]}>
              <Text style={[styles.viewTabText, view === 'album' && styles.viewTabTextActive]}>
                本地图片
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setView('generate')}
              style={[styles.viewTab, view === 'generate' && styles.viewTabActive]}>
              <Text style={[styles.viewTabText, view === 'generate' && styles.viewTabTextActive]}>
                AI 生成
              </Text>
            </Pressable>
          </View>

          {view === 'album' ? (
            <View style={styles.albumPanel}>
              <Pressable
                onPress={() => void handlePickAlbum()}
                disabled={picking}
                style={({ pressed }) => [
                  styles.albumDropzone,
                  (pressed || picking) && { opacity: 0.7 },
                ]}>
                {picking ? (
                  <ActivityIndicator color={theme.primary} />
                ) : (
                  <>
                    <Text style={styles.albumMark}>＋</Text>
                    <Text style={styles.albumTitle}>从设备选择角色图片</Text>
                    <Text style={styles.albumHint}>图片只属于当前角色，不会保存为可复用图库</Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={styles.generatePanel}>
              <View style={styles.referenceSection}>
                <View style={styles.shootDirectionHeader}>
                  <Text style={styles.shootDirectionTitle}>脸部参考</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.styleChips}>
                  {referenceOptions.map((item) => {
                    const active = referenceSource === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setReferenceSource(active ? 'none' : item.id)}
                        style={[styles.styleChip, active && styles.styleChipActive]}>
                        <Text style={[styles.styleChipText, active && styles.styleChipTextActive]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {referenceUri ? (
                  <View style={styles.identityLockRow}>
                    <Image
                      source={{ uri: referenceUri }}
                      style={styles.identityThumb}
                      contentFit="cover"
                    />
                    <View style={styles.identityLockCopy}>
                      <Text style={styles.identityLockTitle}>
                        {supportsIdentityReference ? '参考图已选择' : '当前协议不支持参考图'}
                      </Text>
                      <Text style={styles.identityLockHint}>
                        {supportsIdentityReference
                          ? '只保持脸部一致；发型、服装、姿势、动作与场景按本次提示词生成。'
                          : '当前图像连接不支持参考图，请选择其他连接。'}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.referenceHint}>不附带参考图，完全按当前提示词生成。</Text>
                )}
              </View>
              <View style={styles.shootDirection}>
                <View style={styles.shootDirectionHeader}>
                  <Text style={styles.shootDirectionTitle}>本次拍摄</Text>
                </View>
                <View style={[styles.shootFieldRow, width < 560 && styles.shootFieldRowCompact]}>
                  <View style={styles.shootField}>
                    <Text style={styles.shootFieldLabel}>穿搭</Text>
                    <TextInput
                      value={shootOutfit}
                      onChangeText={setShootOutfit}
                      placeholder="例如：灰色连帽衫、旧牛仔裤、白色球鞋"
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.shootInput,
                        {
                          color: theme.text,
                          borderColor: theme.outlineVariant,
                          backgroundColor: theme.surface,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.shootField}>
                    <Text style={styles.shootFieldLabel}>动作</Text>
                    <TextInput
                      value={shootAction}
                      onChangeText={setShootAction}
                      placeholder="例如：站在窗边，低头翻阅手里的书"
                      placeholderTextColor={theme.textMuted}
                      style={[
                        styles.shootInput,
                        {
                          color: theme.text,
                          borderColor: theme.outlineVariant,
                          backgroundColor: theme.surface,
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
              <TextInput
                value={generationPrompt}
                onChangeText={setGenerationPrompt}
                multiline
                numberOfLines={8}
                textAlignVertical="top"
                placeholder="系统生成的最终提示词会显示在这里，你也可以继续手动微调"
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.promptInput,
                  {
                    color: theme.text,
                    borderColor: theme.outlineVariant,
                    backgroundColor: theme.surface,
                  },
                ]}
              />
              <View style={styles.imageSizeSection}>
                <Text style={styles.shootDirectionTitle}>图像模型</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="选择本次图像模型"
                  accessibilityState={{ disabled: generating }}
                  disabled={generating}
                  onPress={() => setModelPickerOpen(true)}
                  style={[styles.providerSelect, { borderColor: theme.outlineVariant, backgroundColor: theme.surface }, generating && { opacity: 0.55 }]}>
                  <View style={styles.providerSelectCopy}>
                    <Text style={styles.providerSelectTitle}>{imageModelDisplayName(generationModelId)}</Text>
                    <Text style={styles.providerSelectHint}>
                      {selectedImageProvider ? `使用接口：${selectedImageProvider.name}` : '在“模型连接 → 图像引擎”中配置接口'}
                    </Text>
                  </View>
                  <Text style={styles.providerSelectArrow}>选择 ›</Text>
                </Pressable>
                {selectedImageProtocol === 'comfyui' && canAutoStartLocalComfy(selectedImageProvider?.baseUrl ?? '') ? (
                  <Text style={styles.generateMeta}>本地服务未运行时会自动后台启动，就绪后继续生成。</Text>
                ) : null}
                <Text style={styles.shootDirectionTitle}>图片尺寸</Text>
                <View style={styles.imageSizeRow}>
                  {[
                    { id: 'portrait' as const, label: '竖图 768×1024' },
                    { id: 'square' as const, label: '方图 1024×1024' },
                    { id: 'landscape' as const, label: '横图 1024×768' },
                  ].map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => setImageSize(item.id)}
                      style={[styles.imageSizeChip, imageSize === item.id && styles.imageSizeChipActive]}>
                      <Text style={[styles.imageSizeChipText, imageSize === item.id && styles.imageSizeChipTextActive]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={styles.generateMeta}>
                {imageModelDisplayName(generationModelId)}
                {generationProviderId
                  ? ` · ${selectedImageProvider?.name ?? '未找到接口'}`
                  : ' · 未选择图像接口'}
              </Text>
              {generationProgress ? <Text accessibilityLiveRegion="polite" style={styles.generateProgress}>{generationProgress}</Text> : null}
              {generationError ? <Text style={styles.generateError}>{generationError}</Text> : null}
            </View>
          )}

          {view === 'generate' ? (
            <View style={styles.actions}>
              <Pressable
                onPress={() => void handleGeneratePortrait()}
                disabled={generating}
                style={({ pressed }) => [styles.primaryBtn, (pressed || generating) && { opacity: 0.75 }]}>
                {generating ? (
                  <ActivityIndicator color={theme.onPrimary} />
                ) : (
                  <Text style={styles.primaryBtnText}>生成并使用</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
      <ModelRoutePicker
        visible={modelPickerOpen}
        title="选择图像模型"
        description="先选模型，再使用已配置的图像接口"
        catalog={imageModelCatalog}
        selectedModelId={generationModelId}
        selectedProviderId={generationProviderId}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(modelId, providerId) => {
          setGenerationModelId(modelId);
          setGenerationProviderId(providerId);
          setGenerationError('');
          setModelPickerOpen(false);
        }}
      />
    </KeyboardSafeModal>
  );
}

function createStyles(theme: ThemePalette) {
  return StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.scrim,
  },
  dismiss: {
    flex: 1,
  },
  sheet: {
    backgroundColor: theme.surfaceElevated,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: theme.outlineVariant,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.text,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 12,
    color: theme.textSecondary,
    lineHeight: 17,
  },
  link: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.primary,
  },
  viewTabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: theme.outlineVariant,
  },
  viewTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  viewTabActive: {
    borderBottomColor: theme.primary,
  },
  viewTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.textMuted,
  },
  viewTabTextActive: {
    color: theme.primary,
  },
  albumPanel: {
    paddingHorizontal: Spacing.three,
  },
  albumDropzone: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: Spacing.four,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.primary,
    borderRadius: 16,
    backgroundColor: theme.surface,
  },
  albumMark: {
    color: theme.primary,
    fontSize: 36,
    fontWeight: '300',
    lineHeight: 40,
  },
  albumTitle: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '800',
  },
  albumHint: {
    maxWidth: 320,
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  generatePanel: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  styleChips: {
    gap: 7,
    paddingRight: Spacing.three,
  },
  shootDirection: {
    gap: 7,
  },
  shootDirectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  shootDirectionTitle: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '800',
  },
  shootFieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  shootFieldRowCompact: {
    flexDirection: 'column',
  },
  shootField: {
    flex: 1,
    gap: 4,
  },
  shootFieldLabel: {
    color: theme.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  shootInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  referenceSection: {
    gap: 9,
  },
  referenceHint: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  identityLockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.outlineVariant,
    borderRadius: 12,
    backgroundColor: theme.surface,
  },
  identityThumb: {
    width: 42,
    height: 52,
    borderRadius: 8,
    backgroundColor: theme.outlineVariant,
  },
  identityLockCopy: {
    flex: 1,
    gap: 2,
  },
  identityLockTitle: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '800',
  },
  identityLockHint: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  imageSizeSection: {
    gap: 7,
  },
  providerSelect: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  providerSelectCopy: {
    flex: 1,
    gap: 3,
  },
  providerSelectTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  providerSelectHint: {
    color: theme.textMuted,
    fontSize: 11,
  },
  providerSelectArrow: {
    color: theme.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  imageSizeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  imageSizeChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.outlineVariant,
    borderRadius: 999,
    backgroundColor: theme.surface,
  },
  imageSizeChipActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primaryContainer,
  },
  imageSizeChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.textSecondary,
  },
  imageSizeChipTextActive: {
    color: theme.primary,
  },
  styleChip: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.outlineVariant,
    borderRadius: 999,
    backgroundColor: theme.surface,
  },
  styleChipActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primaryContainer,
  },
  styleChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.textSecondary,
  },
  styleChipTextActive: {
    color: theme.primary,
  },
  promptInput: {
    minHeight: 190,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 13,
    lineHeight: 19,
  },
  generateMeta: {
    fontSize: 11,
    color: theme.textMuted,
  },
  generateProgress: {
    fontSize: 12,
    color: theme.primary,
    lineHeight: 17,
  },
  generateError: {
    fontSize: 12,
    color: theme.error,
    lineHeight: 17,
  },
  actions: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  primaryBtn: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.primary,
  },
  primaryBtnText: {
    color: theme.onPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  });
}
