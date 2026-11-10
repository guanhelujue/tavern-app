import { Redirect, useLocalSearchParams } from 'expo-router';

import CreateNovelScreen from '@/features/novel-creation/CreateNovelScreen';

/** Keep the current workspace creation screen; old shelf drafts open in the workspace. */
export default function NovelCreateRoute() {
  const params = useLocalSearchParams<{ draftId?: string }>();
  const draftId = Array.isArray(params.draftId) ? params.draftId[0] : params.draftId;
  return draftId ? <Redirect href={`/novel/workbench/${draftId}`} /> : <CreateNovelScreen />;
}
