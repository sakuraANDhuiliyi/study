import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import type { MobileClient } from './client';
import type { LessonFile } from './lesson-model';
import { safeFileName } from './assignment-model';
const directory = () => new Directory(Paths.cache, 'zhixue-lesson-transfers');
export function clearLessonTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {}
}
export async function fetchLessonFile(client: MobileClient, id: string, metadata: LessonFile) {
  const epoch = client.sessionEpoch();
  const bytes = await client.request<Uint8Array>(
    '/mobile/lessons/' + encodeURIComponent(id) + '/files/' + encodeURIComponent(metadata.id),
    undefined,
    'GET',
    { binary: true },
  );
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化，已取消资源下载。');
  if (bytes.byteLength !== metadata.size) throw new Error('资源大小已变化，请刷新课时后重试。');
  const d = new Directory(directory(), randomUUID());
  d.create({ intermediates: true });
  const file = new File(d, safeFileName(metadata.name));
  try {
    file.create();
    file.write(bytes);
  } catch (e) {
    if (d.exists) d.delete();
    throw e;
  }
  return {
    uri: file.uri,
    dispose: () => {
      try {
        if (d.exists) d.delete();
      } catch {}
    },
  };
}
export async function openLessonFile(client: MobileClient, id: string, metadata: LessonFile) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件打开或保存工具。');
  const epoch = client.sessionEpoch();
  const file = await fetchLessonFile(client, id, metadata);
  try {
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
    await Sharing.shareAsync(file.uri, { mimeType: metadata.mime, dialogTitle: '打开或保存课程资料' });
  } finally {
    setTimeout(file.dispose, 5 * 60000);
  }
}
