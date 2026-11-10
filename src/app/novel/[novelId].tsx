import { Redirect, useLocalSearchParams } from 'expo-router';

/** Bookmarks and old conversation links follow the unified workspace route. */
export default function NovelRoute() {
  const params = useLocalSearchParams<{ novelId: string }>();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  return <Redirect href={novelId ? `/novel/workbench/${novelId}` : '/(tabs)/novels'} />;
}
