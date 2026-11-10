import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/** Decorative visual world shared by every screen; never participates in layout or touch. */
export function ThemeBackdrop({ contained = false }: { contained?: boolean }) {
  const scheme = useColorScheme();
  const theme = useTheme();
  const opacity = contained
    ? scheme === 'dark' ? 0.56 : 0.42
    : scheme === 'dark' ? 0.34 : 0.24;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      style={[
        styles.layer,
        contained ? styles.containedLayer : styles.globalLayer,
        { opacity },
      ]}>
      <View style={[styles.axis, styles.axisHorizontal, { backgroundColor: theme.outlineVariant }]} />
      <View style={[styles.axis, styles.axisVertical, { backgroundColor: theme.outlineVariant }]} />
      <View style={[styles.orbit, styles.orbitOuter, { borderColor: theme.outlineVariant }]} />
      <View style={[styles.orbit, styles.orbitInner, { borderColor: theme.primary }]} />
      <View style={[styles.registrationMark, { backgroundColor: theme.primary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  globalLayer: { zIndex: 20 },
  containedLayer: { zIndex: 0 },
  axis: {
    position: 'absolute',
    opacity: 0.24,
  },
  axisHorizontal: {
    top: 92,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  axisVertical: {
    top: 0,
    bottom: 0,
    right: '18%',
    width: StyleSheet.hairlineWidth,
  },
  orbit: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    opacity: 0.22,
  },
  orbitOuter: {
    width: 260,
    height: 260,
    right: -126,
    top: 18,
  },
  orbitInner: {
    width: 164,
    height: 164,
    right: -74,
    top: 66,
    borderLeftColor: 'transparent',
    transform: [{ rotate: '-18deg' }],
  },
  registrationMark: {
    position: 'absolute',
    right: '18%',
    top: 89,
    width: 7,
    height: 7,
    borderRadius: 4,
    opacity: 0.5,
    transform: [{ translateX: 3 }],
  },
});
