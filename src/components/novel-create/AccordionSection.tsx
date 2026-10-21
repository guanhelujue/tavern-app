import { useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

type AccordionSectionProps = {
  title: string;
  required?: boolean;
  defaultOpen?: boolean;
  variant?: 'default' | 'settings';
  sectionNumber?: string;
  description?: string;
  children: ReactNode;
};

export function AccordionSection({
  title,
  required,
  defaultOpen = false,
  variant = 'default',
  sectionNumber,
  description,
  children,
}: AccordionSectionProps) {
  const theme = useTheme();
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const [open, setOpen] = useState(defaultOpen);
  const [reveal] = useState(() => new Animated.Value(defaultOpen ? 1 : 0));
  const isSettings = variant === 'settings';

  function toggleOpen() {
    if (!isSettings) {
      setOpen((value) => !value);
      return;
    }

    if (!motionEnabled) {
      const nextOpen = !open;
      reveal.setValue(nextOpen ? 1 : 0);
      setOpen(nextOpen);
      return;
    }

    if (open) {
      Animated.timing(reveal, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }).start(() => setOpen(false));
      return;
    }

    setOpen(true);
    reveal.setValue(0);
    requestAnimationFrame(() => {
      Animated.spring(reveal, {
        toValue: 1,
        damping: 18,
        stiffness: 180,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    });
  }

  return (
    <ThemedView
      type="surface"
      style={[
        styles.card,
        isSettings && styles.settingsCard,
        {
          borderColor: open && isSettings ? theme.accent : theme.border,
          backgroundColor: isSettings
            ? open
              ? theme.backgroundElement
              : theme.surface
            : theme.surface,
        },
      ]}>
      {isSettings ? (
        <View
          pointerEvents="none"
          style={[
            styles.settingsRail,
            { backgroundColor: open ? theme.accent : theme.outlineVariant },
          ]}
        />
      ) : null}
      <Pressable
        onPress={toggleOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          styles.header,
          isSettings && styles.settingsHeader,
          pressed && { opacity: 0.75 },
        ]}>
        {isSettings && sectionNumber ? (
          <View style={[styles.sectionNumber, { borderColor: theme.border }]}>
            <ThemedText type="code" themeColor={open ? 'accent' : 'textMuted'}>
              {sectionNumber}
            </ThemedText>
          </View>
        ) : null}
        <View style={[styles.titleRow, isSettings && styles.settingsTitleRow]}>
          <View style={isSettings ? styles.settingsCopy : undefined}>
            <View style={styles.titleLine}>
              <ThemedText
                type={isSettings ? 'default' : 'smallBold'}
                style={isSettings ? styles.settingsTitle : undefined}>
                {title}
              </ThemedText>
              {required ? <ThemedText style={styles.required}>*</ThemedText> : null}
            </View>
            {isSettings && description ? (
              <ThemedText type="small" themeColor="textMuted" numberOfLines={2}>
                {description}
              </ThemedText>
            ) : null}
          </View>
        </View>
        <View
          style={[
            styles.disclosure,
            isSettings && { borderColor: theme.border },
            open && isSettings && { backgroundColor: theme.accentMuted },
          ]}>
          <ThemedText themeColor={open ? 'accent' : 'textMuted'}>
            {isSettings ? (open ? '−' : '+') : open ? '∧' : '∨'}
          </ThemedText>
        </View>
      </Pressable>
      {open && isSettings ? (
        <Animated.View
          style={[
            styles.body,
            isSettings && styles.settingsBody,
            {
              opacity: reveal,
              transform: [
                {
                  translateY: reveal.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-6, 0],
                  }),
                },
              ],
            },
          ]}>
          {children}
        </Animated.View>
      ) : open ? (
        <View style={styles.body}>{children}</View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  settingsCard: {
    borderRadius: 12,
    position: 'relative',
  },
  settingsRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  header: {
    minHeight: 52,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsHeader: {
    minHeight: 76,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    gap: Spacing.three,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  settingsTitleRow: {
    flex: 1,
  },
  settingsCopy: {
    flex: 1,
    gap: 3,
  },
  settingsTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sectionNumber: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclosure: {
    width: 32,
    height: 32,
    borderWidth: 0,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  required: {
    color: '#c45c3a',
    fontWeight: '700',
  },
  body: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  settingsBody: {
    paddingTop: Spacing.one,
    paddingLeft: Spacing.four,
    paddingRight: Spacing.four,
    paddingBottom: Spacing.four,
  },
});
