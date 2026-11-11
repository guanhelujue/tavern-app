import { type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type WorkbenchPanelProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
};

/** Consistent card container for the novel continuation workbench panels. */
export function WorkbenchPanel({ title, subtitle, children, action }: WorkbenchPanelProps) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
        Platform.OS !== 'web' && { backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0, padding: 0, gap: 20 },
      ]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <ThemedText type="smallBold" style={[styles.title, Platform.OS !== 'web' && { fontSize: 20, lineHeight: 28 }]}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="small" themeColor="textMuted">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: 0.2,
  },
  action: {
    flexShrink: 0,
  },
});
