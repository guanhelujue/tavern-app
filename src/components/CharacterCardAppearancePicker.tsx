import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CharacterCardAppearance } from '@/constants/character-card-appearances';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

type CharacterCardAppearancePickerProps = {
  selectedId: string;
  onSelect: (appearance: CharacterCardAppearance) => void;
  appearances: readonly CharacterCardAppearance[];
  emptyHint?: string;
};

type AppearanceOptionProps = {
  compact: boolean;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  appearance: CharacterCardAppearance;
};

function AppearanceOptionCard({ compact, index, isSelected, onSelect, appearance }: AppearanceOptionProps) {
  const theme = useTheme();
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const [entrance] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));
  const [interaction] = useState(() => new Animated.Value(0));
  const isNocturne = appearance.id === 'character-card-nocturne';
  const palette = isNocturne
    ? { surface: '#131210', raised: '#1b1916', text: '#eee6d8', muted: '#9c9285', accent: '#c9aa78' }
    : { surface: '#f3eee4', raised: '#e8dfd0', text: '#201e1b', muted: '#756c60', accent: '#77372f' };

  useEffect(() => {
    entrance.stopAnimation();
    if (!motionEnabled) {
      entrance.setValue(1);
      return;
    }
    entrance.setValue(0);
    Animated.spring(entrance, {
      toValue: 1,
      delay: index * 90,
      damping: 17,
      stiffness: 115,
      mass: 0.82,
      useNativeDriver: true,
    }).start();
  }, [entrance, index, motionEnabled]);

  function animateInteraction(toValue: number) {
    if (!motionEnabled) {
      interaction.setValue(0);
      return;
    }
    Animated.spring(interaction, {
      toValue,
      damping: 18,
      stiffness: 220,
      mass: 0.58,
      useNativeDriver: true,
    }).start();
  }

  return (
    <Animated.View
      style={[
        styles.cardMotion,
        compact && styles.cardMotionCompact,
        {
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
            { translateY: interaction.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
            { scale: interaction.interpolate({ inputRange: [0, 1], outputRange: [1, 1.012] }) },
          ],
        },
      ]}>
      <Pressable
        onPress={onSelect}
        onPressIn={() => animateInteraction(0.45)}
        onPressOut={() => animateInteraction(0)}
        onHoverIn={() => animateInteraction(1)}
        onHoverOut={() => animateInteraction(0)}
        style={({ pressed }) => [
          styles.cardShell,
          {
            borderColor: isSelected ? palette.accent : theme.border,
            backgroundColor: palette.raised,
          },
          isSelected && styles.cardSelected,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={`选用人设卡面：${appearance.name}`}>
        <View
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: isSelected ? palette.accent : palette.muted },
          ]}>
          <View pointerEvents="none" style={[styles.previewOrbit, { borderColor: palette.accent }]} />
          <ThemedText pointerEvents="none" type="title" style={[styles.ghostNumber, { color: palette.accent }]}>
            0{index + 1}
          </ThemedText>
          <View style={styles.cardTopline}>
            <ThemedText type="code" style={{ color: palette.accent }}>
              {isNocturne ? 'NOCTURNE / 02' : 'COLLECTION / 01'}
            </ThemedText>
            <View style={[styles.selectionMark, { borderColor: palette.accent }]}>
              {isSelected ? <View style={[styles.selectionDot, { backgroundColor: palette.accent }]} /> : null}
            </View>
          </View>
          <View style={styles.previewComposition} pointerEvents="none">
            <View style={[styles.previewRail, { backgroundColor: palette.accent }]} />
            <View style={styles.previewLines}>
              <View style={[styles.previewLineHero, { backgroundColor: palette.text }]} />
              <View style={[styles.previewLine, { backgroundColor: palette.muted }]} />
              <View style={[styles.previewLineShort, { backgroundColor: palette.muted }]} />
            </View>
          </View>
          <ThemedText type="subtitle" style={{ color: palette.text }}>
            {appearance.name}
          </ThemedText>
          <ThemedText type="small" style={{ color: palette.muted }}>
            {isNocturne
              ? '黑曜底色与香槟金细线，适合悬疑、都市与成熟叙事。'
              : '棉纸质感与酒红索引，适合文学、古典与日常叙事。'}
          </ThemedText>
          <View style={styles.paletteRow}>
            <View style={[styles.paletteLong, { backgroundColor: palette.accent }]} />
            <View style={[styles.paletteShort, { backgroundColor: palette.text }]} />
            <ThemedText type="code" style={[styles.selectLabel, { color: palette.accent }]}>
              {isSelected ? 'ACTIVE' : 'SELECT ↗'}
            </ThemedText>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function CharacterCardAppearancePicker({
  selectedId,
  onSelect,
  appearances,
  emptyHint = '暂无可用卡面款式。',
}: CharacterCardAppearancePickerProps) {
  const { width } = useWindowDimensions();
  const compact = width < 620;

  if (appearances.length === 0) {
    return (
      <ThemedText type="small" themeColor="textMuted">
        {emptyHint}
      </ThemedText>
    );
  }

  return (
    <View style={styles.cardGrid}>
      {appearances.map((appearance, index) => {
        const isSelected = selectedId === appearance.id;

        return (
          <AppearanceOptionCard
            key={appearance.id}
            compact={compact}
            index={index}
            isSelected={isSelected}
            onSelect={() => onSelect(appearance)}
            appearance={appearance}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  cardMotion: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 0,
  },
  cardMotionCompact: {
    flexBasis: '100%',
  },
  cardShell: {
    borderWidth: 1,
    padding: 5,
  },
  card: {
    minHeight: 244,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardSelected: {
    borderWidth: 2,
  },
  cardTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectionMark: {
    width: 18,
    height: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  selectionDot: {
    width: 8,
    height: 8,
  },
  ghostNumber: {
    position: 'absolute',
    right: -5,
    top: 24,
    fontFamily: 'serif',
    fontSize: 86,
    lineHeight: 94,
    opacity: 0.09,
  },
  previewOrbit: {
    position: 'absolute',
    right: -36,
    top: -44,
    width: 116,
    height: 116,
    borderRadius: 58,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.38,
  },
  previewComposition: {
    flexDirection: 'row',
    gap: 12,
    height: 58,
    marginTop: 4,
    paddingVertical: 7,
  },
  previewRail: {
    width: 5,
  },
  previewLines: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  previewLineHero: {
    width: '72%',
    height: 7,
  },
  previewLine: {
    width: '88%',
    height: 2,
    opacity: 0.54,
  },
  previewLineShort: {
    width: '48%',
    height: 2,
    opacity: 0.42,
  },
  paletteRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 'auto',
  },
  paletteLong: {
    height: 3,
    flex: 1,
  },
  paletteShort: {
    height: 3,
    width: 28,
  },
  selectLabel: {
    marginLeft: 4,
  },
  pressed: {
    opacity: 0.75,
  },
});
