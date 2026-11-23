import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import type { MobileClient } from './client';
import { safeFileName } from './assignment-model';
import { messagesApi, type MessageFile } from './messages-model';
const directory = () => new Directory(Paths.cache, 'zhixue-message-transfers');
export function clearMessageTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {
    /* Retry on the next account boundary. */
  }
}
export async function openMessageFile(client: MobileClient, conversationId: string, metadata: MessageFile) {
  const epoch = client.sessionEpoch();
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件打开或保存工具。');
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > 50 * 1024 * 1024)
    throw new Error('附件超过手机端下载上限。');
  const bytes = await messagesApi.file(client, conversationId, metadata.id);
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化，已取消附件下载。');
  if (bytes.byteLength !== metadata.size) throw new Error('附件大小已变化，请刷新后重试。');
  const d = new Directory(directory(), randomUUID()),
    file = new File(d, safeFileName(metadata.name));
  const dispose = () => {
    try {
      if (d.exists) d.delete();
    } catch {}
  };
  try {
    d.create({ intermediates: true });
    file.create();
    file.write(bytes);
  } catch (error) {
    dispose();
    throw error;
  }
  try {
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
    await Sharing.shareAsync(file.uri, { mimeType: metadata.mime, dialogTitle: '打开或保存消息附件' });
  } finally {
    setTimeout(dispose, 5 * 60000);
  }
}
