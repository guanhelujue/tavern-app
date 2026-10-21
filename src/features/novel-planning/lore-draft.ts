import AsyncStorage from '@react-native-async-storage/async-storage';

/** Resume an unfinished new-entry conversation; start another only after it became a formal entry. */
export async function getLorePlanningDraftId(novelId: string, collectionId: string, existingIds: string[]): Promise<string> {
  const key = `novel-planning-active-lore:${encodeURIComponent(novelId)}:${encodeURIComponent(collectionId)}`;
  const previous = await AsyncStorage.getItem(key);
  if (previous && !existingIds.includes(previous)) return previous;
  const next = `planning-lore-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(key, next);
  return next;
}
