import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NovelWorkbench } from '@/components/novel-continue/NovelWorkbench';

export default function NovelWorkbenchScreen() {
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const autoAnalyze = Array.isArray(params.autoAnalyze) ? params.autoAnalyze[0] : params.autoAnalyze;

  if (!novelId) {
    return null;
  }

  if (focus === 'outline') {
    return <Redirect href={`/novel/world-outline/${novelId}`} />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <NovelWorkbench
        novelId={novelId}
        initialTab={focus === 'analysis' || focus === 'outline' ? focus : 'chapters'}
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
