import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DesktopChapterWorkspace } from '@/components/desktop/DesktopChapterWorkspace';
import { NovelAvailabilityState } from '@/components/novel-continue/NovelAvailabilityState';
import { NovelMobileNavigation } from '@/components/novel-continue/NovelMobileNavigation';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

export default function NovelChaptersScreen() {
  const desktop = useDesktopLayout();
  const theme = useTheme();
  const params = useLocalSearchParams<{ novelId: string; inspirationId?: string; chapterId?: string; outlineIndex?: string }>();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const inspirationId = Array.isArray(params.inspirationId) ? params.inspirationId[0] : params.inspirationId;
  const chapterId = Array.isArray(params.chapterId) ? params.chapterId[0] : params.chapterId;
  const outlineIndex = Number(Array.isArray(params.outlineIndex) ? params.outlineIndex[0] : params.outlineIndex);
  const novel = useTavernStore((state) => state.novels.find((item) => item.id === novelId));
  useEffect(() => {
    if (novel?.isDraft) useTavernStore.getState().updateNovel(novel.id, { isDraft: false, createStep: 3 });
  }, [novel?.id, novel?.isDraft]);
  if (!novelId) return null;
  if (!novel) return <NovelAvailabilityState />;
  return <SafeAreaView edges={desktop ? [] : ['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
    {!desktop && <NovelMobileNavigation novelId={novelId} />}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <DesktopChapterWorkspace key={`${novelId}:${chapterId ?? ''}:${inspirationId ?? ''}:${outlineIndex || ''}`} novelId={novelId} chapterId={chapterId} inspirationId={inspirationId} outlineIndex={Number.isInteger(outlineIndex) && outlineIndex > 0 ? outlineIndex : undefined} />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
