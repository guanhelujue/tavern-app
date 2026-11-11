import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';

import { AccordionSection } from '@/components/novel-create/AccordionSection';
import { AppPageHeader } from '@/components/ui/AppPageHeader';
import { ModelRoutePicker } from '@/components/ModelRoutePicker';
import { LocalComfyServiceControl } from '@/components/LocalComfyServiceControl';
import { DraftTextInput } from '@/components/ui/DraftTextInput';
import { providerLogoSource } from '@/constants/provider-logos';
import {
  DEFAULT_IMAGE_BASE_URL,
  DEFAULT_IMAGE_MODEL,
} from '@/constants/image-models';
import { buildImageModelPresetCatalog, buildImageModelRouteCatalog, imageModelDisplayName } from '@/utils/image-model-route-catalog';
import { PROVIDER_CATALOG } from '@/constants/providers';
import {
  OptionsModal,
  SettingsSelectRow,
  SwitchRow,
} from '@/components/settings/SettingsControls';
import { requestThemeMotionPreview } from '@/components/theme-motion-preview';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BottomTabInset,
  COLOR_SCHEME_OPTIONS,
  MaxContentWidth,
  Spacing,
  type ColorSchemePreference,
} from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getActiveProvider, useTavernStore } from '@/store/tavern-store';
import type { ImageProviderProtocol, LlmProvider } from '@/types/tavern';
import { pickExportDirectory } from '@/utils/chat-session-io';
import { discoverProviderModels } from '@/services/provider-model-discovery';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { AppAboutPanel } from '@/components/settings/AppAboutPanel';
import { MobileIcon, MobilePageHeader, MobilePageIntro, MobileSectionTitle, mobileStyles } from '@/components/mobile/MobileUI';

export default function SettingsScreen() {
  const theme = useTheme();
  const [mobileSection, setMobileSection] = useState<'overview' | 'appearance' | 'models' | 'images' | 'export' | 'advanced' | 'about'>('overview');
  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web' || mobileSection === 'overview') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setMobileSection('overview'); return true; });
    return () => subscription.remove();
  }, [mobileSection]));
  const {
    addProvider,
    addImageProvider,
    appearanceSettings,
    exportSettings,
    generationSettings,
    imageGenerationSettings,
    providers,
    providerSecretsWarning,
    removeProvider,
    removeImageProvider,
    setProviderApiKey,
    setProviderFetchedModels,
    updateAppearanceSettings,
    updateExportSettings,
    updateGenerationSettings,
    updateImageGenerationSettings,
    updateImageProvider,
    setImageProviderApiKey,
    updateProvider,
  } = useTavernStore();
  const [editingProviderId, setEditingProviderId] = useState('');
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchMessage, setFetchMessage] = useState('');
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);
  const [isImageProviderPickerOpen, setIsImageProviderPickerOpen] = useState(false);
  const [isImageModelPickerOpen, setIsImageModelPickerOpen] = useState(false);
  const [isDefaultImageModelPickerOpen, setIsDefaultImageModelPickerOpen] = useState(false);
  const [editingImageProviderId, setEditingImageProviderId] = useState('');
  const [isImageConnectionTypePickerOpen, setIsImageConnectionTypePickerOpen] = useState(false);
  const [isImageProtocolPickerOpen, setIsImageProtocolPickerOpen] = useState(false);
  const [imageConnectionMessage, setImageConnectionMessage] = useState('');
  const [isCatalogPickerOpen, setIsCatalogPickerOpen] = useState(false);
  const [isSchemePickerOpen, setIsSchemePickerOpen] = useState(false);

  const schemeLabel =
    COLOR_SCHEME_OPTIONS.find((item) => item.value === appearanceSettings.colorScheme)?.label ??
    '跟随系统';

  const providerList = useMemo(
    () => Object.values(providers).sort((left, right) => left.name.localeCompare(right.name)),
    [providers],
  );

  const activeProvider = useMemo(() => getActiveProvider(providers), [providers]);
  const imageProviderList = useMemo(
    () => Object.values(imageGenerationSettings.providers)
      .sort((left, right) => left.name.localeCompare(right.name)),
    [imageGenerationSettings.providers],
  );
  const defaultImageProvider = imageGenerationSettings.providerId
    ? imageGenerationSettings.providers[imageGenerationSettings.providerId]
    : undefined;
  const imageProvider = imageGenerationSettings.providers[editingImageProviderId] ?? defaultImageProvider ?? imageProviderList[0];
  const imageModelCatalog = useMemo(() => buildImageModelRouteCatalog(
    imageGenerationSettings.providers, imageGenerationSettings.providerId,
  ), [imageGenerationSettings.providers, imageGenerationSettings.providerId]);
  const imageModelPresets = useMemo(() => imageProvider ? buildImageModelPresetCatalog(imageProvider) : [], [imageProvider]);
  const isLocalImageConnection = imageProvider?.protocol === 'comfyui';
  useEffect(() => {
    if (!providerList.length) {
      const timer = setTimeout(() => setEditingProviderId(''), 0);
      return () => clearTimeout(timer);
    }

    const stillExists = providerList.some((provider) => provider.id === editingProviderId);

    if (!stillExists) {
      const timer = setTimeout(
        () => setEditingProviderId(activeProvider?.id ?? providerList[0].id),
        0,
      );
      return () => clearTimeout(timer);
    }
  }, [activeProvider?.id, editingProviderId, providerList]);

  const editingProvider = providers[editingProviderId] ?? activeProvider ?? providerList[0];
  const editingProviderLogo = editingProvider ? providerLogoSource(editingProvider.id) : undefined;
  const exportLocationLabel = exportSettings.directoryUri
    ? exportSettings.directoryLabel || '已选择自定义文件夹'
    : Platform.OS === 'android'
      ? '未设置（系统分享）'
      : Platform.OS === 'web'
        ? '浏览器下载'
        : '系统分享';

  function updateTemperature(value: string) {
    const temperature = Number.parseFloat(value);

    updateGenerationSettings({ temperature: Number.isFinite(temperature) ? temperature : 0.8 });
  }

  function updateMaxTokens(value: string) {
    const maxTokens = Number.parseInt(value, 10);

    updateGenerationSettings({
      maxTokens: Number.isFinite(maxTokens) ? Math.max(1, maxTokens) : 20000,
    });
  }

  function updateNovelCreateMaxTokens(value: string) {
    const novelCreateMaxTokens = Number.parseInt(value, 10);

    updateGenerationSettings({
      novelCreateMaxTokens: Number.isFinite(novelCreateMaxTokens)
        ? Math.max(1, novelCreateMaxTokens)
        : 8000,
    });
  }

  function updateMemoryMaxTokens(value: string) {
    const memoryMaxTokens = Number.parseInt(value, 10);

    updateGenerationSettings({
      memoryMaxTokens: Number.isFinite(memoryMaxTokens)
        ? Math.max(1, memoryMaxTokens)
        : 320,
    });
  }

  function updateWritingStyleSampleMaxChars(value: string) {
    const writingStyleSampleMaxChars = Number.parseInt(value, 10);

    updateGenerationSettings({
      writingStyleSampleMaxChars: Number.isFinite(writingStyleSampleMaxChars)
        ? Math.min(100_000, Math.max(2000, writingStyleSampleMaxChars))
        : 12000,
    });
  }

  function updateContextWindowMessages(value: string) {
    const contextWindowMessages = Number.parseInt(value, 10);

    updateGenerationSettings({
      contextWindowMessages: Number.isFinite(contextWindowMessages)
        ? Math.max(1, contextWindowMessages)
        : 20,
    });
  }

  function updateRequestTimeoutSeconds(value: string) {
    const requestTimeoutSeconds = Number.parseInt(value, 10);

    updateGenerationSettings({
      requestTimeoutSeconds: Number.isFinite(requestTimeoutSeconds)
        ? Math.min(600, Math.max(15, requestTimeoutSeconds))
        : 180,
    });
  }

  function updateRequestRetryCount(value: string) {
    const requestRetryCount = Number.parseInt(value, 10);

    updateGenerationSettings({
      requestRetryCount: Number.isFinite(requestRetryCount)
        ? Math.min(5, Math.max(0, requestRetryCount))
        : 1,
    });
  }

  function handleAddProvider() {
    setIsCatalogPickerOpen(true);
  }

  function handleAddImageProvider() {
    setIsImageConnectionTypePickerOpen(true);
  }

  function handleCreateImageConnection(kind: string) {
    const isLocal = kind === 'comfyui';
    const baseName = isLocal ? '本地 ComfyUI' : '远程图像连接';
    let name = baseName;
    let suffix = 1;
    while (imageProviderList.some((provider) => provider.name === name)) name = `${baseName} ${++suffix}`;
    const providerId = addImageProvider({
      name,
      baseUrl: isLocal ? DEFAULT_IMAGE_BASE_URL : '',
      modelId: isLocal ? DEFAULT_IMAGE_MODEL : '',
      protocol: isLocal ? 'comfyui' : 'auto',
      auth: isLocal ? 'none' : 'auto',
    });
    setEditingImageProviderId(providerId);
    setIsImageConnectionTypePickerOpen(false);
    setImageConnectionMessage(isLocal
      ? `已新增「${name}」，请确认服务地址和本地模型。`
      : `已新增「${name}」，请填写图像接口地址、API Key 和模型 ID。`);
  }

  async function handleDeleteImageProvider() {
    if (!imageProvider) return;
    const confirmed = await confirmAppAction(
      '确认删除图像厂商',
      `确定删除图像厂商「${imageProvider.name}」吗？其 Base URL、API Key 与模型设置也会被移除。`,
      { confirmLabel: '删除' },
    );
    if (confirmed) { removeImageProvider(imageProvider.id); setEditingImageProviderId(''); setImageConnectionMessage(''); }
  }

  function handleAddCatalogProvider(providerId: string) {
    const isCustom = providerId === '__custom__';
    const nextId = isCustom ? addProvider({}) : addProvider({ id: providerId });

    setEditingProviderId(nextId);
    setFetchMessage(
      isCustom
        ? '已新增自定义厂商，请填写 Base URL、Key 并获取模型列表。'
        : '已从目录添加厂商，请填写 Key 并获取模型列表。',
    );
    setIsCatalogPickerOpen(false);
  }

  async function handleDeleteProvider() {
    if (!editingProvider) {
      return;
    }

    const confirmed = await confirmAppAction(
      '确认删除',
      `确定删除厂商「${editingProvider.name}」吗？其 Key 与模型列表也会被移除。`,
      { confirmLabel: '删除' },
    );
    if (!confirmed) return;
    removeProvider(editingProvider.id);
    setFetchMessage('');
  }

  async function fetchModelsForProvider(provider: LlmProvider) {
    setIsFetchingModels(true);
    setFetchMessage('正在拉取模型列表…');

    try {
      const result = await discoverProviderModels({
        providerId: provider.id,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        auth: provider.auth,
        refresh: true,
      });

      if (result.models.length === 0) {
        throw new Error('没有可用模型，请检查 Base URL 与 API Key。');
      }

      setProviderFetchedModels(provider.id, result.models);
      setFetchMessage(result.cached
        ? `远程不可用，沿用上次获取的 ${result.models.length} 个模型（缓存）。`
        : `已获取 ${result.models.length} 个纯文本模型。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'API Key 错误或网络异常。';
      setFetchMessage(message);
      showAppAlert('获取模型失败', message);
    } finally {
      setIsFetchingModels(false);
    }
  }

  return (
    <ThemedView decorated={Platform.OS === 'web'} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView key={mobileSection} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, Platform.OS !== 'web' && mobileStyles.content]}>
          {Platform.OS === 'web' ? <AppPageHeader
            title="系统设置"
            eyebrow="SYSTEM / PREFERENCES"
            index="04"
            description="外观、模型连接、图像引擎与导出。各功能的模型在对应页面选择。"
            compact
          /> : mobileSection !== 'overview' ? <MobilePageHeader title={({ appearance: '外观', models: '模型连接', images: '图像引擎', export: '导出设置', advanced: '高级参数', about: '关于' } as const)[mobileSection]} onBack={() => setMobileSection('overview')} /> : null}
          {Platform.OS !== 'web' && mobileSection === 'overview' ? <View style={styles.mobileOverview}>
            <MobilePageIntro title="系统设置" subtitle="让工具更适合你的写作习惯" />
            {([
              ['体验', [['appearance', '外观', '主题、颜色模式与动画', 'paintpalette'], ['models', '模型连接', '厂商、API 与写作模型', 'link'], ['images', '图像引擎', '封面与插图模型', 'photo']]],
              ['数据与参数', [['export', '导出设置', '格式、文件名与保存位置', 'arrow.down.to.line'], ['advanced', '高级参数', '生成长度、记忆与请求设置', 'slider.horizontal.3']]],
              ['应用', [['about', '关于', '版本信息与应用更新', 'info.circle']]],
            ] as const).map(([group, items]) => <View key={group} style={styles.mobileOverviewGroup}><MobileSectionTitle title={group} />{items.map(([key, label, description, icon]) => <Pressable key={`${key}-${label}`} accessibilityRole="button" onPress={() => setMobileSection(key as typeof mobileSection)} style={({ pressed }) => [styles.mobileSettingsRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.outlineVariant }, pressed && mobileStyles.pressed]}><View style={[styles.mobileSettingsIcon, { backgroundColor: theme.accentMuted }]}><MobileIcon name={{ ios: icon, android: ({ paintpalette: 'palette', link: 'link', photo: 'image', 'arrow.down.to.line': 'file_download', 'slider.horizontal.3': 'tune', 'info.circle': 'info' } as const)[icon], web: ({ paintpalette: 'palette', link: 'link', photo: 'image', 'arrow.down.to.line': 'file_download', 'slider.horizontal.3': 'tune', 'info.circle': 'info' } as const)[icon] }} size={22} /></View><View style={styles.mobileSettingsCopy}><ThemedText type="smallBold">{label}</ThemedText><ThemedText type="small" themeColor="textSecondary">{description}</ThemedText></View><MobileIcon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={theme.textMuted} /></Pressable>)}</View>)}
          </View> : null}

          {(Platform.OS === 'web' || mobileSection === 'appearance') && <SettingsSection
            title="外观"
            sectionNumber="01"
            description="叙事观测仪的明暗模式与界面动画"
            variant="settings">
            <SwitchRow
              label="界面动画"
              description="控制当前主题的开幕仪式、首页编排、页面揭示与装饰性过渡；关闭后直接显示稳定布局。"
              value={appearanceSettings.motionEnabled}
              onValueChange={(motionEnabled) => updateAppearanceSettings({ motionEnabled })}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!appearanceSettings.motionEnabled}
              onPress={requestThemeMotionPreview}
              style={({ pressed }) => [
                styles.motionPreviewButton,
                { borderColor: theme.accent },
                !appearanceSettings.motionEnabled && styles.motionPreviewButtonDisabled,
                pressed && styles.pressed,
              ]}>
              <View>
                <ThemedText type="smallBold" themeColor="accent">预览当前主题动画</ThemedText>
                <ThemedText type="small" themeColor="textMuted">重新播放开幕，不影响动画开关与其他设置</ThemedText>
              </View>
              <ThemedText style={{ color: theme.accent, fontSize: 22 }}>↗</ThemedText>
            </Pressable>
            <SettingsSelectRow
              label="颜色模式"
              value={schemeLabel}
              onPress={() => setIsSchemePickerOpen(true)}
            />
            <ThemedText type="small" themeColor="textMuted">
              「跟随系统」时与手机浅色 / 深色同步。
            </ThemedText>
          </SettingsSection>}

          {(Platform.OS === 'web' || mobileSection === 'models') && <SettingsSection
            title="模型连接"
            sectionNumber="02"
            description="厂商地址、密钥与可用模型列表"
            variant="settings">
            {providerSecretsWarning ? (
              <View
                style={[
                  styles.noticeCard,
                  { borderColor: theme.border, backgroundColor: theme.accentMuted },
                ]}>
                <ThemedText type="small" themeColor="accent">
                  {providerSecretsWarning}
                </ThemedText>
              </View>
            ) : null}
            {!editingProvider ? (
              <View style={styles.emptyProvider}>
                <ThemedText type="small" themeColor="textSecondary">
                  还没有厂商，先新增一个。
                </ThemedText>
                <Pressable
                  onPress={handleAddProvider}
                  style={({ pressed }) => [
                    styles.inlineButton,
                    { backgroundColor: theme.accent },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" style={[styles.primaryButtonText, { color: theme.onPrimary }]}>
                    + 新增厂商
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.editorToolbar}>
                  <View style={styles.pickerGrow}>
                    <SettingsSelectRow
                      label="当前编辑"
                      value={editingProvider.name}
                      onPress={() => setIsProviderPickerOpen(true)}
                    />
                  </View>
                  <Pressable
                    onPress={handleAddProvider}
                    style={({ pressed }) => [
                      styles.addChip,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="code" themeColor="accent">
                      + 新增
                    </ThemedText>
                  </Pressable>
                </View>

                <View style={styles.providerHeader}>
                  {editingProviderLogo ? (
                    <Image source={editingProviderLogo} style={styles.providerLogoImage} contentFit="contain" />
                  ) : editingProvider.logoMark ? (
                    <View style={[styles.providerLogo, { backgroundColor: editingProvider.accent ?? theme.accent }]}>
                      <ThemedText type="smallBold" style={styles.providerLogoText}>{editingProvider.logoMark}</ThemedText>
                    </View>
                  ) : null}
                  <View style={{ flex: 1, gap: 2 }}>
                    <ThemedText type="smallBold">{editingProvider.name}</ThemedText>
                    <ThemedText type="small" themeColor="textMuted">
                      {editingProvider.protocol ?? 'openai-compatible'}
                    </ThemedText>
                  </View>
                </View>

                <SettingField
                  label="Base URL"
                  value={editingProvider.baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChangeText={(baseUrl) => updateProvider(editingProvider.id, { baseUrl })}
                />
                <SettingField
                  label="API Key"
                  value={editingProvider.apiKey}
                  placeholder="sk-..."
                  secureTextEntry
                  onChangeText={(apiKey) => setProviderApiKey(editingProvider.id, apiKey)}
                />

                <View style={styles.field}>
                  <View style={styles.fieldHeader}>
                    <View style={styles.modelListCopy}>
                      <ThemedText type="smallBold">可用模型</ThemedText>
                      <ThemedText type="small" themeColor="textMuted">
                        {editingProvider.fetchedModelsSource === 'remote' && editingProvider.fetchedModels.length
                          ? `已发现 ${editingProvider.fetchedModels.length} 个文本模型`
                          : '尚未获取模型列表'}
                      </ThemedText>
                    </View>
                    <Pressable
                      disabled={isFetchingModels}
                      onPress={() => fetchModelsForProvider(editingProvider)}
                      style={({ pressed }) => [
                        styles.fetchModelsButton,
                        { borderColor: theme.border },
                        isFetchingModels && { opacity: 0.5 },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="code" themeColor="accent">
                        {isFetchingModels
                            ? '获取中...'
                            : '获取模型'}
                      </ThemedText>
                    </Pressable>
                  </View>
                  <ThemedText type="small" themeColor="textMuted">
                    {fetchMessage ||
                      '这里维护连接与模型清单；获取模型后，在正文、灵感等功能页面分别选择。'}
                  </ThemedText>
                </View>

                <View style={styles.actionRow}>
                  <View style={styles.actionSpacer} />
                  <Pressable
                    onPress={handleDeleteProvider}
                    style={({ pressed }) => [
                      styles.deleteChip,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" style={styles.deleteText}>
                      删除
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            )}

          </SettingsSection>}

          {(Platform.OS === 'web' || mobileSection === 'images') && <SettingsSection
            title="图像引擎"
            sectionNumber="03"
            description="独立配置本地或远程图像接口"
            variant="settings">
            <ThemedText type="small" themeColor="textMuted">
              按开源模型、Google、OpenAI 选择图像模型。生图使用独立图像接口，角色生成时也可单独换模型。
            </ThemedText>
            <SettingsSelectRow
              label="默认图像模型"
              value={imageModelDisplayName(defaultImageProvider?.modelId)}
              muted={!defaultImageProvider?.modelId}
              onPress={() => setIsDefaultImageModelPickerOpen(true)}
            />
            <ThemedText type="smallBold">图像接口配置</ThemedText>
            <View style={styles.editorToolbar}>
              <View style={styles.pickerGrow}>
                <SettingsSelectRow
                  label="编辑图像接口"
                  value={imageProvider?.name ?? '尚未选择'}
                  muted={!imageProvider}
                  onPress={() => setIsImageProviderPickerOpen(true)}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="新增图像连接"
                onPress={handleAddImageProvider}
                style={({ pressed }) => [
                  styles.addChip,
                  { borderColor: theme.border },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="code" themeColor="accent">
                  + 新增
                </ThemedText>
              </Pressable>
            </View>
            {imageConnectionMessage ? <ThemedText accessibilityLiveRegion="polite" type="small" themeColor="accent">{imageConnectionMessage}</ThemedText> : null}
            {imageProvider ? (
              <>
                <SettingField
                  key={`image-name-${imageProvider.id}`}
                  label="图像连接名称"
                  value={imageProvider.name}
                  placeholder="为这条图像连接取名"
                  onChangeText={(name) => updateImageProvider(imageProvider.id, { name })}
                />
                <SettingField
                  key={`image-url-${imageProvider.id}`}
                  label="图像 API Base URL"
                  value={imageProvider.baseUrl}
                  placeholder={isLocalImageConnection ? DEFAULT_IMAGE_BASE_URL : 'https://图像服务地址/v1 或反代地址'}
                  onChangeText={(baseUrl) => updateImageProvider(imageProvider.id, { baseUrl })}
                />
                {isLocalImageConnection ? <>
                <ThemedText type="small" themeColor="textMuted">
                  本机运行时使用 127.0.0.1；手机访问电脑上的 ComfyUI 时，请改成电脑局域网 IP（例如 http://192.168.1.20:8188）。
                </ThemedText>
                <LocalComfyServiceControl key={`${imageProvider.id}:${imageProvider.baseUrl}:${imageProvider.auth}`} provider={imageProvider} />
                </> : <>
                  <SettingsSelectRow
                    label="图像接口格式"
                    value={IMAGE_PROTOCOL_OPTIONS.find((option) => option.value === (imageProvider.protocol ?? 'auto'))?.label ?? '自动（按模型）'}
                    onPress={() => setIsImageProtocolPickerOpen(true)}
                  />
                  <SettingField
                    key={`image-model-${imageProvider.id}`}
                    label="图像模型 ID"
                    value={imageProvider.modelId}
                    placeholder="填写图像服务提供的模型 ID，支持反代别名"
                    onChangeText={(modelId) => updateImageProvider(imageProvider.id, { modelId })}
                  />
                  <ThemedText type="small" themeColor="textMuted">
                    使用图像服务提供的地址和模型。反代的接口格式以该服务说明为准。
                  </ThemedText>
                </>}
                {!isLocalImageConnection || (imageProvider.auth && !['none', 'auto'].includes(imageProvider.auth)) ? (
                  <SettingField
                    key={`image-key-${imageProvider.id}`}
                    label="图像 API Key"
                    value={imageProvider.apiKey}
                    placeholder="填写此图像接口的密钥；无鉴权服务可留空"
                    secureTextEntry
                    onChangeText={(apiKey) => setImageProviderApiKey(imageProvider.id, apiKey)}
                  />
                ) : null}
                <ThemedText type="smallBold">
                  接口默认模型：{imageModelDisplayName(imageProvider.modelId)}
                </ThemedText>
                <View style={styles.actionRow}>
                  {imageModelPresets.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="配置接口模型"
                      onPress={() => setIsImageModelPickerOpen(true)}
                      style={({ pressed }) => [
                        styles.inlineButton,
                        { flex: 1, borderWidth: 1, borderColor: theme.border },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="smallBold" themeColor="accent">
                        配置接口模型
                      </ThemedText>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="删除当前图像连接"
                    onPress={() => void handleDeleteImageProvider()}
                    style={({ pressed }) => [
                      styles.deleteChip,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" style={styles.deleteText}>
                      删除
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                尚未配置图像连接，请点击「+ 新增」添加一条图像连接。
              </ThemedText>
            )}
          </SettingsSection>}

          {(Platform.OS === 'web' || mobileSection === 'export' || mobileSection === 'advanced') && <SettingsSection
            title="导出与高级"
            sectionNumber="04"
            description="正文文件、生成预算与请求稳定性"
            variant="settings">
            {(Platform.OS === 'web' || mobileSection === 'export') ? <>
            <ThemedText type="small" themeColor="textMuted">
              只导出 AI 正文，不含你的输入；状态栏与行动预测（建议路线）会自动去掉。
            </ThemedText>

            <ThemedText type="smallBold">格式</ThemedText>
            <View style={styles.chips}>
              {(
                [
                  { id: 'txt' as const, label: 'TXT' },
                  { id: 'md' as const, label: 'Markdown' },
                ] as const
              ).map((item) => {
                const selected = (exportSettings.format ?? 'txt') === item.id;

                return (
                  <Pressable
                    key={item.id}
                    onPress={() => updateExportSettings({ format: item.id })}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        borderColor: selected ? theme.accent : theme.border,
                        backgroundColor: selected
                          ? theme.accentMuted
                          : theme.backgroundElement,
                      },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText
                      type="small"
                      themeColor={selected ? 'accent' : 'textSecondary'}>
                      {item.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <SwitchRow
              label="文件名带时间戳"
              description="开启后文件名带时间，避免互相覆盖；关闭则固定书名，方便覆盖更新。"
              value={exportSettings.includeTimestamp ?? true}
              onValueChange={(includeTimestamp) =>
                updateExportSettings({ includeTimestamp })
              }
            />

            <View
              style={[
                styles.selectRow,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.border,
                },
              ]}>
              <ThemedText type="smallBold">保存位置</ThemedText>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                numberOfLines={2}
                style={styles.selectRowValueText}>
                {exportLocationLabel}
              </ThemedText>
            </View>
            {Platform.OS === 'android' ? (
              <View style={styles.actionRow}>
                <Pressable
                  onPress={async () => {
                    try {
                      const next = await pickExportDirectory();
                      updateExportSettings(next);
                      showAppAlert('已更新', `之后导出会保存到：${next.directoryLabel}`);
                    } catch (error) {
                      const message = error instanceof Error ? error.message : '选择失败。';
                      if (message !== '已取消选择目录。') {
                        showAppAlert('选择失败', message);
                      }
                    }
                  }}
                  style={({ pressed }) => [
                    styles.inlineButton,
                    { flex: 1, backgroundColor: theme.accent },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" style={[styles.primaryButtonText, { color: theme.onPrimary }]}>
                    {exportSettings.directoryUri ? '更换文件夹' : '选择文件夹'}
                  </ThemedText>
                </Pressable>
                {exportSettings.directoryUri ? (
                  <Pressable
                    onPress={() => {
                      updateExportSettings({ directoryUri: '', directoryLabel: '' });
                      showAppAlert('已清除', '之后导出会改为系统分享。');
                    }}
                    style={({ pressed }) => [
                      styles.deleteChip,
                      { borderColor: theme.border },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      清除
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textMuted">
                当前平台不支持固定路径；导出时在分享面板选择阅读 App。
              </ThemedText>
            )}
            </> : null}
            {(Platform.OS === 'web' || mobileSection === 'advanced') ? <SettingsSection title="高级参数">
            <ThemedText type="small" themeColor="textMuted">
              生成长度与稳定性相关选项，一般保持默认即可。
            </ThemedText>

            <ThemedText type="smallBold">生成参数</ThemedText>
            <SettingField
              label="Temperature"
              value={String(generationSettings.temperature)}
              placeholder="0.8"
              keyboardType="decimal-pad"
              onChangeText={updateTemperature}
            />
            <SettingField
              label="对话长度上限"
              value={String(generationSettings.maxTokens)}
              placeholder="20000"
              keyboardType="number-pad"
              onChangeText={updateMaxTokens}
            />
            <ThemedText type="small" themeColor="textMuted">
              聊天 / 小说正文每次回复的大致上限。
            </ThemedText>
            <SettingField
              label="AI 创作长度上限"
              value={String(generationSettings.novelCreateMaxTokens ?? 8000)}
              placeholder="8000"
              keyboardType="number-pad"
              onChangeText={updateNovelCreateMaxTokens}
            />
            <ThemedText type="small" themeColor="textMuted">
              用于 AI 大纲、角色补全与人物小传。长篇小传可适当调高，需在模型支持的输出范围内；与对话长度无关。
            </ThemedText>
            <SettingField
              label="记忆长度上限"
              value={String(generationSettings.memoryMaxTokens ?? 512)}
              placeholder="512"
              keyboardType="number-pad"
              onChangeText={updateMemoryMaxTokens}
            />
            <ThemedText type="small" themeColor="textMuted">
              长短期记忆整理时的输出上限，一般保持 512 即可。
            </ThemedText>
            <SettingField
              label="文风提取样本字数"
              value={String(generationSettings.writingStyleSampleMaxChars ?? 12000)}
              placeholder="12000"
              keyboardType="number-pad"
              onChangeText={updateWritingStyleSampleMaxChars}
            />
            <ThemedText type="small" themeColor="textMuted">
              从 txt 学文风时送入模型的原文预算（2000–100000）。过长会均匀抽取多段；越大越费
              token、越慢。
            </ThemedText>
            <SettingField
              label="历史窗口消息数"
              value={String(generationSettings.contextWindowMessages)}
              placeholder="20"
              keyboardType="number-pad"
              onChangeText={updateContextWindowMessages}
            />

            <ThemedText type="smallBold">稳定性</ThemedText>
            <SettingField
              label="辅助请求超时（秒）"
              value={String(generationSettings.requestTimeoutSeconds ?? 180)}
              placeholder="180"
              keyboardType="number-pad"
              onChangeText={updateRequestTimeoutSeconds}
            />
            <SettingField
              label="失败重试次数"
              value={String(generationSettings.requestRetryCount ?? 1)}
              placeholder="1"
              keyboardType="number-pad"
              onChangeText={updateRequestRetryCount}
            />
            <ThemedText type="small" themeColor="textMuted">
              小说正文无客户端超时，可手动停止；辅助请求仍按上方时间超时。网络异常只会在尚未收到正文时自动重试，已流出的内容会保留并标记失败。
            </ThemedText>

            <SwitchRow
              label="写作模型截断时自动续写"
              description="Narrator 写作回复因长度被截断时，自动再续写一轮；Direct / Character 等后台任务不适用（默认关闭）。"
              value={generationSettings.continuationOnTruncation ?? false}
              onValueChange={(continuationOnTruncation) =>
                updateGenerationSettings({ continuationOnTruncation })
              }
            />
            </SettingsSection> : null}
          </SettingsSection>}
            {(Platform.OS === 'web' || mobileSection === 'about') && <AppAboutPanel />}
        </ScrollView>
      </SafeAreaView>

      {editingProvider ? (
        <>
          <OptionsModal
            visible={isProviderPickerOpen}
            title="选择厂商"
            options={providerList.map((provider) => ({
              value: provider.id,
              label: provider.name,
              description: [
                provider.protocol ?? 'openai-compatible',
                provider.fetchedModelsSource === 'remote' && provider.fetchedModels.length
                  ? `${provider.fetchedModels.length} 个模型`
                  : '尚未拉取模型',
                provider.apiKey ? '已配置 Key' : '未配置 Key',
              ].join(' · '),
              icon: providerLogoSource(provider.id),
              accent: provider.accent,
            }))}
            selectedValue={editingProvider.id}
            searchable
            onClose={() => setIsProviderPickerOpen(false)}
            onSelect={(providerId) => {
              setEditingProviderId(providerId);
              setFetchMessage('');
              setIsProviderPickerOpen(false);
            }}
          />

        </>
      ) : null}

      <OptionsModal
        visible={isCatalogPickerOpen}
        title="从目录添加厂商"
        options={[
          { value: '__custom__', label: '自定义厂商（空白）', description: 'OpenAI-compatible · 手动填写地址', accent: '#6B7280' },
          ...PROVIDER_CATALOG
            .filter((entry) => !providers[entry.id])
            .map((entry) => ({
              value: entry.id,
              label: entry.name,
              description: entry.protocol,
              icon: providerLogoSource(entry.id),
              accent: entry.accent,
            })),
        ]}
        selectedValue=""
        onClose={() => setIsCatalogPickerOpen(false)}
        onSelect={handleAddCatalogProvider}
      />

      <OptionsModal
        visible={isImageConnectionTypePickerOpen}
        title="新增图像连接"
        options={[
          { value: 'remote', label: '远程 / 反代图像接口', description: '独立填写地址、密钥和图像模型，支持 Gemini 与 OpenAI 兼容接口' },
          { value: 'comfyui', label: '本地 ComfyUI', description: '连接电脑上的 ComfyUI，使用 Qwen Image、MOSS 或 Z-Image' },
        ]}
        selectedValue=""
        onClose={() => setIsImageConnectionTypePickerOpen(false)}
        onSelect={handleCreateImageConnection}
      />

      <OptionsModal
        visible={isImageProtocolPickerOpen}
        title="图像接口格式"
        options={IMAGE_PROTOCOL_OPTIONS}
        selectedValue={imageProvider?.protocol ?? 'auto'}
        onClose={() => setIsImageProtocolPickerOpen(false)}
        onSelect={(protocol) => {
          if (imageProvider) updateImageProvider(imageProvider.id, { protocol: protocol as ImageProviderProtocol });
          setIsImageProtocolPickerOpen(false);
        }}
      />

      <OptionsModal
        visible={isImageProviderPickerOpen}
        title="选择要编辑的图像接口"
        options={imageProviderList.map((provider) => ({
          value: provider.id,
          label: provider.name,
          description: [
            provider.protocol === 'auto' || !provider.protocol ? '自动（按模型）' : provider.protocol,
            provider.baseUrl || '未填写地址',
            provider.auth === 'none' ? '无需鉴权' : provider.apiKey ? '已配置 Key' : '未配置 Key',
          ].join(' · '),
          icon: providerLogoSource(provider.id),
          accent: provider.accent ?? '#6B7280',
        }))}
        selectedValue={imageProvider?.id ?? ''}
        onClose={() => setIsImageProviderPickerOpen(false)}
        onSelect={(providerId) => {
          setEditingImageProviderId(providerId);
          setImageConnectionMessage('');
          setIsImageProviderPickerOpen(false);
        }}
      />

      <ModelRoutePicker
        visible={isDefaultImageModelPickerOpen}
        title="选择默认图像模型"
        description="按模型分组；待配置的模型请先添加图像接口"
        catalog={imageModelCatalog}
        selectedModelId={defaultImageProvider?.modelId}
        selectedProviderId={imageGenerationSettings.providerId}
        onClose={() => setIsDefaultImageModelPickerOpen(false)}
        onSelect={(modelId, providerId) => {
          updateImageProvider(providerId, { modelId });
          updateImageGenerationSettings({ providerId });
          setEditingImageProviderId(providerId);
          setImageConnectionMessage('');
          setIsDefaultImageModelPickerOpen(false);
        }}
      />

      <ModelRoutePicker
        visible={isImageModelPickerOpen}
        title="配置接口模型"
        description="选择此图像接口提供的模型；反代别名也可在表单直接填写"
        catalog={imageModelPresets}
        selectedModelId={imageProvider?.modelId}
        selectedProviderId={imageProvider?.id}
        onClose={() => setIsImageModelPickerOpen(false)}
        onSelect={(modelId, providerId) => {
          updateImageProvider(providerId, { modelId });
          setIsImageModelPickerOpen(false);
        }}
      />

      <OptionsModal
        visible={isSchemePickerOpen}
        title="颜色模式"
        options={COLOR_SCHEME_OPTIONS.map((item) => ({
          value: item.value,
          label: item.label,
          description: item.description,
        }))}
        selectedValue={appearanceSettings.colorScheme}
        onClose={() => setIsSchemePickerOpen(false)}
        onSelect={(value) => {
          updateAppearanceSettings({ colorScheme: value as ColorSchemePreference });
          setIsSchemePickerOpen(false);
        }}
      />

    </ThemedView>
  );
}

function SettingsSection(props: ComponentProps<typeof AccordionSection>) {
  if (Platform.OS === 'web') return <AccordionSection {...props} />;
  return <View style={{ gap: 16 }}>{props.children}</View>;
}

type SettingFieldProps = {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  minHeight?: number;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  onChangeText: (value: string) => void;
};

function SettingField({
  label,
  value,
  placeholder,
  multiline,
  minHeight,
  secureTextEntry = false,
  keyboardType = 'default',
  onChangeText,
}: SettingFieldProps) {
  const theme = useTheme();
  const InputComponent = keyboardType === 'default' ? TextInput : DraftTextInput;

  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <InputComponent
        accessibilityLabel={label}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        secureTextEntry={secureTextEntry}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          multiline && minHeight ? { minHeight } : null,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />
    </View>
  );
}

const IMAGE_PROTOCOL_OPTIONS: { value: ImageProviderProtocol; label: string; description: string }[] = [
  { value: 'auto', label: '自动（按模型）', description: '常用图像模型使用对应格式；自定义模型默认使用 Chat Completions' },
  { value: 'openai-compatible', label: 'OpenAI 兼容聊天接口', description: '/v1/chat/completions · 适合通过聊天接口返回图片的反代' },
  { value: 'google-generate-content', label: 'Gemini 图像接口', description: '/v1beta/models/模型:generateContent' },
  { value: 'openai-images', label: 'OpenAI Images', description: '/v1/images/generations · 文生图' },
  { value: 'openai-responses-image', label: 'OpenAI Responses 图像工具', description: '/v1/responses · image_generation' },
];

const styles = StyleSheet.create({
  mobileOverview: { gap: 22 },
  mobileOverviewGroup: { gap: 8 },
  mobileSettingsRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#C8A892', paddingVertical: 10 },
  mobileSettingsIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  mobileSettingsCopy: { flex: 1, gap: 3 },
  container: {
    alignItems: 'center',
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.three,
  },
  motionPreviewButton: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  motionPreviewButtonDisabled: { opacity: 0.42 },
  editorToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  providerLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerLogoImage: {
    width: 36,
    height: 36,
  },
  providerLogoText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  pickerGrow: {
    flex: 1,
  },
  addChip: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    gap: Spacing.two,
  },
  noticeCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
  },
  modelListCopy: {
    flex: 1,
    gap: 2,
  },
  actionSpacer: {
    flex: 1,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modelCapabilityCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  modelCapabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  modelCapabilityCopy: {
    flex: 1,
    gap: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
  },
  multilineInput: {
    minHeight: 92,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
  },
  selectRow: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  selectRowValueText: {
    flexShrink: 1,
    textAlign: 'right',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
  },
  libraryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  styleCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  styleCardHeader: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  styleCardBody: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  promptPreview: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  deleteTextButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  fetchModelsButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  inlineButton: {
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  primaryButtonText: {
    color: '#120c09',
  },
  deleteChip: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: '#a33b2b',
  },
  emptyProvider: {
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.75,
  },
});
