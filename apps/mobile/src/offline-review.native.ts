import {
  AESEncryptionKey,
  AESSealedData,
  aesEncryptAsync,
  aesDecryptAsync,
  CryptoDigestAlgorithm,
  digestStringAsync,
  randomUUID,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import type { MobileUser } from './client';
import { OfflineReviewVault, offlineReviewLimits, personalOfflineIdentity } from './offline-review-model';
const stores = new Map<string, OfflineReviewVault>();
const dir = () => new Directory(Paths.document, 'personal-offline-review-v1');
export async function deviceLearningScope(
  origin: string,
  user: Pick<MobileUser, 'id' | 'organizationId' | 'role' | 'accountMode'>,
) {
  return digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify([origin, user.organizationId, user.id, user.role, user.accountMode]),
  );
}
export async function personalOfflineVault(origin: string, user: MobileUser) {
  personalOfflineIdentity(origin, user);
  return offlineVaultForScope(await deviceLearningScope(origin, user));
}
export async function offlineVaultForScope(scope: string) {
  const old = stores.get(scope);
  if (old && !old.isClosed) return old;
  if (old) await old.destroy();
  const file = () => new File(dir(), scope + '.enc'),
    keyName = 'offline-review-v1-' + scope,
    options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const vault = new OfflineReviewVault(scope, {
    readKey: () => SecureStore.getItemAsync(keyName),
    writeKey: (value) => SecureStore.setItemAsync(keyName, value, options),
    removeKey: () => SecureStore.deleteItemAsync(keyName),
    createKey: async () => (await AESEncryptionKey.generate()).encoded('hex'),
    readBlob: async () => {
      const current = file();
      if (!current.exists) return null;
      if (current.size > offlineReviewLimits.bytes) throw new Error('本机缓存过大，请清除');
      return current.bytes();
    },
    writeBlob: async (bytes) => {
      const directory = dir();
      directory.create({ idempotent: true, intermediates: true });
      const staging = new File(directory, scope + '.' + randomUUID() + '.tmp');
      try {
        staging.create();
        staging.write(bytes);
        await staging.move(file(), { overwrite: true });
      } finally {
        if (staging.exists && staging.uri !== file().uri) staging.delete();
      }
    },
    removeBlob: async () => {
      const current = file();
      if (current.exists) current.delete();
    },
    encrypt: async (text, key, aad) =>
      (
        await aesEncryptAsync(new TextEncoder().encode(text), await AESEncryptionKey.import(key, 'hex'), {
          additionalData: new TextEncoder().encode(aad),
        })
      ).combined(),
    decrypt: async (bytes, key, aad) =>
      new TextDecoder().decode(
        await aesDecryptAsync(AESSealedData.fromCombined(bytes), await AESEncryptionKey.import(key, 'hex'), {
          additionalData: new TextEncoder().encode(aad),
        }),
      ),
  });
  stores.set(scope, vault);
  return vault;
}
export async function clearOfflineIdentity(scope: string) {
  const store = stores.get(scope);
  if (store) await store.destroy();
  else {
    const results = await Promise.allSettled([
      SecureStore.deleteItemAsync('offline-review-v1-' + scope),
      Promise.resolve().then(() => {
        const file = new File(dir(), scope + '.enc');
        if (file.exists) file.delete();
      }),
    ]);
    if (results.some((result) => result.status === 'rejected')) throw new Error('本机离线清理未完成');
  }
  stores.delete(scope);
}
