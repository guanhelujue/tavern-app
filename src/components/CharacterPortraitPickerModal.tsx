import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing, type ThemePalette } from '@/constants/theme';
import { DEFAULT_IMAGE_MODEL, imageModelCatalogEntry } from '@/constants/image-models';
import { useTheme } from '@/hooks/use-theme';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { useTavernStore } from '@/store/tavern-store';
import {
  generateImage,
  imageProtocolSupportsReferenceImage,
} from '@/services/image-generation';
import { showAppAlert } from '@/utils/app-alert';
import {
  CHARACTER_PRIVATE_PORTRAIT_SCENES,
  CHARACTER_PORTRAIT_STYLES,
  buildCharacterPrivatePortraitPrompt,
  buildCharacterPortraitPrompt,
  resolvePortraitDisplayUri,
  type CharacterPortraitPromptInput,
  type CharacterPrivatePortraitSceneId,
  type CharacterPortraitStyleId,
} from '@/utils/character-card-portraits';
import { pickNovelImage } from '@/utils/novel-images';
import { detectPortraitFocus, type PortraitFocus } from '@/utils/portrait-focus';

type CharacterPortraitPickerModalProps = {
  visible: boolean;
  gender?: string | null;
  currentUri?: string | null;
  /** Public portrait used to keep private generations recognizably the same person. */
  identityReferenceUri?: string | null;
  portraitPrompt?: string;
  portraitPromptInput?: CharacterPortraitPromptInput;
  mode?: 'public' | 'private';
  onClose: () => void;
  onSelect: (uri: string | undefined, portraitFocus?: PortraitFocus) => void;
};

function isExplicitlyAdult(age?: string | null) {
  const value = age?.trim() ?? '';
  if (/成年/.test(value)) return true;
  const match = value.match(/\d+/);
  return Boolean(match && Number.parseInt(match[0], 10) >= 18);
}

export function CharacterPortraitPickerModal({
  visible,
  gender,
  identityReferenceUri,
  portraitPrompt,
  portraitPromptInput,
  mode = 'public',
  onClose,
  onSelect,
}: CharacterPortraitPickerModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const imageGenerationSettings = useTavernStore((state) => state.imageGenerationSettings);
  const [view, setView] = useState<'album' | 'generate'>('album');
  const [picking, setPicking] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState('');
  const [shootOutfit, setShootOutfit] = useState('');
  const [shootAction, setShootAction] = useState('');
  const [portraitStyle, setPortraitStyle] = useState<CharacterPortraitStyleId>('auto');
  const [portraitVariation, setPortraitVariation] = useState(0);
  const [privateScene, setPrivateScene] = useState<CharacterPrivatePortraitSceneId>('auto');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  useEffect(() => {
    if (!visible) {
      return;
    }
    const timer = setTimeout(() => {
      setPortraitStyle('auto');
      setPortraitVariation(0);
      setPrivateScene('auto');
      setShootOutfit('');
      setShootAction('');
      setGenerationPrompt(
        portraitPromptInput
          ? mode === 'private'
            ? buildCharacterPrivatePortraitPrompt(portraitPromptInput, undefined, 'auto', 0, 'auto')
            : buildCharacterPortraitPrompt(portraitPromptInput, undefined, 'auto', 0)
          : portraitPrompt?.trim() ?? '',
      );
      setGenerationError('');
      setView(mode === 'private' ? 'generate' : 'album');
    }, 0);
    return () => clearTimeout(timer);
  }, [mode, portraitPrompt, portraitPromptInput, visible]);

  function rebuildPrompt(
    style: CharacterPortraitStyleId,
    variation: number,
    scene: CharacterPrivatePortraitSceneId = privateScene,
  ) {
    setPortraitStyle(style);
    setPortraitVariation(variation);
    setPrivateScene(scene);
    if (portraitPromptInput) {
      setGenerationPrompt(
        mode === 'private'
          ? buildCharacterPrivatePortraitPrompt(portraitPromptInput, undefined, style, variation, scene)
          : buildCharacterPortraitPrompt(portraitPromptInput, undefined, style, variation),
      );
    }
  }

  const identityReference = useMemo(
    () => mode === 'private'
      ? resolvePortraitDisplayUri(identityReferenceUri, gender)
      : '',
    [gender, identityReferenceUri, mode],
  );

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
        onClose();
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
    const provider = imageGenerationSettings.providerId
      ? imageGenerationSettings.providers[imageGenerationSettings.providerId]
      : undefined;
    const baseUrl = provider?.baseUrl.trim() || '';
    const model = provider?.modelId.trim() || '';
    const basePrompt = generationPrompt.trim();
    const cleanPrompt = [
      basePrompt,
      shootOutfit.trim() ? `本次穿搭：${shootOutfit.trim()}。` : '',
      shootAction.trim() ? `本次动作：${shootAction.trim()}。` : '',
    ].filter(Boolean).join('\n');

    if (!provider) {
      setGenerationError('请先到「系统设置 → 图像生成」选择图像厂商。');
      return;
    }
    if (provider.auth !== 'none' && !provider.apiKey.trim()) {
      setGenerationError(`请先填写「${provider.name}」的 API Key。`);
      return;
    }
    if (!basePrompt) {
      setGenerationError('请先填写人像提示词。');
      return;
    }
    if (mode === 'private' && !isExplicitlyAdult(portraitPromptInput?.age)) {
      setGenerationError('私密影像只为年龄字段明确为 18 岁以上的角色生成。');
      return;
    }
    if (!model) {
      setGenerationError('请先在「系统设置 → 图像生成」填写模型 ID。');
      return;
    }
    if (mode === 'private' && identityReference && !supportsIdentityReference) {
      setGenerationError(
        '当前图像协议不会发送公开参考图，继续生成一定存在换脸风险。请切换到 Gemini 或 Responses 图像协议后再生成。',
      );
      return;
    }

    setGenerating(true);
    setGenerationError('');
    try {
      const result = await generateImage({
        apiSettings: {
          baseUrl,
          apiKey: provider.apiKey,
          protocol: provider.protocol,
          auth: provider.auth,
        },
        purpose: 'portrait',
        prompt: cleanPrompt,
        model,
        referenceImageUri: identityReference || undefined,
      });
      const portraitFocus = await detectPortraitFocus(result.uri, gender);
      onSelect(result.uri, portraitFocus);
      onClose();
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '图像生成失败，请稍后重试。');
    } finally {
      setGenerating(false);
    }
  }

  const selectedImageProvider = imageGenerationSettings.providers[imageGenerationSettings.providerId];
  const selectedImageModel = imageModelCatalogEntry(selectedImageProvider?.modelId);
  const selectedImageProtocol =
    !selectedImageProvider?.protocol || selectedImageProvider.protocol === 'auto'
      ? selectedImageModel?.protocol
      : selectedImageProvider.protocol;
  const supportsIdentityReference = imageProtocolSupportsReferenceImage(selectedImageProtocol);

  return (
    <KeyboardSafeModal visible={visible} onRequestClose={onClose} scrollable>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} />
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
                  ? '与公开立绘分开保存，但继承同一人物身份。采用泳装、浴袍、温泉或旅行摄影等合规生活场景。'
                  : '为当前角色上传独立图片，或根据人物档案生成专属立绘。'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
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
              <View style={styles.styleHeader}>
                <View style={styles.styleHeaderCopy}>
                  <Text style={styles.styleTitle}>{mode === 'private' ? '私人镜头导演' : '视觉导演'}</Text>
                  <Text style={styles.styleHint}>
                    {mode === 'private'
                      ? '默认采用真人纪实摄影，并以公开立绘锁定同一张脸；只改变场景、服装与镜头。'
                      : '自动模式固定使用真人纪实摄影，只变化镜头、动作与真实环境；艺术画风需手动选择。'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => rebuildPrompt(portraitStyle, portraitVariation + 1, privateScene)}
                  disabled={!portraitPromptInput}
                  style={({ pressed }) => [
                    styles.variationButton,
                    (!portraitPromptInput || pressed) && { opacity: 0.5 },
                  ]}>
                  <Text style={styles.variationButtonText}>换一套构图</Text>
                </Pressable>
              </View>
              {mode === 'private' ? (
                <View style={styles.privateSceneSection}>
                  <View style={styles.identityLockRow}>
                    {identityReference ? (
                      <Image source={{ uri: identityReference }} style={styles.identityThumb} contentFit="cover" />
                    ) : null}
                    <View style={styles.identityLockCopy}>
                      <Text style={styles.identityLockTitle}>
                        {identityReference && supportsIdentityReference
                          ? '身份参考已锁定'
                          : identityReference
                            ? '当前协议不支持参考图'
                            : '尚无公开立绘参考'}
                      </Text>
                      <Text style={styles.identityLockHint}>
                        {identityReference && supportsIdentityReference
                          ? '私密图会继承公开立绘的脸、发型、肤色、年龄感与体格。'
                          : identityReference
                            ? 'OpenAI Images generations 只能接收文字；切换 Gemini 或 Responses 图像协议可启用身份锁定。'
                            : '先添加公开立绘，才能避免第二张图重新选角。'}
                      </Text>
                    </View>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.styleChips}>
                    {CHARACTER_PRIVATE_PORTRAIT_SCENES.map((item) => {
                      const active = privateScene === item.id;
                      return (
                        <Pressable
                          key={item.id}
                          onPress={() => rebuildPrompt(portraitStyle, portraitVariation, item.id)}
                          disabled={!portraitPromptInput}
                          style={[
                            styles.styleChip,
                            active && styles.styleChipActive,
                            !portraitPromptInput && { opacity: 0.5 },
                          ]}>
                          <Text style={[styles.styleChipText, active && styles.styleChipTextActive]}>
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.styleChips}>
                {CHARACTER_PORTRAIT_STYLES.map((item) => {
                  const active = portraitStyle === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => rebuildPrompt(item.id, portraitVariation, privateScene)}
                      disabled={!portraitPromptInput}
                      style={[
                        styles.styleChip,
                        active && styles.styleChipActive,
                        !portraitPromptInput && { opacity: 0.5 },
                      ]}>
                      <Text style={[styles.styleChipText, active && styles.styleChipTextActive]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.shootDirection}>
                <View style={styles.shootDirectionHeader}>
                  <Text style={styles.shootDirectionTitle}>本次拍摄</Text>
                  <Text style={styles.shootDirectionHint}>不自动推断，由你填写</Text>
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
              <Text style={styles.generateMeta}>
                {selectedImageModel?.label ?? (imageGenerationSettings.providers[imageGenerationSettings.providerId]?.modelId || DEFAULT_IMAGE_MODEL)}
                {imageGenerationSettings.providerId
                  ? ` · ${imageGenerationSettings.providers[imageGenerationSettings.providerId]?.name ?? '未找到厂商'}`
                  : ' · 未选择图像厂商'}
              </Text>
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
  styleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  styleHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  styleTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.text,
  },
  styleHint: {
    fontSize: 11,
    lineHeight: 16,
    color: theme.textMuted,
  },
  variationButton: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: theme.primary,
    borderRadius: 999,
  },
  variationButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.primary,
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
  shootDirectionHint: {
    color: theme.textMuted,
    fontSize: 10,
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
  privateSceneSection: {
    gap: 9,
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
