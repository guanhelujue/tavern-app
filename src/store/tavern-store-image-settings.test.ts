import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeImageGenerationSettings } from '@/constants/image-models';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), removeItem: vi.fn(async () => undefined) } }));
vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default }, AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) }, InteractionManager: { runAfterInteractions: (task: () => void) => task() }, NativeModules: {}, Alert: { alert: vi.fn() }, Linking: { openURL: vi.fn() }, Dimensions: { get: vi.fn(() => ({ width: 1200, height: 800 })) }, StyleSheet: { create: (value: unknown) => value } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => false), shareAsync: vi.fn() }));
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { UTF8: 'utf8' }, cacheDirectory: null, documentDirectory: null }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: vi.fn(), MediaTypeOptions: {} }));
vi.mock('expo-media-library', () => ({ Asset: {}, requestPermissionsAsync: vi.fn() }));
vi.mock('@/db/migration-coordinator', () => ({ runMigrationCoordinator: vi.fn(async () => ({ status: 'web-fallback' })) }));
vi.mock('expo-sqlite', () => ({ openDatabaseSync: vi.fn(), openDatabaseAsync: vi.fn() }));

describe('image provider actions', () => {
  let useTavernStore: any;
  let initial: any;
  beforeEach(async () => {
    ({ useTavernStore } = await import('./tavern-store'));
    initial = useTavernStore.getState().imageGenerationSettings;
    useTavernStore.setState({ imageGenerationSettings: normalizeImageGenerationSettings() });
  });
  afterEach(() => useTavernStore.setState({ imageGenerationSettings: initial }));

  it('adds and selects a remote provider without losing it during normalization', () => {
    const store = useTavernStore.getState();
    const id = store.addImageProvider({ name: '图像反代', protocol: 'openai-compatible', auth: 'bearer', baseUrl: 'http://proxy.test/v1', modelId: 'image-model' });
    store.setImageProviderApiKey(id, 'test-image-key');
    store.updateImageGenerationSettings({ providerId: id });
    const provider = useTavernStore.getState().imageGenerationSettings.providers[id];
    expect(useTavernStore.getState().imageGenerationSettings.providerId).toBe(id);
    expect(provider).toMatchObject({ protocol: 'openai-compatible', auth: 'bearer', baseUrl: 'http://proxy.test/v1', modelId: 'image-model', apiKey: 'test-image-key' });
  });

  it('keeps the remaining remote provider after deleting the local provider', () => {
    const store = useTavernStore.getState();
    const remoteId = store.addImageProvider({ name: '图像反代', protocol: 'openai-compatible', auth: 'bearer', baseUrl: 'http://proxy.test/v1', modelId: 'image-model' });
    store.updateImageGenerationSettings({ providerId: remoteId });
    store.removeImageProvider('comfyui');
    const settings = useTavernStore.getState().imageGenerationSettings;
    expect(settings.providerId).toBe(remoteId);
    expect(settings.providers[remoteId]).toMatchObject({ protocol: 'openai-compatible', auth: 'bearer' });
    store.removeImageProvider(remoteId);
    expect(useTavernStore.getState().imageGenerationSettings).toEqual({ providerId: '', providers: {} });
  });
});
