import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

type AppPageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  index?: string;
  meta?: string;
  actions?: ReactNode;
  compact?: boolean;
};

/** Shared editorial page masthead. Pages keep their own content language below this seam. */
export function AppPageHeader({
  title,
  description,
  eyebrow = 'TAVERN / NARRATIVE SYSTEM',
  index,
  meta,
  actions,
  compact = false,
}: AppPageHeaderProps) {
  const theme = useTheme();
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const [reveal] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!active) return;
      Animated.timing(reveal, {
        toValue: 1,
        duration: reduceMotion || !motionEnabled ? 0 : 360,
        useNativeDriver: true,
      }).start();
    });
    return () => {
      active = false;
    };
  }, [motionEnabled, reveal]);

  return (
    <Animated.View
      style={[
        styles.container,
        compact && styles.compactContainer,
        { borderBottomColor: theme.outlineVariant },
        {
          opacity: reveal,
          transform: [
            {
              translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
            },
          ],
        },
      ]}>
      {index ? (
        <ThemedText
          pointerEvents="none"
          style={[
            styles.ghostIndex,
            { color: theme.primaryContainer },
          ]}>
          {index}
        </ThemedText>
      ) : null}

      <View style={styles.signalRow}>
        <View
          style={[
            styles.signal,
            { backgroundColor: theme.primary },
          ]}
        />
        <ThemedText type="code" themeColor="accent" style={styles.eyebrow}>
          {eyebrow}
        </ThemedText>
        {meta ? (
          <>
            <View style={[styles.metaRule, { backgroundColor: theme.outlineVariant }]} />
            <ThemedText type="code" themeColor="textMuted" numberOfLines={1}>
              {meta}
            </ThemedText>
          </>
        ) : null}
      </View>

      <View style={styles.headingRow}>
        <View style={styles.copy}>
          <ThemedText
            type="title"
            style={[styles.title, compact && styles.compactTitle]}>
            {title}
          </ThemedText>
          {description ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
              {description}
            </ThemedText>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 132,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    overflow: 'hidden',
    position: 'relative',
  },
  compactContainer: {
    minHeight: 108,
    paddingBottom: Spacing.three,
  },
  signalRow: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingRight: 72,
  },
  signal: {
    width: 28,
    height: 3,
  },
  eyebrow: {
    fontWeight: '800',
    letterSpacing: 1.25,
  },
  metaRule: {
    width: 20,
    height: StyleSheet.hairlineWidth,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.three,
  },
  copy: {
    flex: 1,
    gap: Spacing.one,
  },
  title: {
    fontFamily: Fonts.serif,
    fontSize: 38,
    lineHeight: 46,
    letterSpacing: -1.3,
  },
  compactTitle: {
    fontSize: 32,
    lineHeight: 40,
  },
  description: {
    maxWidth: 620,
    lineHeight: 22,
  },
  actions: {
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  ghostIndex: {
    position: 'absolute',
    right: -5,
    top: -28,
    fontFamily: Fonts.serif,
    fontSize: 112,
    lineHeight: 126,
    fontWeight: '400',
    opacity: 0.64,
  },
});
