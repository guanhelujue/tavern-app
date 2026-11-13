import { KeyboardAwareScrollView as ScrollView } from '@/components/ui/KeyboardAwareScrollView';
import { Platform, StyleSheet } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelWritingExtensionPanel } from '@/components/novel-settings/NovelWritingExtensionPanel';
import { NovelPromptDefaultsPanel } from '@/components/novel-settings/NovelPromptDefaultsPanel';
import { ThemedView } from '@/components/themed-view';
import { MobilePageIntro, MobileSegmentedTabs, mobileStyles } from '@/components/mobile/MobileUI';
import { AppPageHeader } from '@/components/ui/AppPageHeader';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export default function NovelSettingsScreen() {
  const [mobileTab, setMobileTab] = useState<'prompt' | 'mod' | 'memory'>('prompt');
  return (
    <ThemedView decorated={Platform.OS === 'web'} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView key={Platform.OS === 'web' ? 'all' : mobileTab} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, Platform.OS !== 'web' && mobileStyles.content]}>
          {Platform.OS === 'web' ? <AppPageHeader
            title="小说配置"
            eyebrow="STORY / DEFAULTS"
            index="02"
            description="破限词、MOD 与记忆规则。"
            compact
          /> : <MobilePageIntro title="小说配置" subtitle="让写作更贴合你的习惯" />}

          {Platform.OS !== 'web' ? (
            <>
              <MobileSegmentedTabs value={mobileTab} onChange={setMobileTab} items={[{ value: 'prompt', label: '写作扩展' }, { value: 'mod', label: 'MOD' }, { value: 'memory', label: '记忆规则' }]} />
              {mobileTab === 'prompt' ? <NovelWritingExtensionPanel kind="jailbreak" /> : null}
              {mobileTab === 'mod' ? <NovelWritingExtensionPanel kind="mod" /> : null}
              {mobileTab === 'memory' ? <NovelPromptDefaultsPanel /> : null}
            </>
          ) : (
            <>
              <NovelWritingExtensionPanel kind="jailbreak" />
              <NovelWritingExtensionPanel kind="mod" />
              <NovelPromptDefaultsPanel />
            </>
          )}
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
  mobileTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  mobileTab: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
});
