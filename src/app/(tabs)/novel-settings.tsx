import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelWritingExtensionPanel } from '@/components/novel-settings/NovelWritingExtensionPanel';
import { NovelPromptDefaultsPanel } from '@/components/novel-settings/NovelPromptDefaultsPanel';
import { ThemedView } from '@/components/themed-view';
import { AppPageHeader } from '@/components/ui/AppPageHeader';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export default function NovelSettingsScreen() {
  return (
    <ThemedView decorated style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <AppPageHeader
            title="小说配置"
            eyebrow="STORY / DEFAULTS"
            index="02"
            description="破限词、MOD 与记忆规则。"
            compact
          />

          <NovelWritingExtensionPanel kind="jailbreak" />
          <NovelWritingExtensionPanel kind="mod" />
          <NovelPromptDefaultsPanel />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
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
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.three,
  },
});
