import { Redirect, useLocalSearchParams } from 'expo-router';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelWorkbench, type WorkbenchTab } from '@/components/novel-continue/NovelWorkbench';

const WORKBENCH_TABS: WorkbenchTab[] = ['chapters', 'tools', 'analysis', 'forecast', 'knowledge', 'consistency', 'settings', 'context'];

export default function NovelWorkbenchScreen() {
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const autoAnalyze = Array.isArray(params.autoAnalyze) ? params.autoAnalyze[0] : params.autoAnalyze;

  if (!novelId) {
    return null;
  }

  if (Platform.OS === 'web') {
    if (focus === 'settings') return <Redirect href={`/novel/edit/${novelId}`} />;
    if (focus === 'consistency') return <Redirect href={`/novel/chapters/${novelId}`} />;
    if (focus === 'forecast') return <Redirect href={`/novel/world-outline/${novelId}`} />;
  }

  if (focus === 'outline') {
    return <Redirect href={`/novel/world-outline/${novelId}`} />;
  }

  if ((!focus || focus === 'chapters') && autoAnalyze !== '1') {
    return <Redirect href={`/novel/chapters/${novelId}`} />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NovelWorkbench
        novelId={novelId}
        initialTab={WORKBENCH_TABS.includes(focus as WorkbenchTab) ? focus as WorkbenchTab : 'chapters'}
        autoAnalyze={autoAnalyze === '1'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
});
