import { Image } from 'expo-image';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useTavernStore } from '@/store/tavern-store';
import type { CharacterDossierV2 } from '@/types/character-dossier-v2';
import type {
  NovelCastCharacter,
  NovelCharacterBiography,
} from '@/types/tavern';
import { resolvePortraitDisplayUri } from '@/utils/character-card-portraits';
import { normalizeAliases } from '@/utils/helpers';
import { resolveNovelImageUri } from '@/utils/novel-images';
import { saveImageToDevice } from '@/utils/save-image-to-device';
import {
  resolveCharacterDossierVariant,
  switchCharacterDossierVariant,
} from './model';
import { CharacterBiographyPage } from './CharacterBiographyPage';

export type CharacterDossierBookPage = 'public' | 'private' | 'biography';

type Props = {
  page: CharacterDossierBookPage;
  appearanceId?: string | null;
  draft: NovelCastCharacter;
  dossier: CharacterDossierV2;
  onDraftChange: <K extends keyof NovelCastCharacter>(
    key: K,
    value: NovelCastCharacter[K],
  ) => void;
  onDossierChange: (dossier: CharacterDossierV2) => void;
  onImageRequest: (target: 'public' | 'private') => void;
  biographyGeneratingId?: string | null;
  onBiographyGenerate: (
    request: string,
    biographyId?: string,
  ) => Promise<boolean>;
  onBiographyUpdate: (
    biographyId: string,
    patch: Partial<Pick<NovelCharacterBiography, 'title' | 'content'>>,
  ) => void;
  onBiographyDelete: (biographyId: string) => void;
};

type DossierVisual = {
  nocturne: boolean;
  paper: string;
  paperDeep: string;
  back: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  fieldFill: string;
  portrait: string;
  portraitEmpty: string;
  stampFill: string;
  shadow: string;
  corner: string;
};

const COLLECTION_VISUAL: DossierVisual = {
  nocturne: false,
  paper: '#f3eee4',
  paperDeep: '#e8dfd0',
  back: '#c8baa6',
  ink: '#201e1b',
  muted: '#756c60',
  rule: '#c7bbaa',
  accent: '#77372f',
  fieldFill: 'rgba(255,255,255,0.24)',
  portrait: '#d8cdbc',
  portraitEmpty: '#e9e1d5',
  stampFill: 'rgba(243,238,228,0.88)',
  shadow: '#30251d',
  corner: '#d1c4b1',
};

const NOCTURNE_VISUAL: DossierVisual = {
  nocturne: true,
  paper: '#131210',
  paperDeep: '#1b1916',
  back: '#090908',
  ink: '#eee6d8',
  muted: '#9c9285',
  rule: 'rgba(201,170,120,0.28)',
  accent: '#c9aa78',
  fieldFill: '#1b1916',
  portrait: '#211e1a',
  portraitEmpty: '#191714',
  stampFill: 'rgba(19,18,16,0.9)',
  shadow: '#000000',
  corner: '#3d3429',
};

const DossierVisualContext = createContext<DossierVisual>(COLLECTION_VISUAL);
const PAPER = COLLECTION_VISUAL.paper;
const PAPER_DEEP = COLLECTION_VISUAL.paperDeep;
const INK = COLLECTION_VISUAL.ink;
const MUTED = COLLECTION_VISUAL.muted;
const RULE = COLLECTION_VISUAL.rule;
const ACCENT = COLLECTION_VISUAL.accent;

function PaperField({
  label,
  value,
  placeholder,
  multiline = false,
  paired = false,
  compact = false,
  onChangeText,
  onFocus,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  paired?: boolean;
  compact?: boolean;
  onChangeText: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const visual = useContext(DossierVisualContext);
  return (
    <View
      style={[
        styles.field,
        paired && styles.fieldPaired,
        paired && compact && styles.fieldFull,
      ]}
    >
      <Text style={[styles.fieldLabel, { color: visual.muted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        placeholder={placeholder}
        placeholderTextColor="#a29482"
        style={[
          styles.input,
          { color: visual.ink, borderColor: visual.rule },
          multiline && styles.inputMultiline,
          multiline && {
            backgroundColor: visual.fieldFill,
            borderColor: visual.rule,
          },
          visual.nocturne && styles.inputNocturne,
        ]}
      />
    </View>
  );
}

function SectionHeading({
  index,
  title,
  caption,
}: {
  index: string;
  title: string;
  caption: string;
}) {
  const visual = useContext(DossierVisualContext);
  return (
    <View style={styles.sectionHeading}>
      <Text
        style={[
          styles.sectionIndex,
          {
            color: visual.paper,
            backgroundColor: visual.nocturne ? visual.accent : visual.ink,
          },
          visual.nocturne && styles.sectionIndexNocturne,
        ]}
      >
        {index}
      </Text>
      <View style={[styles.sectionCopy, { borderBottomColor: visual.rule }]}>
        <Text style={[styles.sectionTitle, { color: visual.ink }]}>
          {title}
        </Text>
        <Text style={[styles.sectionCaption, { color: visual.muted }]}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

function PortraitPageActions({
  uri,
  privatePage,
  onEdit,
  onPreview,
}: {
  uri: string;
  privatePage?: boolean;
  onEdit: () => void;
  onPreview: () => void;
}) {
  const visual = useContext(DossierVisualContext);
  return (
    <View style={styles.portraitPageActions}>
      <Pressable
        onPress={uri ? onPreview : onEdit}
        accessibilityRole="button"
        accessibilityLabel={
          uri
            ? privatePage
              ? '查看完整私密图片'
              : '查看完整公开立绘'
            : privatePage
              ? '添加私密图片'
              : '添加公开立绘'
        }
        style={({ pressed }) => [
          styles.portraitPageAction,
          { borderColor: visual.rule, backgroundColor: visual.stampFill },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.portraitPageActionText, { color: visual.ink }]}>
          {uri ? '查看全图' : privatePage ? '添加私密图' : '添加整页立绘'}
        </Text>
      </Pressable>
      {uri ? (
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={privatePage ? '更换私密图片' : '更换公开立绘'}
          style={({ pressed }) => [
            styles.portraitPageAction,
            { backgroundColor: visual.stampFill, borderColor: visual.rule },
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[styles.portraitPageActionText, { color: visual.accent }]}
          >
            更换 ↗
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type PreviewImage = {
  uri: string;
  privatePage: boolean;
};

function ImmersivePortraitViewer({
  image,
  onClose,
  onEdit,
}: {
  image: PreviewImage;
  onClose: () => void;
  onEdit: (privatePage: boolean) => void;
}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const handleSave = useCallback(async () => {
    if (saveState === 'saving') return;
    setSaveState('saving');
    setSaveMessage('正在保存原图…');
    try {
      await saveImageToDevice(image.uri);
      setSaveState('saved');
      setSaveMessage('原图已保存');
    } catch (error) {
      setSaveState('error');
      setSaveMessage(
        error instanceof Error ? error.message : '保存失败，请稍后重试。',
      );
    }
  }, [image, saveState]);

  const requestSave = useCallback(() => {
    void handleSave();
  }, [handleSave]);
  const toggleControls = useCallback(
    () => setControlsVisible((current) => !current),
    [],
  );

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * event.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });
  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      if (scale.value <= 1) return;
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((_event, success) => {
      if (!success) return;
      const nextScale = scale.value > 1.2 ? 1 : 2.4;
      scale.value = withSpring(nextScale, { damping: 18, stiffness: 180 });
      savedScale.value = nextScale;
      if (nextScale === 1) {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });
  const longPressGesture = Gesture.LongPress()
    .minDuration(520)
    .onStart(() => runOnJS(requestSave)());
  const singleTapGesture = Gesture.Tap()
    .maxDuration(220)
    .onEnd((_event, success) => {
      if (success) runOnJS(toggleControls)();
    });
  const imageGesture = Gesture.Simultaneous(
    pinchGesture,
    panGesture,
    Gesture.Exclusive(longPressGesture, doubleTapGesture, singleTapGesture),
  );
  const imageMotion = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.previewRoot}>
        <View style={styles.previewBackdrop}>
          <GestureDetector gesture={imageGesture}>
            <Reanimated.View style={[styles.previewCanvas, imageMotion]}>
              <Image
                source={image.uri}
                contentFit="contain"
                style={styles.previewImage}
              />
            </Reanimated.View>
          </GestureDetector>

          {controlsVisible ? (
            <>
              <View style={styles.previewTopBar}>
                <View>
                  <Text style={styles.previewEyebrow}>
                    {image.privatePage ? 'PRIVATE PLATE' : 'PUBLIC PLATE'}
                  </Text>
                  <Text style={styles.previewTitle}>原始立绘</Text>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="关闭全图预览"
                  style={({ pressed }) => [
                    styles.previewCloseButton,
                    pressed && styles.previewButtonPressed,
                  ]}
                >
                  <Text style={styles.previewCloseText}>×</Text>
                </Pressable>
              </View>

              <View style={styles.previewBottomBar}>
                <View style={styles.previewInstructionBlock}>
                  <Text style={styles.previewHint}>
                    双击放大 · 双指缩放 · 拖动查看 · 长按保存
                  </Text>
                  <Text style={styles.previewSubHint}>单击画面收起控制栏</Text>
                </View>
                <View style={styles.previewActions}>
                  <Pressable
                    onPress={requestSave}
                    disabled={saveState === 'saving'}
                    accessibilityRole="button"
                    accessibilityLabel="保存原图"
                    style={({ pressed }) => [
                      styles.previewPrimaryButton,
                      pressed && styles.previewButtonPressed,
                      saveState === 'saving' && styles.previewButtonDisabled,
                    ]}
                  >
                    <Text style={styles.previewPrimaryButtonText}>
                      {saveState === 'saving' ? '保存中' : '保存原图'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onEdit(image.privatePage)}
                    accessibilityRole="button"
                    accessibilityLabel="更换当前图片"
                    style={({ pressed }) => [
                      styles.previewButton,
                      pressed && styles.previewButtonPressed,
                    ]}
                  >
                    <Text style={styles.previewButtonText}>更换图片</Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}

          {saveState !== 'idle' ? (
            <View
              style={[
                styles.previewSaveToast,
                saveState === 'error' && styles.previewSaveToastError,
              ]}
            >
              <Text style={styles.previewSaveToastText}>{saveMessage}</Text>
            </View>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

export function CharacterDossierBook({
  page,
  appearanceId,
  draft,
  dossier,
  onDraftChange,
  onDossierChange,
  onImageRequest,
  biographyGeneratingId = null,
  onBiographyGenerate,
  onBiographyUpdate,
  onBiographyDelete,
}: Props) {
  const { width } = useWindowDimensions();
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const compact = width < 920;
  const visual =
    appearanceId === 'character-card-nocturne'
      ? NOCTURNE_VISUAL
      : COLLECTION_VISUAL;
  const [turn] = useState(() => new Animated.Value(1));
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const canonicalAliases = (draft.aliases ?? []).join('、');
  const [aliasesInput, setAliasesInput] = useState<string | null>(null);
  const pageMeta =
    page === 'public'
      ? { number: '01', title: '公开信息', access: '可公开调阅' }
      : page === 'private'
        ? { number: '02', title: '私密信息', access: '限制调阅' }
        : { number: '03', title: '人物小传', access: '独立阅读' };

  useEffect(() => {
    turn.stopAnimation();
    if (!motionEnabled) {
      turn.setValue(1);
      return;
    }
    turn.setValue(0);
    Animated.spring(turn, {
      toValue: 1,
      damping: 18,
      stiffness: 145,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [motionEnabled, page, turn]);

  useEffect(() => {
    const variant = resolveCharacterDossierVariant(draft.gender);
    if (dossier.private.variant !== variant) {
      onDossierChange(switchCharacterDossierVariant(dossier, variant));
    }
  }, [dossier, draft.gender, onDossierChange]);

  const paperMotion = useMemo(
    () => ({
      opacity: turn.interpolate({
        inputRange: [0, 0.35, 1],
        outputRange: [0.28, 0.78, 1],
      }),
      transform: [
        { perspective: 1200 },
        {
          rotateY: turn.interpolate({
            inputRange: [0, 1],
            outputRange: [
              page === 'public'
                ? visual.nocturne
                  ? '-18deg'
                  : '-13deg'
                : visual.nocturne
                  ? '18deg'
                  : '13deg',
              '0deg',
            ],
          }),
        },
        {
          translateX: turn.interpolate({
            inputRange: [0, 1],
            outputRange: [page === 'public' ? -30 : 30, 0],
          }),
        },
        {
          scale: turn.interpolate({
            inputRange: [0, 1],
            outputRange: [0.975, 1],
          }),
        },
      ],
    }),
    [page, turn, visual.nocturne],
  );

  const contentMotion = useMemo(
    () => ({
      opacity: turn.interpolate({
        inputRange: [0, 0.45, 1],
        outputRange: [0, 0.18, 1],
      }),
      transform: [
        {
          translateY: turn.interpolate({
            inputRange: [0, 1],
            outputRange: [24, 0],
          }),
        },
      ],
    }),
    [turn],
  );

  const ornamentMotion = useMemo(
    () => ({
      opacity: turn.interpolate({
        inputRange: [0, 0.3, 1],
        outputRange: [0, 0.12, 0.72],
      }),
      transform: [
        {
          scale: turn.interpolate({
            inputRange: [0, 1],
            outputRange: [0.72, 1],
          }),
        },
        {
          rotate: turn.interpolate({
            inputRange: [0, 1],
            outputRange: [visual.nocturne ? '-18deg' : '12deg', '0deg'],
          }),
        },
      ],
    }),
    [turn, visual.nocturne],
  );

  const publicPortrait = resolvePortraitDisplayUri(
    draft.portraitUri,
    draft.gender,
  );
  const privatePortrait = dossier.private.portraitUri
    ? (resolveNovelImageUri(dossier.private.portraitUri) ?? '')
    : '';
  const pagePortrait =
    page === 'public'
      ? publicPortrait
      : page === 'private'
        ? privatePortrait
        : '';
  const portraitVeil = pagePortrait
    ? {
        backgroundColor: visual.nocturne
          ? 'rgba(19,18,16,0.2)'
          : 'rgba(247,242,232,0.14)',
        borderColor: visual.rule,
      }
    : undefined;

  function updatePublic<K extends keyof CharacterDossierV2['public']>(
    key: K,
    value: CharacterDossierV2['public'][K],
  ) {
    onDossierChange({
      ...dossier,
      public: { ...dossier.public, [key]: value },
    });
  }

  function updatePrivate(key: string, value: string) {
    onDossierChange({
      ...dossier,
      private: { ...dossier.private, [key]: value },
    } as CharacterDossierV2);
  }

  return (
    <DossierVisualContext.Provider value={visual}>
      <View
        style={[styles.bookStage, visual.nocturne && styles.bookStageNocturne]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.paperBackTwo,
            { backgroundColor: visual.back },
            visual.nocturne && styles.paperBackNocturne,
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.paperBackOne,
            { backgroundColor: visual.paperDeep },
            visual.nocturne && styles.paperBackNocturne,
          ]}
        />
        <Animated.View
          style={[
            styles.paper,
            {
              backgroundColor: visual.paper,
              borderColor: visual.rule,
              shadowColor: visual.shadow,
            },
            visual.nocturne && styles.paperNocturne,
            paperMotion,
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              styles.paperGrain,
              {
                borderLeftColor: visual.nocturne
                  ? 'rgba(201,170,120,0.04)'
                  : 'rgba(119,55,47,0.06)',
              },
            ]}
          />
          {pagePortrait ? (
            <View
              pointerEvents="none"
              style={[
                styles.portraitPageLayer,
                compact && styles.portraitPageLayerCompact,
              ]}
            >
              <Image
                source={pagePortrait}
                contentFit="cover"
                contentPosition="top center"
                blurRadius={24}
                style={[
                  styles.portraitPageAtmosphere,
                  compact && styles.portraitPageAtmosphereCompact,
                  visual.nocturne && styles.portraitPageAtmosphereNocturne,
                ]}
              />
              <Image
                source={pagePortrait}
                contentFit="contain"
                contentPosition="top center"
                style={[
                  styles.portraitPageFigure,
                  compact && styles.portraitPageFigureCompact,
                  visual.nocturne && styles.portraitPageFigureNocturne,
                ]}
              />
            </View>
          ) : null}
          <View
            pointerEvents="none"
            style={[styles.innerBezel, { borderColor: visual.rule }]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.orbit,
              visual.nocturne ? styles.orbitNocturne : styles.orbitCollection,
              { borderColor: visual.accent },
              ornamentMotion,
            ]}
          >
            <View style={[styles.orbitInner, { borderColor: visual.rule }]} />
          </Animated.View>
          <Animated.Text
            pointerEvents="none"
            style={[
              styles.pageWatermark,
              { color: visual.accent },
              visual.nocturne && styles.pageWatermarkNocturne,
              ornamentMotion,
            ]}
          >
            {pageMeta.number}
          </Animated.Text>
          {!compact ? (
            <View pointerEvents="none" style={styles.edgeTelemetry}>
              <Text
                style={[styles.edgeTelemetryText, { color: visual.accent }]}
              >
                TAVERN / PERSONA
              </Text>
              <View
                style={[
                  styles.edgeTelemetryRule,
                  { backgroundColor: visual.accent },
                ]}
              />
              <Text style={[styles.edgeTelemetryText, { color: visual.muted }]}>
                03—{pageMeta.number}
              </Text>
            </View>
          ) : null}
          <View
            style={[
              styles.bookHeader,
              { borderBottomColor: visual.nocturne ? visual.rule : visual.ink },
              pagePortrait && styles.bookHeaderWithPortrait,
              pagePortrait && portraitVeil,
              visual.nocturne && styles.bookHeaderNocturne,
              compact && styles.bookHeaderCompact,
            ]}
          >
            <View>
              <Text
                style={[
                  styles.eyebrow,
                  { color: visual.nocturne ? visual.accent : visual.muted },
                ]}
              >
                {visual.nocturne
                  ? 'NOCTURNE PERSONA'
                  : 'THE CHARACTER COLLECTION'}{' '}
                · {pageMeta.number}
              </Text>
              <Text
                style={[
                  styles.bookTitle,
                  { color: visual.ink },
                  visual.nocturne && styles.bookTitleNocturne,
                ]}
              >
                {pageMeta.title}
              </Text>
            </View>
            <View
              style={[
                styles.bookHeaderActions,
                compact && styles.bookHeaderActionsCompact,
              ]}
            >
              {page === 'public' || page === 'private' ? (
                <PortraitPageActions
                  uri={pagePortrait}
                  privatePage={page === 'private'}
                  onEdit={() => onImageRequest(page)}
                  onPreview={() =>
                    setPreviewImage({
                      uri: pagePortrait,
                      privatePage: page === 'private',
                    })
                  }
                />
              ) : null}
              <View
                style={[
                  styles.confidentialTag,
                  {
                    borderColor:
                      page === 'private' ? visual.accent : visual.muted,
                  },
                  visual.nocturne && styles.confidentialTagNocturne,
                ]}
              >
                <Text
                  style={[
                    styles.confidentialText,
                    {
                      color: page === 'private' ? visual.accent : visual.muted,
                    },
                  ]}
                >
                  {pageMeta.access}
                </Text>
              </View>
            </View>
          </View>

          <Animated.View style={[styles.pageContent, contentMotion]}>
            {page === 'public' ? (
              <>
                <View
                  style={[
                    styles.hero,
                    compact && styles.heroCompact,
                  ]}
                >
                  <View style={styles.heroFields}>
                    <PaperField
                      label="姓名"
                      value={draft.name}
                      placeholder="角色姓名"
                      onChangeText={(value) => onDraftChange('name', value)}
                    />
                    <PaperField
                      label="性别"
                      value={draft.gender}
                      placeholder="填写男或女，私密字段会自动匹配"
                      onChangeText={(value) => onDraftChange('gender', value)}
                    />
                    <PaperField
                      label="身份 / 职业"
                      value={draft.profession}
                      placeholder="职业、专业、社会身份"
                      onChangeText={(value) =>
                        onDraftChange('profession', value)
                      }
                    />
                  </View>
                </View>

                <View style={[styles.archiveLedger, portraitVeil]}>
                  <SectionHeading
                    index="A"
                    title="基础档案"
                    caption="出生、籍贯、居住与所属信息"
                  />
                  <View
                    style={[
                      styles.fieldGrid,
                      compact && styles.fieldGridCompact,
                    ]}
                  >
                    <PaperField
                      label="出生日期"
                      paired
                      compact={compact}
                      value={dossier.public.birthDate}
                      placeholder="如 2004年3月17日"
                      onChangeText={(value) => updatePublic('birthDate', value)}
                    />
                    <PaperField
                      label="年龄"
                      paired
                      compact={compact}
                      value={draft.age}
                      placeholder="如 22岁"
                      onChangeText={(value) => onDraftChange('age', value)}
                    />
                    <PaperField
                      label="籍贯 / 出生地"
                      paired
                      compact={compact}
                      value={draft.birthplace ?? ''}
                      placeholder="出生地、籍贯"
                      onChangeText={(value) =>
                        onDraftChange('birthplace', value)
                      }
                    />
                    <PaperField
                      label="当前居住地"
                      paired
                      compact={compact}
                      value={dossier.public.residence}
                      placeholder="现居城市、宿舍或住所"
                      onChangeText={(value) => updatePublic('residence', value)}
                    />
                    <PaperField
                      label="所属"
                      paired
                      compact={compact}
                      value={draft.affiliation ?? ''}
                      placeholder="学校、组织、阵营或团队"
                      onChangeText={(value) =>
                        onDraftChange('affiliation', value)
                      }
                    />
                    <PaperField
                      label="其他称呼 / 触发词"
                      paired
                      compact={compact}
                      value={aliasesInput ?? canonicalAliases}
                      placeholder="昵称、姓氏称呼、头衔；用逗号分隔"
                      onFocus={() => setAliasesInput(canonicalAliases)}
                      onBlur={() => setAliasesInput(null)}
                      onChangeText={(value) => {
                        setAliasesInput(value);
                        onDraftChange(
                          'aliases',
                          normalizeAliases(value).filter(
                            (alias) =>
                              alias.toLowerCase() !==
                              draft.name.trim().toLowerCase(),
                          ),
                        );
                      }}
                    />
                  </View>

                  <SectionHeading
                    index="B"
                    title="身体记录"
                    caption="常用数值直接可见，其余比例、伤病与健康信息合并记录"
                  />
                  <View
                    style={[
                      styles.fieldGrid,
                      compact && styles.fieldGridCompact,
                    ]}
                  >
                    <PaperField
                      label="身高"
                      paired
                      compact={compact}
                      value={draft.height}
                      placeholder="如 186cm"
                      onChangeText={(value) => onDraftChange('height', value)}
                    />
                    <PaperField
                      label="体重"
                      paired
                      compact={compact}
                      value={draft.weight}
                      placeholder="如 80kg"
                      onChangeText={(value) => onDraftChange('weight', value)}
                    />
                    <PaperField
                      label="体脂率"
                      paired
                      compact={compact}
                      value={dossier.public.bodyFat}
                      placeholder="如 12%"
                      onChangeText={(value) => updatePublic('bodyFat', value)}
                    />
                    <PaperField
                      label="三围"
                      paired
                      compact={compact}
                      value={dossier.public.measurements}
                      placeholder="胸围 / 腰围 / 臀围"
                      onChangeText={(value) =>
                        updatePublic('measurements', value)
                      }
                    />
                    <PaperField
                      label="鞋码"
                      paired
                      compact={compact}
                      value={dossier.public.shoeSize}
                      placeholder="如 EU 43 / 27.5cm"
                      onChangeText={(value) => updatePublic('shoeSize', value)}
                    />
                  </View>
                  <PaperField
                    label="其他身体记录"
                    value={dossier.public.bodyStats}
                    placeholder="肩宽、腿围、骨架、体型、身体比例、惯用手、旧伤与健康状况"
                    multiline
                    onChangeText={(value) => updatePublic('bodyStats', value)}
                  />

                  <SectionHeading
                    index="C"
                    title="外观与衣着"
                    caption="外貌单列；所有服装压缩成一个场景化字段"
                  />
                  <PaperField
                    label="长相与五官"
                    value={draft.appearance}
                    placeholder="脸型、眉眼、鼻唇、发型、肤色、面部痣疤和稳定辨识特征"
                    multiline
                    onChangeText={(value) => onDraftChange('appearance', value)}
                  />
                  <PaperField
                    label="穿衣风格"
                    value={dossier.public.clothingStyle}
                    placeholder="日常、工作/训练、正式、居家、睡眠，以及内裤、袜子等贴身衣物的款式、材质、颜色和更换习惯"
                    multiline
                    onChangeText={(value) =>
                      updatePublic('clothingStyle', value)
                    }
                  />

                  <SectionHeading
                    index="D"
                    title="性格与生活"
                    caption="把性格、习惯、作息、喜好与说话印象放在同一处"
                  />
                  <PaperField
                    label="公开侧写"
                    value={dossier.public.personalityAndLife}
                    placeholder="表层/深层性格、情绪表达、日常习惯、作息、爱好、消费与社交方式、口头禅"
                    multiline
                    onChangeText={(value) =>
                      updatePublic('personalityAndLife', value)
                    }
                  />
                </View>
              </>
            ) : page === 'private' ? (
              <>
                <View
                  style={[
                    styles.privateHero,
                    compact && styles.heroCompact,
                  ]}
                >
                  <View
                    style={[
                      styles.privateNotice,
                      { borderColor: visual.accent },
                    ]}
                  >
                    <Text
                      style={[
                        styles.privateNoticeTitle,
                        { color: visual.accent },
                      ]}
                    >
                      {dossier.private.variant === 'male'
                        ? '成年男性私密档案'
                        : '成年女性私密档案'}
                    </Text>
                    <Text
                      style={[
                        styles.privateNoticeText,
                        { color: visual.muted },
                      ]}
                    >
                      与公开立绘完全分离。字段允许直接、具体，但只记录对人物和成人叙事有意义的内容。
                    </Text>
                  </View>
                </View>

                <View style={[styles.archiveLedger, portraitVeil]}>
                  {dossier.private.variant === 'male' ? (
                    <>
                      <SectionHeading
                        index="A"
                        title="男性私密身体"
                        caption="静态身体事实，不与偏好和行为混写"
                      />
                      <PaperField
                        label="阴茎"
                        value={dossier.private.penis}
                        placeholder="包皮状态、疲软/勃起尺寸、形状、角度、色泽、血管与辨识特征"
                        multiline
                        onChangeText={(value) => updatePrivate('penis', value)}
                      />
                      <PaperField
                        label="睾丸、阴囊与阴毛"
                        value={dossier.private.testiclesAndPubicHair}
                        placeholder="外观、左右差异、体毛分布、浓密程度、修整与清洁习惯"
                        multiline
                        onChangeText={(value) =>
                          updatePrivate('testiclesAndPubicHair', value)
                        }
                      />
                      <PaperField
                        label="肛门与会阴"
                        value={dossier.private.anus}
                        placeholder="外观、色泽、健康、敏感度、清洁习惯与接受程度"
                        multiline
                        onChangeText={(value) => updatePrivate('anus', value)}
                      />
                      <PaperField
                        label="其他私密身体"
                        value={dossier.private.intimateBody}
                        placeholder="胸部、乳头、体毛、臀腿、气味和其他值得记录的身体特征"
                        multiline
                        onChangeText={(value) =>
                          updatePrivate('intimateBody', value)
                        }
                      />
                    </>
                  ) : (
                    <>
                      <SectionHeading
                        index="A"
                        title="女性私密身体"
                        caption="静态身体事实，不与偏好和行为混写"
                      />
                      <PaperField
                        label="胸部与身体"
                        value={dossier.private.breastsAndBody}
                        placeholder="胸部、乳头、体毛、臀腿、气味和其他私密身体特征"
                        multiline
                        onChangeText={(value) =>
                          updatePrivate('breastsAndBody', value)
                        }
                      />
                      <PaperField
                        label="外阴与阴蒂"
                        value={dossier.private.vulva}
                        placeholder="外观、色泽、构造、阴蒂、体毛、修整与清洁习惯"
                        multiline
                        onChangeText={(value) => updatePrivate('vulva', value)}
                      />
                      <PaperField
                        label="阴道"
                        value={dossier.private.vagina}
                        placeholder="与身体和叙事相关的生理特征、敏感度与健康信息"
                        multiline
                        onChangeText={(value) => updatePrivate('vagina', value)}
                      />
                      <PaperField
                        label="肛门与会阴"
                        value={dossier.private.anus}
                        placeholder="外观、色泽、健康、敏感度、清洁习惯与接受程度"
                        multiline
                        onChangeText={(value) => updatePrivate('anus', value)}
                      />
                    </>
                  )}

                  <SectionHeading
                    index="B"
                    title="反应与亲密"
                    caption="动态反应、经验和边界分开记录"
                  />
                  <PaperField
                    label="性生理反应"
                    value={dossier.private.sexualResponse}
                    placeholder="唤起速度、呼吸和肌肉反应、主要敏感区域、耐力、恢复与不适表现"
                    multiline
                    onChangeText={(value) =>
                      updatePrivate('sexualResponse', value)
                    }
                  />
                  <PaperField
                    label="经验、偏好与习惯"
                    value={dossier.private.intimacyProfile}
                    placeholder="性取向、经验、主动方式、角色倾向、自慰习惯、喜欢与愿意尝试的内容"
                    multiline
                    onChangeText={(value) =>
                      updatePrivate('intimacyProfile', value)
                    }
                  />
                </View>
              </>
            ) : (
              <CharacterBiographyPage
                entries={draft.biographies ?? []}
                palette={visual}
                generatingId={biographyGeneratingId}
                onGenerate={onBiographyGenerate}
                onUpdate={onBiographyUpdate}
                onDelete={onBiographyDelete}
              />
            )}
          </Animated.View>

          <View style={[styles.pageFooter, { borderTopColor: visual.rule }]}>
            <Text style={[styles.pageFooterText, { color: visual.muted }]}>
              {visual.nocturne
                ? 'NOCTURNE / PERSONA OFFICE'
                : 'ARCHIVE OF PERSONAE'}
            </Text>
            <Text style={[styles.pageNumber, { color: visual.ink }]}>
              {pageMeta.number} / 03
            </Text>
          </View>
          <View
            pointerEvents="none"
            style={[styles.foldCorner, { borderTopColor: visual.corner }]}
          />
        </Animated.View>
      </View>
      {previewImage ? (
        <ImmersivePortraitViewer
          key={`${previewImage.privatePage ? 'private' : 'public'}:${previewImage.uri}`}
          image={previewImage}
          onClose={() => setPreviewImage(null)}
          onEdit={(privatePage) => {
            setPreviewImage(null);
            onImageRequest(privatePage ? 'private' : 'public');
          }}
        />
      ) : null}
    </DossierVisualContext.Provider>
  );
}

const styles = StyleSheet.create({
  bookStage: {
    width: '100%',
    paddingHorizontal: 4,
    paddingBottom: 10,
  },
  bookStageNocturne: {
    paddingHorizontal: 2,
  },
  paperBackTwo: {
    position: 'absolute',
    left: 16,
    right: 0,
    top: 12,
    bottom: 0,
    backgroundColor: '#cdbb9f',
    transform: [{ rotate: '0.8deg' }],
  },
  paperBackOne: {
    position: 'absolute',
    left: 8,
    right: 5,
    top: 6,
    bottom: 4,
    backgroundColor: PAPER_DEEP,
    transform: [{ rotate: '-0.45deg' }],
  },
  paperBackNocturne: {
    transform: [{ rotate: '0deg' }],
    opacity: 0.72,
  },
  paper: {
    overflow: 'hidden',
    backgroundColor: PAPER,
    borderWidth: 1,
    borderColor: RULE,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.three,
    shadowColor: '#3a2617',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 8,
  },
  paperNocturne: {
    borderWidth: 6,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    shadowOpacity: 0.46,
    shadowRadius: 24,
  },
  paperGrain: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.18,
    borderLeftWidth: 18,
    borderLeftColor: 'rgba(132, 93, 55, 0.08)',
  },
  innerBezel: {
    position: 'absolute',
    top: 7,
    right: 7,
    bottom: 7,
    left: 7,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.7,
  },
  orbit: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 130,
  },
  orbitCollection: {
    right: -118,
    top: 84,
  },
  orbitNocturne: {
    right: -86,
    top: -72,
    borderWidth: 1,
  },
  orbitInner: {
    position: 'absolute',
    top: 21,
    right: 21,
    bottom: 21,
    left: 21,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 110,
  },
  pageWatermark: {
    position: 'absolute',
    right: 28,
    top: 64,
    fontFamily: 'serif',
    fontSize: 108,
    lineHeight: 116,
    fontWeight: '400',
    opacity: 0.08,
  },
  pageWatermarkNocturne: {
    top: 70,
    fontSize: 126,
    lineHeight: 132,
  },
  edgeTelemetry: {
    position: 'absolute',
    right: 7,
    top: 210,
    bottom: 72,
    alignItems: 'center',
    gap: 9,
    opacity: 0.74,
  },
  edgeTelemetryText: {
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1.6,
    writingDirection: 'ltr',
    transform: [{ rotate: '90deg' }],
    width: 92,
    textAlign: 'center',
  },
  edgeTelemetryRule: {
    width: 1,
    flex: 1,
    maxHeight: 94,
    opacity: 0.7,
  },
  pageContent: {
    gap: Spacing.three,
    zIndex: 1,
  },
  bookHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
    borderBottomWidth: 2,
    borderBottomColor: INK,
  },
  bookHeaderWithPortrait: {
    paddingTop: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 2,
  },
  bookHeaderCompact: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  bookHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  bookHeaderActionsCompact: {
    width: '100%',
    justifyContent: 'space-between',
  },
  bookHeaderNocturne: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.three,
  },
  eyebrow: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  bookTitle: {
    color: INK,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  bookTitleNocturne: {
    fontFamily: 'serif',
    fontWeight: '600',
    letterSpacing: 1.2,
  },
  confidentialTag: {
    borderWidth: 1,
    borderColor: MUTED,
    paddingHorizontal: 8,
    paddingVertical: 5,
    transform: [{ rotate: '-2deg' }],
  },
  confidentialTagPrivate: {
    borderColor: ACCENT,
  },
  confidentialTagNocturne: {
    transform: [{ rotate: '0deg' }],
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  confidentialText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  confidentialTextPrivate: {
    color: ACCENT,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.three,
  },
  heroCompact: {
    flexDirection: 'column',
  },
  heroFields: {
    flex: 1,
    gap: Spacing.two,
  },
  archiveLedger: {
    gap: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    backgroundColor: 'rgba(247,242,232,0.92)',
  },
  portraitPageLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  portraitPageLayerCompact: {
    opacity: 0.72,
  },
  portraitPageAtmosphere: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    opacity: 0.045,
  },
  portraitPageAtmosphereCompact: {
    opacity: 0.035,
  },
  portraitPageAtmosphereNocturne: {
    opacity: 0.085,
  },
  portraitPageFigure: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    opacity: 0.2,
  },
  portraitPageFigureCompact: {
    opacity: 0.16,
  },
  portraitPageFigureNocturne: {
    opacity: 0.24,
  },
  portraitPageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  portraitPageAction: {
    minHeight: 30,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  portraitPageActionText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  previewRoot: {
    flex: 1,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: '#070605',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCanvas: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewTopBar: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(232,220,199,0.18)',
    backgroundColor: 'rgba(7,6,5,0.78)',
  },
  previewEyebrow: {
    color: '#c9aa78',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  previewTitle: {
    color: '#f0e8db',
    fontFamily: 'serif',
    fontSize: 22,
    lineHeight: 28,
    marginTop: 2,
  },
  previewCloseButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(232,220,199,0.36)',
    backgroundColor: 'rgba(24,21,18,0.72)',
  },
  previewCloseText: {
    color: '#f0e8db',
    fontFamily: 'serif',
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '300',
  },
  previewBottomBar: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,220,199,0.18)',
    backgroundColor: 'rgba(7,6,5,0.82)',
  },
  previewInstructionBlock: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 220,
  },
  previewHint: {
    color: '#eee6d8',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  previewSubHint: {
    color: 'rgba(238,230,216,0.56)',
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 0.5,
  },
  previewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  previewButton: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(232,220,199,0.38)',
    backgroundColor: 'rgba(20,18,15,0.68)',
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
  },
  previewButtonText: {
    color: '#eee6d8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  previewPrimaryButton: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c9aa78',
    backgroundColor: '#c9aa78',
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
  },
  previewPrimaryButtonText: {
    color: '#17130e',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  previewButtonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  previewButtonDisabled: {
    opacity: 0.5,
  },
  previewSaveToast: {
    position: 'absolute',
    bottom: 118,
    maxWidth: '84%',
    borderLeftWidth: 2,
    borderLeftColor: '#c9aa78',
    backgroundColor: 'rgba(22,19,16,0.9)',
    paddingHorizontal: Spacing.two,
    paddingVertical: 9,
  },
  previewSaveToastError: {
    borderLeftColor: '#a55249',
  },
  previewSaveToastText: {
    color: '#eee6d8',
    fontSize: 11,
    lineHeight: 16,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: 2,
  },
  sectionIndex: {
    color: PAPER,
    backgroundColor: INK,
    width: 29,
    height: 29,
    lineHeight: 29,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
  },
  sectionIndexNocturne: {
    color: '#17130e',
    fontFamily: 'serif',
    fontWeight: '600',
  },
  sectionCopy: {
    flex: 1,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  sectionTitle: {
    color: INK,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionCaption: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 14,
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.three,
    rowGap: Spacing.two,
  },
  fieldGridCompact: {
    flexDirection: 'column',
  },
  field: {
    flexGrow: 1,
    gap: 4,
  },
  fieldPaired: {
    flexGrow: 0,
    flexBasis: '48%',
    minWidth: 0,
  },
  fieldFull: {
    flexGrow: 0,
    flexBasis: 'auto',
    width: '100%',
  },
  fieldLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  input: {
    color: INK,
    minHeight: 38,
    paddingHorizontal: 0,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    fontSize: 14,
    lineHeight: 20,
  },
  inputMultiline: {
    minHeight: 92,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: RULE,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  inputNocturne: {
    letterSpacing: 0.2,
  },
  privateHero: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'stretch',
  },
  privateNotice: {
    flex: 1,
    justifyContent: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: ACCENT,
    paddingVertical: Spacing.two,
    gap: 6,
  },
  privateNoticeTitle: {
    color: ACCENT,
    fontSize: 17,
    fontWeight: '800',
  },
  privateNoticeText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
  pageFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  pageFooterText: {
    color: MUTED,
    fontSize: 8,
    letterSpacing: 1.2,
  },
  pageNumber: {
    color: INK,
    fontSize: 13,
    fontWeight: '800',
  },
  foldCorner: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 22,
    borderTopWidth: 22,
    borderLeftColor: 'transparent',
    borderTopColor: '#d1c1a9',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.985 }],
  },
});
