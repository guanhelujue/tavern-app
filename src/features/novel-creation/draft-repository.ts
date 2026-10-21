import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeCreationSession } from './domain';
import type { CreationDraftPort } from './creation';

const CREATION_DRAFT_KEY = 'novel-creation-v2-draft';

export const asyncStorageCreationDrafts: CreationDraftPort = {
  async load() {
    try {
      const raw = await AsyncStorage.getItem(CREATION_DRAFT_KEY);
      if (!raw) return null;
      return normalizeCreationSession(JSON.parse(raw));
    } catch {
      return null;
    }
  },
  async save(session) {
    await AsyncStorage.setItem(CREATION_DRAFT_KEY, JSON.stringify(session));
  },
  async clear() {
    await AsyncStorage.removeItem(CREATION_DRAFT_KEY);
  },
};
