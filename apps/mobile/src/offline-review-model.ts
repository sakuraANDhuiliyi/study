import type { MobileUser } from './client';
import type { PersonalNote } from './personal-learning-model';
export const offlineReviewLimits = { items: 20, bytes: 1024 * 1024 } as const;
export type OfflineReviewNote = Pick<
  PersonalNote,
  'id' | 'title' | 'category' | 'body' | 'revision' | 'updatedAt'
> & { savedAt: string };
export type OfflineArchive = { version: 1; scope: string; items: OfflineReviewNote[] };
export function personalOfflineIdentity(
  origin: string,
  user: Pick<MobileUser, 'id' | 'organizationId' | 'role' | 'accountMode'>,
) {
  if (user.accountMode !== 'PERSONAL' || user.role !== 'STUDENT')
    throw new Error('离线待复习仅保存个人空间本人创作的独立笔记');
  return JSON.stringify([origin, user.organizationId, user.id, user.role, user.accountMode]);
}
export function offlineReviewNote(value: unknown): OfflineReviewNote {
  const row = value as Partial<OfflineReviewNote> | null;
  if (
    !row ||
    typeof row.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) ||
    typeof row.title !== 'string' ||
    !row.title.trim() ||
    row.title.length > 120 ||
    typeof row.body !== 'string' ||
    !row.body.trim() ||
    row.body.length > 10000 ||
    (row.category !== null && (typeof row.category !== 'string' || row.category.length > 60)) ||
    !Number.isSafeInteger(row.revision) ||
    row.revision! < 1 ||
    typeof row.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.updatedAt)) ||
    typeof row.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.savedAt)) ||
    [row.title, row.body, row.category || ''].some((value) => value.includes('\0'))
  )
    throw new Error('本机笔记内容无效，请重新在线保存');
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    body: row.body,
    revision: row.revision!,
    updatedAt: row.updatedAt,
    savedAt: row.savedAt,
  };
}
export function offlineArchive(value: unknown, scope: string): OfflineArchive {
  const archive = value as Partial<OfflineArchive> | null;
  if (
    !archive ||
    archive.version !== 1 ||
    archive.scope !== scope ||
    !Array.isArray(archive.items) ||
    archive.items.length > offlineReviewLimits.items
  )
    throw new Error('本机复习空间不匹配或损坏');
  const items = archive.items.map(offlineReviewNote);
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('本机笔记索引无效');
  return { version: 1, scope, items };
}
export interface OfflineVaultPort {
  readKey(): Promise<string | null>;
  writeKey(value: string): Promise<void>;
  removeKey(): Promise<void>;
  createKey(): Promise<string>;
  readBlob(): Promise<Uint8Array | null>;
  writeBlob(value: Uint8Array): Promise<void>;
  removeBlob(): Promise<void>;
  encrypt(plaintext: string, key: string, aad: string): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array, key: string, aad: string): Promise<string>;
}
/** Serializes local mutations and queues identity cleanup after any in-flight encryption/write. */
export class OfflineReviewVault {
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing: Promise<void> | null = null;
  constructor(
    readonly scope: string,
    private port: OfflineVaultPort,
  ) {
    if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('本机空间标识无效');
  }
  get isClosed() {
    return this.closed;
  }
  private active() {
    if (this.closed) throw new Error('登录身份已变化，本机复习已锁定');
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue
      .catch(() => undefined)
      .then(async () => {
        this.active();
        return work();
      });
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async read(): Promise<OfflineArchive> {
    const [key, blob] = await Promise.all([this.port.readKey(), this.port.readBlob()]);
    this.active();
    if (!key || !blob) return { version: 1, scope: this.scope, items: [] };
    if (blob.byteLength > offlineReviewLimits.bytes) throw new Error('本机缓存过大，请清除后重新保存');
    const text = await this.port.decrypt(blob, key, 'offline-review-v1:' + this.scope);
    this.active();
    return offlineArchive(JSON.parse(text), this.scope);
  }
  private async write(archive: OfflineArchive) {
    let key = await this.port.readKey();
    this.active();
    if (!key) {
      key = await this.port.createKey();
      this.active();
      await this.port.writeKey(key);
      this.active();
    }
    const blob = await this.port.encrypt(JSON.stringify(archive), key, 'offline-review-v1:' + this.scope);
    this.active();
    if (blob.byteLength > offlineReviewLimits.bytes) throw new Error('本机复习内容超过容量限制');
    await this.port.writeBlob(blob);
    this.active();
  }
  list() {
    return this.serial(async () => (await this.read()).items);
  }
  put(value: OfflineReviewNote) {
    const note = offlineReviewNote(value);
    return this.serial(async () => {
      const archive = await this.read();
      if (
        !archive.items.some((item) => item.id === note.id) &&
        archive.items.length >= offlineReviewLimits.items
      )
        throw new Error('最多保存20条本机笔记，请先移除旧内容');
      archive.items = [note, ...archive.items.filter((item) => item.id !== note.id)];
      await this.write(archive);
      return archive.items;
    });
  }
  remove(id: string) {
    return this.serial(async () => {
      const archive = await this.read();
      archive.items = archive.items.filter((item) => item.id !== id);
      await this.write(archive);
      return archive.items;
    });
  }
  private async erase() {
    const results = await Promise.allSettled([this.port.removeKey(), this.port.removeBlob()]);
    if (results.some((result) => result.status === 'rejected'))
      throw new Error('部分本机数据未能清除，请重试清理');
  }
  clear() {
    return this.serial(() => this.erase());
  }
  destroy() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.queue.catch(() => undefined).then(() => this.erase());
    return this.closing;
  }
}
export function reminderIdentifier(scope: string, kind: 'once' | 'daily') {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('提醒空间无效');
  return 'study-local-' + scope + '-' + kind;
}
export function reminderTime(hour: unknown, minute: unknown) {
  if (
    typeof hour !== 'number' ||
    typeof minute !== 'number' ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    throw new Error('请填写有效的小时（0–23）和分钟（0–59）');
  return { hour, minute };
}
export const reminderContent = {
  title: '知学 · 学习提醒',
  body: '留一点时间复习自己的笔记，或开始一次专注学习。',
};
