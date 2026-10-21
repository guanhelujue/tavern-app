import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PROVIDER_KEY_PREFIX = 'tavern.provider.api-key.v1.';
const WEB_PROVIDER_KEY_PREFIX = 'tavern.web.provider.api-key.v1.';
const IMAGE_PROVIDER_SECRET_PREFIX = 'image:';
const pendingWrites = new Map<string, Promise<void>>();

function enqueueSecretWrite(providerId: string, write: () => Promise<void>): Promise<void> {
  const previous = pendingWrites.get(providerId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(write);
  pendingWrites.set(providerId, next);
  const cleanup = () => {
    if (pendingWrites.get(providerId) === next) pendingWrites.delete(providerId);
  };
  void next.then(cleanup, cleanup);
  return next;
}

export type ProviderSecretsSnapshot = {
  providerKeys: Record<string, string>;
  available: boolean;
  warning?: string;
};

function encodeSecretId(id: string) {
  return encodeURIComponent(id.trim()).replace(/%/g, '_');
}

function providerSecretKey(providerId: string) {
  return PROVIDER_KEY_PREFIX + encodeSecretId(providerId);
}

function webProviderSecretKey(providerId: string) {
  return WEB_PROVIDER_KEY_PREFIX + encodeSecretId(providerId);
}

function isWebRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

async function isSecureStoreAvailable() {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function saveProviderApiKey(providerId: string, apiKey: string) {
  const normalizedId = providerId.trim();
  const normalizedKey = apiKey.trim();
  if (!normalizedId) {
    return;
  }
  return enqueueSecretWrite(normalizedId, () => writeProviderApiKey(normalizedId, normalizedKey));
}

async function writeProviderApiKey(normalizedId: string, normalizedKey: string) {
  if (isWebRuntime()) {
    const key = webProviderSecretKey(normalizedId);
    if (normalizedKey) {
      await AsyncStorage.setItem(key, normalizedKey);
    } else {
      await AsyncStorage.removeItem(key);
    }
    return;
  }

  if (!(await isSecureStoreAvailable())) {
    throw new Error('SecureStore 当前不可用；API Key 仅保留在本次会话，不会写入持久化状态。');
  }

  if (!normalizedKey) {
    await SecureStore.deleteItemAsync(providerSecretKey(normalizedId));
    return;
  }

  await SecureStore.setItemAsync(providerSecretKey(normalizedId), normalizedKey);
}

export async function removeProviderApiKey(providerId: string) {
  const normalizedId = providerId.trim();
  if (!normalizedId) {
    return;
  }
  return enqueueSecretWrite(normalizedId, async () => {
    if (isWebRuntime()) {
      await AsyncStorage.removeItem(webProviderSecretKey(normalizedId));
      return;
    }
    if (!(await isSecureStoreAvailable())) return;
    await SecureStore.deleteItemAsync(providerSecretKey(normalizedId));
  });
}

export async function loadProviderSecrets(
  providers: Record<string, { id: string; apiKey?: string }>,
): Promise<ProviderSecretsSnapshot> {
  if (isWebRuntime()) {
    const providerKeys: Record<string, string> = {};
    for (const provider of Object.values(providers)) {
      const id = provider.id.trim();
      if (!id) continue;
      const stored = (await AsyncStorage.getItem(webProviderSecretKey(id)))?.trim();
      const legacy = provider.apiKey?.trim() ?? '';
      if (stored) {
        providerKeys[id] = stored;
      } else if (legacy) {
        await saveProviderApiKey(id, legacy);
        providerKeys[id] = legacy;
      }
    }
    return {
      providerKeys,
      available: true,
      warning: 'Web 端 API Key 保存在当前浏览器的本地存储中；清除站点数据后需要重新填写。',
    };
  }

  if (!(await isSecureStoreAvailable())) {
    return {
      providerKeys: {},
      available: false,
      warning:
        '当前平台无法提供 SecureStore 等级的保护；API Key 只在本次会话内使用，不会写入导出或 Zustand 持久化数据。',
    };
  }

  const providerKeys: Record<string, string> = {};
  for (const provider of Object.values(providers)) {
    const id = provider.id.trim();
    if (!id) {
      continue;
    }
    const existing = await SecureStore.getItemAsync(providerSecretKey(id));
    const legacy = provider.apiKey?.trim() ?? '';
    if (existing?.trim()) {
      providerKeys[id] = existing.trim();
    } else if (legacy) {
      await saveProviderApiKey(id, legacy);
      providerKeys[id] = legacy;
    }
  }

  return {
    providerKeys,
    available: true,
  };
}

/** Image providers use the same secure storage mechanism with a separate namespace. */
export async function saveImageProviderApiKey(providerId: string, apiKey: string) {
  return saveProviderApiKey(`${IMAGE_PROVIDER_SECRET_PREFIX}${providerId}`, apiKey);
}

export async function removeImageProviderApiKey(providerId: string) {
  return removeProviderApiKey(`${IMAGE_PROVIDER_SECRET_PREFIX}${providerId}`);
}

export async function loadImageProviderSecrets(
  providers: Record<string, { id: string; apiKey?: string }>,
): Promise<ProviderSecretsSnapshot> {
  const namespacedProviders = Object.fromEntries(
    Object.values(providers).map((provider) => [
      `${IMAGE_PROVIDER_SECRET_PREFIX}${provider.id}`,
      { ...provider, id: `${IMAGE_PROVIDER_SECRET_PREFIX}${provider.id}` },
    ]),
  );
  const snapshot = await loadProviderSecrets(namespacedProviders);
  return {
    ...snapshot,
    providerKeys: Object.fromEntries(
      Object.entries(snapshot.providerKeys).map(([id, value]) => [
        id.slice(IMAGE_PROVIDER_SECRET_PREFIX.length),
        value,
      ]),
    ),
  };
}
