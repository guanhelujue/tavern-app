import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { claimAppOpeningSequence, type OpeningSessionStorage } from '@/components/app-opening-state';
import { subscribeThemeMotionPreview } from '@/components/theme-motion-preview';
import { useTheme } from '@/hooks/use-theme';

const OPENING_BG = '#12100F';
const OPENING_TEXT = '#F1E7D8';

type AppOpeningSequenceProps = {
  enabled?: boolean;
  onReady?: () => Promise<unknown> | void;
};

type OpeningRendererProps = AppOpeningSequenceProps & {
  forcePreview?: boolean;
};

function resolveOpeningSessionStorage(): OpeningSessionStorage | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

  try {
    return window.sessionStorage as OpeningSessionStorage;
  } catch {
    // Some privacy modes expose window but deny access to sessionStorage.
    return undefined;
  }
}

export function AppOpeningSequence(props: AppOpeningSequenceProps) {
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  useEffect(
    () => subscribeThemeMotionPreview(setPreviewRevision),
    [],
  );
  const forcePreview = previewRevision !== null;
  return (
    <ObservatoryOpeningSequence
      key={forcePreview ? previewRevision : 'session'}
      {...props}
      forcePreview={forcePreview}
    />
  );
}

function ObservatoryOpeningSequence({ enabled = true, forcePreview = false, onReady }: OpeningRendererProps) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const frameSize = Math.min(320, Math.max(236, width * 0.68));
  const [shouldPlay] = useState(
    () => enabled && (forcePreview || claimAppOpeningSequence(resolveOpeningSessionStorage())),
  );
  const [visible, setVisible] = useState(shouldPlay);
  const [started, setStarted] = useState(false);
  const [reveal] = useState(() => new Animated.Value(0));
  const [orbit] = useState(() => new Animated.Value(0));
  const [glyph] = useState(() => new Animated.Value(0));
  const [scan] = useState(() => new Animated.Value(0));
  const [exit] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!shouldPlay) {
      void Promise.resolve(onReady?.()).catch(() => undefined);
    }
  }, [onReady, shouldPlay]);

  if (!visible || !shouldPlay) return null;

  async function begin() {
    if (started) return;
    setStarted(true);
    const [, reduceMotion] = await Promise.all([
      Promise.resolve(onReady?.()).catch(() => undefined),
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
    ]);

    if (reduceMotion) {
      Animated.sequence([
        Animated.timing(glyph, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(120),
        Animated.timing(exit, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start(() => setVisible(false));
      return;
    }

    Animated.sequence([
      Animated.parallel([
        Animated.timing(reveal, { toValue: 1, duration: 380, useNativeDriver: true }),
        Animated.timing(glyph, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(orbit, { toValue: 1, duration: 720, useNativeDriver: true }),
        Animated.timing(scan, { toValue: 1, duration: 720, useNativeDriver: true }),
      ]),
      Animated.delay(150),
      Animated.timing(exit, { toValue: 1, duration: 560, useNativeDriver: true }),
    ]).start(() => setVisible(false));
  }

  const contentOpacity = exit.interpolate({
    inputRange: [0, 0.34, 1],
    outputRange: [1, 0, 0],
  });
  const curtainDistance = width / 2 + 24;

  return (
    <View
      onLayout={() => void begin()}
      pointerEvents="auto"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.overlay}>
      <Animated.View
        style={[
          styles.curtain,
          styles.curtainLeft,
          {
            width: width / 2 + 2,
            transform: [{ translateX: exit.interpolate({ inputRange: [0, 1], outputRange: [0, -curtainDistance] }) }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.curtain,
          styles.curtainRight,
          {
            width: width / 2 + 2,
            transform: [{ translateX: exit.interpolate({ inputRange: [0, 1], outputRange: [0, curtainDistance] }) }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.sequence,
          {
            opacity: contentOpacity,
            transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.055] }) }],
          },
        ]}>
        <View style={[styles.cornerMeta, styles.cornerMetaTop]}>
          <Text style={styles.metaText}>ARCHIVE ACCESS / 00—01</Text>
          <View style={[styles.metaRule, { backgroundColor: theme.accent }]} />
        </View>
        <View style={[styles.cornerMeta, styles.cornerMetaBottom]}>
          <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
          <Text style={styles.metaText}>NARRATIVE SYSTEM ONLINE</Text>
        </View>

        <View style={[styles.axis, styles.axisHorizontal, { backgroundColor: `${OPENING_TEXT}24` }]} />
        <View style={[styles.axis, styles.axisVertical, { backgroundColor: `${OPENING_TEXT}24` }]} />

        <View style={[styles.ritualFrame, { width: frameSize, height: frameSize }]}>
          <Animated.View
            style={[
              styles.orbit,
              styles.orbitOuter,
              {
                borderColor: `${theme.accent}8A`,
                opacity: reveal,
                transform: [
                  { rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['-24deg', '296deg'] }) },
                  { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
                ],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.orbit,
              styles.orbitInner,
              {
                borderColor: `${OPENING_TEXT}5C`,
                opacity: reveal,
                transform: [{ rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['35deg', '-205deg'] }) }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.scanLine,
              { backgroundColor: theme.accent, transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [-frameSize * 0.34, frameSize * 0.34] }) }] },
            ]}
          />
          <Animated.View
            style={[
              styles.glyphFrame,
              {
                borderColor: `${OPENING_TEXT}8A`,
                opacity: glyph,
                transform: [
                  { rotate: glyph.interpolate({ inputRange: [0, 1], outputRange: ['45deg', '0deg'] }) },
                  { scale: glyph.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1] }) },
                ],
              },
            ]}>
            <Text style={[styles.glyph, { color: OPENING_TEXT }]}>T</Text>
            <View style={[styles.glyphSignal, { backgroundColor: theme.accent }]} />
          </Animated.View>
          <Animated.View
            style={[
              styles.titleBlock,
              {
                opacity: glyph,
                transform: [{ translateY: glyph.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              },
            ]}>
            <Text style={styles.title}>叙事档案正在解封</Text>
            <Text style={[styles.subtitle, { color: theme.accent }]}>TAVERN / STORY ENGINE</Text>
          </Animated.View>
        </View>

        <View style={[styles.progress, { width: Math.min(260, width * 0.62), backgroundColor: `${OPENING_TEXT}24` }]}>
          <Animated.View
            style={[
              styles.progressValue,
              {
                backgroundColor: theme.accent,
                transform: [{ scaleX: orbit.interpolate({ inputRange: [0, 1], outputRange: [0.06, 1] }) }],
              },
            ]}
          />
        </View>
        <Animated.Text style={[styles.progressText, { opacity: reveal }]}>CALIBRATING MEMORY · WORLD · PERSONA</Animated.Text>

        <View style={[styles.dust, { left: width * 0.12, top: height * 0.22, backgroundColor: theme.accent }]} />
        <View style={[styles.dust, { right: width * 0.16, top: height * 0.31, backgroundColor: OPENING_TEXT }]} />
        <View style={[styles.dust, { left: width * 0.22, bottom: height * 0.19, backgroundColor: OPENING_TEXT }]} />
        <View style={[styles.dust, { right: width * 0.1, bottom: height * 0.24, backgroundColor: theme.accent }]} />
      </Animated.View>
    </View>
  );
}

export function AppOpeningMark() {
  const theme = useTheme();
  return (
    <View style={styles.markContainer}>
      <View style={[styles.markOrbit, { borderColor: theme.accent }]} />
      <View style={[styles.markCore, { backgroundColor: theme.accent }]}>
        <Text style={styles.markText}>T</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10000, elevation: 10000, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  curtain: { position: 'absolute', top: 0, bottom: 0, backgroundColor: OPENING_BG },
  curtainLeft: { left: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#3B3028' },
  curtainRight: { right: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: '#3B3028' },
  sequence: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  cornerMeta: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 9 },
  cornerMetaTop: { left: 24, top: 28 },
  cornerMetaBottom: { right: 24, bottom: 28 },
  metaText: { color: `${OPENING_TEXT}80`, fontSize: 7, lineHeight: 10, fontWeight: '800', letterSpacing: 1.25 },
  metaRule: { width: 28, height: 2 },
  liveDot: { width: 5, height: 5, borderRadius: 3 },
  axis: { position: 'absolute' },
  axisHorizontal: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  axisVertical: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  ritualFrame: { alignItems: 'center', justifyContent: 'center' },
  orbit: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth },
  orbitOuter: { width: '100%', height: '100%', borderRadius: 999, borderTopColor: 'transparent', borderBottomColor: 'transparent' },
  orbitInner: { width: '72%', height: '72%', borderRadius: 999, borderLeftColor: 'transparent', borderBottomColor: 'transparent' },
  scanLine: { position: 'absolute', width: '78%', height: 1, opacity: 0.72 },
  glyphFrame: { width: 92, height: 92, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontFamily: 'serif', fontSize: 54, lineHeight: 62, fontWeight: '500' },
  glyphSignal: { position: 'absolute', width: 22, height: 3, bottom: 12 },
  titleBlock: { position: 'absolute', top: '76%', alignItems: 'center', gap: 5 },
  title: { color: OPENING_TEXT, fontFamily: 'serif', fontSize: 17, lineHeight: 23, fontWeight: '500', letterSpacing: 2.2 },
  subtitle: { fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 1.7 },
  progress: { position: 'absolute', bottom: 82, height: 2, overflow: 'hidden' },
  progressValue: { width: '100%', height: '100%' },
  progressText: { position: 'absolute', bottom: 58, color: `${OPENING_TEXT}6E`, fontSize: 6, lineHeight: 9, fontWeight: '800', letterSpacing: 1.1 },
  dust: { position: 'absolute', width: 2, height: 2, borderRadius: 1, opacity: 0.48 },
  markContainer: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  markOrbit: { position: 'absolute', width: 124, height: 124, borderRadius: 62, borderWidth: 1 },
  markCore: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] },
  markText: { color: OPENING_BG, fontFamily: 'serif', fontSize: 38, fontWeight: '700', transform: [{ rotate: '-45deg' }] },
});
