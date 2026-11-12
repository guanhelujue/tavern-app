import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTavernStore } from '@/store/tavern-store';
import type { Novel } from '@/types/tavern';
import { resolveNovelImageUri } from '@/utils/novel-images';

type Props = {
  novels: Novel[];
  onOpen: (novelId: string) => void;
  onDelete: (novelId: string) => void;
  onCreate: () => void;
  onImport: () => void;
};

const CARD_ROTATIONS = ['-3deg', '-1.5deg', '1deg', '2.5deg', '-0.8deg', '1.8deg'];

export function NovelMobileShelf({ novels, onOpen, onDelete, onCreate, onImport }: Props) {
  const { width } = useWindowDimensions();
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const [deckExpanded, setDeckExpanded] = useState(!motionEnabled);
  const deckScrollRef = useRef<ScrollView>(null);
  const deckExpandedRef = useRef(!motionEnabled);
  const [deckProgress] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));
  const effectiveDeckExpanded = !motionEnabled || deckExpanded;

  const compact = width < 640;
  const cardWidth = compact ? 214 : 252;
  const cardHeight = compact ? 334 : 390;
  const cardOverlap = compact ? 34 : 48;
  const latestNovel = [...novels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const draftCount = novels.filter((novel) => novel.isDraft).length;

  useEffect(() => {
    deckProgress.stopAnimation();
    deckProgress.setValue(motionEnabled && !deckExpandedRef.current ? 0 : 1);
  }, [deckProgress, motionEnabled]);

  async function setDeckOpen(nextExpanded: boolean) {
    if (!motionEnabled) {
      deckProgress.setValue(1);
      return;
    }

    const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
    if (!nextExpanded) {
      deckScrollRef.current?.scrollTo({ x: 0, animated: false });
    }
    deckExpandedRef.current = nextExpanded;
    setDeckExpanded(nextExpanded);
    if (reduceMotion) {
      deckProgress.setValue(nextExpanded ? 1 : 0);
      return;
    }

    Animated.spring(deckProgress, {
      toValue: nextExpanded ? 1 : 0,
      damping: 18,
      stiffness: 135,
      mass: 0.86,
      useNativeDriver: false,
    }).start();
  }

  function showNovelActions(novel: Novel) {
    Alert.alert(novel.name, '作品操作', [
      { text: '进入工作台', onPress: () => onOpen(novel.id) },
      { text: '删除作品', style: 'destructive', onPress: () => onDelete(novel.id) },
      { text: '取消', style: 'cancel' },
    ]);
  }

  return (
    <ScrollView
      style={styles.scroll}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, compact && styles.contentCompact]}>
      <View style={[styles.deckStage, compact && styles.deckStageCompact]}>
        <View pointerEvents="none" style={styles.deckAtmosphere}>
          <View style={styles.deckOrbitOuter} />
          <View style={styles.deckOrbitInner} />
          <View style={styles.deckAxisHorizontal} />
          <View style={styles.deckAxisVertical} />
          <ThemedText style={styles.deckGhostNumber}>
            {String(Math.max(novels.length, 1)).padStart(2, '0')}
          </ThemedText>
        </View>

        <View style={[styles.deckHeader, compact && styles.deckHeaderCompact]}>
          <View style={styles.deckTitleBlock}>
            <View style={styles.deckKickerRow}>
              <View style={styles.deckSignal} />
              <ThemedText type="code" style={styles.deckKicker}>
                THE NARRATIVE DECK / ACTIVE
              </ThemedText>
            </View>
            <ThemedText style={styles.deckTitle}>叙事牌阵</ThemedText>
            <ThemedText style={styles.deckDescription}>
              每张牌封存一个仍在生长的世界。横向推开牌组，选择下一条要进入的叙事。
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={effectiveDeckExpanded ? '收拢牌组' : '展开牌组'}
              accessibilityState={{ expanded: effectiveDeckExpanded, disabled: !motionEnabled }}
              onPress={() => { void setDeckOpen(!effectiveDeckExpanded); }}
              disabled={!motionEnabled}
              style={({ pressed }) => [
                styles.deckStateButton,
                !motionEnabled && styles.deckStateButtonDisabled,
                pressed && styles.pressed,
              ]}>
              <View style={styles.deckStateDot} />
              <ThemedText type="code" style={styles.deckStateLabel}>
                {motionEnabled
                  ? effectiveDeckExpanded ? '收拢牌组 / STACK' : '展开牌组 / REVEAL'
                  : '静态平铺 / MOTION OFF'}
              </ThemedText>
            </Pressable>
          </View>
          <View style={[styles.deckTelemetry, compact && styles.deckTelemetryCompact]}>
            <View>
              <ThemedText type="code" style={styles.deckTelemetryValue}>{novels.length}</ThemedText>
              <ThemedText type="code" style={styles.deckTelemetryLabel}>WORLDS</ThemedText>
            </View>
            <View style={styles.deckTelemetryRule} />
            <View>
              <ThemedText type="code" style={styles.deckTelemetryValue}>{draftCount}</ThemedText>
              <ThemedText type="code" style={styles.deckTelemetryLabel}>DRAFTS</ThemedText>
            </View>
            <View style={styles.deckTelemetryRule} />
            <View style={styles.latestSignal}>
              <ThemedText type="code" style={styles.deckTelemetryValue} numberOfLines={1}>
                {latestNovel?.name ?? 'WAITING'}
              </ThemedText>
              <ThemedText type="code" style={styles.deckTelemetryLabel}>LAST SIGNAL</ThemedText>
            </View>
          </View>
        </View>

        <ScrollView
          ref={deckScrollRef}
          horizontal
          removeClippedSubviews={false}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={cardWidth - cardOverlap}
          scrollEnabled={effectiveDeckExpanded}
          contentContainerStyle={[
            styles.deckScroll,
            !effectiveDeckExpanded && styles.deckScrollCollapsed,
          ]}
          accessibilityLabel="小说牌组">
          {novels.map((novel, index) => {
            const coverUri = resolveNovelImageUri(novel.coverImageUri);
            const rotation = CARD_ROTATIONS[index % CARD_ROTATIONS.length];

            return (
            <Animated.View
              key={novel.id}
              style={[
                styles.arcanaCardMotion,
                {
                  width: cardWidth,
                  height: cardHeight,
                  marginLeft: index === 0
                    ? 0
                    : deckProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-(cardWidth - 13), -cardOverlap],
                    }),
                  zIndex: effectiveDeckExpanded ? index + 2 : novels.length - index + 2,
                  transform: [
                    {
                      rotate: deckProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', rotation],
                      }),
                    },
                    {
                      translateY: deckProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, (index % 3) * 4],
                      }),
                    },
                    {
                      scale: deckProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.965, 1],
                      }),
                    },
                  ],
                },
              ]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={'打开作品 ' + novel.name}
              accessibilityHint="收拢时点按展开牌组，展开后点按进入工作台；长按可管理作品"
              onLongPress={() => showNovelActions(novel)}
              onPress={() => {
                if (!effectiveDeckExpanded) {
                  void setDeckOpen(true);
                  return;
                }
                onOpen(novel.id);
              }}
              style={({ pressed }) => [styles.arcanaCard, pressed && styles.pressed]}>
              <View style={styles.arcanaInnerFrame} />
              {coverUri ? (
                <Image source={{ uri: coverUri }} style={styles.bookCover} contentFit="cover" />
              ) : (
                <View style={styles.arcanaPlaceholder}>
                  <View style={styles.arcanaSunOuter}>
                    <View style={styles.arcanaSunInner}>
                      <ThemedText style={styles.arcanaMonogram}>
                        {novel.name.trim().slice(0, 1) || '叙'}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.placeholderAxisHorizontal} />
                  <View style={styles.placeholderAxisVertical} />
                </View>
              )}
              <View pointerEvents="none" style={styles.cardVeil} />
              <View style={styles.cardTopLine}>
                <ThemedText type="code" style={styles.cardNumeral}>
                  {String(index + 1).padStart(2, '0')}
                </ThemedText>
                <ThemedText type="code" style={styles.cardStatus}>
                  {novel.isDraft ? 'DRAFT' : 'ARCHIVE'}
                </ThemedText>
              </View>
              <View style={styles.cardTitlePlate}>
                <ThemedText type="code" style={styles.cardWorld} numberOfLines={1}>
                  {novel.worldName || (novel.isDraft ? 'UNFINISHED WORLD' : 'UNNAMED WORLD')}
                </ThemedText>
                <ThemedText numberOfLines={2} style={styles.cardTitle}>{novel.name}</ThemedText>
                <View style={styles.cardFooterRule} />
                <ThemedText type="code" style={styles.cardInstruction}>
                  点按进入工作台
                </ThemedText>
              </View>
            </Pressable>
            </Animated.View>
            );
          })}

          <Animated.View
            style={[
              styles.arcanaCardMotion,
              {
                width: cardWidth,
                height: cardHeight,
                marginLeft: novels.length === 0
                  ? 0
                  : deckProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-(cardWidth - 13), -cardOverlap],
                  }),
                zIndex: effectiveDeckExpanded ? novels.length + 2 : 1,
                transform: [
                  {
                    rotate: deckProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', CARD_ROTATIONS[novels.length % CARD_ROTATIONS.length]],
                    }),
                  },
                  {
                    scale: deckProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.965, 1],
                    }),
                  },
                ],
              },
            ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="创建作品"
            onPress={() => {
              if (!effectiveDeckExpanded) {
                void setDeckOpen(true);
                return;
              }
              onCreate();
            }}
            style={({ pressed }) => [styles.arcanaCard, styles.newWorldCard, pressed && styles.pressed]}>
            <View style={styles.arcanaInnerFrame} />
            <View style={styles.newWorldSigil}>
              <View style={styles.newWorldSigilInner}>
                <ThemedText style={styles.newWorldPlus}>＋</ThemedText>
              </View>
            </View>
            <ThemedText type="code" style={styles.cardNumeral}>00</ThemedText>
            <View style={styles.cardTitlePlate}>
              <ThemedText type="code" style={styles.cardWorld}>UNDRAWN CARD</ThemedText>
              <ThemedText style={styles.cardTitle}>创建作品</ThemedText>
              <View style={styles.cardFooterRule} />
              <ThemedText type="code" style={styles.cardInstruction}>填写世界，进入小说工作台</ThemedText>
            </View>
          </Pressable>
          </Animated.View>
        </ScrollView>

        <View style={[styles.deckFooter, compact && styles.deckFooterCompact]}>
          <View style={styles.swipeCue}>
            <ThemedText type="code" style={styles.swipeCueText}>
              {effectiveDeckExpanded ? '← SWIPE THE DECK →' : 'TAP THE STACK TO REVEAL'}
            </ThemedText>
          </View>
          <View style={styles.deckTools}>
            <Pressable accessibilityRole="button" accessibilityLabel="恢复作品档案" onPress={onImport} style={({ pressed }) => [styles.deckTool, pressed && styles.pressed]}>
              <ThemedText type="code" style={styles.deckToolIndex}>01</ThemedText>
              <ThemedText style={styles.deckToolLabel}>恢复完整档案</ThemedText>
              <ThemedText style={styles.deckToolArrow}>↗</ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, width: '100%', maxWidth: 1180, alignSelf: 'center' },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    gap: Spacing.five,
  },
  contentCompact: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 0,
  },
  deckStage: {
    minHeight: 620,
    backgroundColor: '#151819',
    borderRadius: 30,
    overflow: 'hidden',
    position: 'relative',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    shadowColor: '#160E09',
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 14,
  },
  deckStageCompact: {
    flexGrow: 1,
    borderRadius: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  deckAtmosphere: { position: 'absolute', inset: 0, overflow: 'hidden' },
  deckOrbitOuter: {
    position: 'absolute', width: 480, height: 480, borderRadius: 240,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(185,133,97,0.34)',
    right: -170, top: -240,
  },
  deckOrbitInner: {
    position: 'absolute', width: 300, height: 300, borderRadius: 150,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244,239,231,0.14)',
    right: -80, top: -150,
  },
  deckAxisHorizontal: {
    position: 'absolute', left: 0, right: 0, top: 158, height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(244,239,231,0.1)',
  },
  deckAxisVertical: {
    position: 'absolute', right: '18%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(244,239,231,0.08)',
  },
  deckGhostNumber: {
    position: 'absolute', right: 24, top: -26, color: 'rgba(244,239,231,0.065)',
    fontFamily: Fonts.serif, fontSize: 146, lineHeight: 164,
  },
  deckHeader: {
    paddingHorizontal: Spacing.four,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: Spacing.four,
    zIndex: 2,
  },
  deckHeaderCompact: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.three },
  deckTitleBlock: { flex: 1, maxWidth: 610, gap: Spacing.one },
  deckKickerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  deckSignal: { width: 32, height: 2, backgroundColor: '#B98561' },
  deckKicker: { color: '#B98561', fontSize: 9, letterSpacing: 1.2, fontWeight: '800' },
  deckTitle: {
    color: '#F4EFE7', fontFamily: Fonts.serif, fontSize: 42, lineHeight: 52, letterSpacing: -1.5,
  },
  deckDescription: { color: '#AAA39C', fontSize: 13, lineHeight: 22, maxWidth: 560 },
  deckStateButton: {
    alignSelf: 'flex-start',
    minHeight: 34,
    marginTop: Spacing.two,
    paddingHorizontal: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(185,133,97,0.52)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  deckStateButtonDisabled: { borderColor: 'rgba(244,239,231,0.14)' },
  deckStateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#B98561' },
  deckStateLabel: { color: '#C8A380', fontSize: 8, letterSpacing: 1 },
  deckTelemetry: {
    maxWidth: 360, flexDirection: 'row', alignItems: 'stretch', gap: Spacing.three,
    paddingBottom: Spacing.one,
  },
  deckTelemetryCompact: { maxWidth: '100%' },
  deckTelemetryValue: { color: '#F4EFE7', fontSize: 12, fontWeight: '800' },
  deckTelemetryLabel: { color: '#707777', fontSize: 8, letterSpacing: 1 },
  deckTelemetryRule: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(244,239,231,0.15)' },
  latestSignal: { maxWidth: 120 },
  deckScroll: {
    minWidth: '100%',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: 30,
    paddingBottom: 24,
    paddingRight: 96,
  },
  deckScrollCollapsed: { justifyContent: 'center', paddingRight: Spacing.four },
  arcanaCardMotion: { flexShrink: 0 },
  arcanaCard: {
    width: '100%',
    height: '100%',
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#B98561',
    backgroundColor: '#24201C',
    shadowColor: '#000000',
    shadowOpacity: 0.52,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  arcanaInnerFrame: {
    position: 'absolute', left: 7, right: 7, top: 7, bottom: 7,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(232,191,151,0.7)', zIndex: 6,
  },
  bookCover: { position: 'absolute', inset: 0 },
  arcanaPlaceholder: {
    position: 'absolute', inset: 0,
    backgroundColor: '#2A2420',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arcanaSunOuter: {
    width: 128, height: 128, borderRadius: 64, borderWidth: 1,
    borderColor: 'rgba(185,133,97,0.66)', alignItems: 'center', justifyContent: 'center',
  },
  arcanaSunInner: {
    width: 90, height: 90, borderRadius: 45, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,239,231,0.42)', alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '12deg' }],
  },
  arcanaMonogram: {
    color: '#D8B28D', fontFamily: Fonts.serif, fontSize: 42, lineHeight: 48,
    transform: [{ rotate: '-12deg' }],
  },
  placeholderAxisHorizontal: {
    position: 'absolute', left: 18, right: 18, top: '50%', height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(185,133,97,0.3)',
  },
  placeholderAxisVertical: {
    position: 'absolute', top: 18, bottom: 18, left: '50%', width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(185,133,97,0.3)',
  },
  cardVeil: { position: 'absolute', inset: 0, backgroundColor: 'rgba(12,14,14,0.26)' },
  cardTopLine: {
    position: 'absolute', top: 18, left: 18, right: 18, zIndex: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  cardNumeral: { color: '#E2BD97', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  cardStatus: { color: '#E2BD97', fontSize: 8, letterSpacing: 1.1 },
  cardTitlePlate: {
    position: 'absolute', left: 18, right: 18, bottom: 20, zIndex: 8,
    backgroundColor: 'rgba(18,20,20,0.82)', borderTopWidth: 1,
    borderTopColor: 'rgba(226,189,151,0.72)', paddingHorizontal: 12, paddingVertical: 12,
  },
  cardWorld: { color: '#B98561', fontSize: 8, letterSpacing: 1, marginBottom: 5 },
  cardTitle: {
    color: '#F4EFE7', fontFamily: Fonts.serif, fontSize: 21, lineHeight: 27, fontWeight: '700',
  },
  cardFooterRule: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(244,239,231,0.18)', marginVertical: 9 },
  cardInstruction: { color: '#9BA09E', fontSize: 8, letterSpacing: 0.8 },
  newWorldCard: {
    backgroundColor: '#211E1B',
    borderColor: '#8A664B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newWorldSigil: {
    width: 142, height: 142, borderRadius: 71, borderWidth: 1,
    borderColor: 'rgba(185,133,97,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  newWorldSigilInner: {
    width: 92, height: 92, borderRadius: 46, borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,239,231,0.26)', alignItems: 'center', justifyContent: 'center',
  },
  newWorldPlus: { color: '#D8B28D', fontSize: 38, lineHeight: 42 },
  deckFooter: {
    paddingHorizontal: Spacing.four, paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(244,239,231,0.14)',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.four,
  },
  deckFooterCompact: { flexDirection: 'column', alignItems: 'stretch', gap: Spacing.two },
  swipeCue: { flex: 1 },
  swipeCueText: { color: '#707777', fontSize: 8, letterSpacing: 1.2 },
  deckTools: { flexDirection: 'row', gap: Spacing.three },
  deckTool: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(244,239,231,0.22)',
  },
  deckToolIndex: { color: '#B98561', fontSize: 8 },
  deckToolLabel: { color: '#D3CDC5', fontSize: 11 },
  deckToolArrow: { color: '#7D8583', fontSize: 12 },
  pressed: {
    opacity: 0.72,
  },
});
