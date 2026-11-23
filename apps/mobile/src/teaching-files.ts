import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
const directory = () => new Directory(Paths.cache, 'zhixue-teaching-transfers');
export function clearTeachingTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {}
}
export async function shareTeachingFile(
  client: MobileClient,
  path: string,
  alive: () => boolean,
  title = '保存或分享教学学习统计',
) {
  const epoch = client.sessionEpoch(),
    valid = () => alive() && client.ownsSession(epoch);
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件保存工具');
  if (!valid()) throw new Error('登录身份已变化');
  const output = await client.download(path, { maxBytes: 50 * 1024 * 1024 });
  if (!valid()) throw new Error('页面或登录身份已变化，已取消文件打开');
  const d = new Directory(directory(), randomUUID()),
    file = new File(d, output.filename);
  const clean = () => {
    try {
      if (d.exists) d.delete();
    } catch {}
  };
  const unsubscribe = client.onSessionInvalidated(clean);
  let lease = false;
  try {
    d.create({ intermediates: true });
    file.create();
    file.write(output.bytes);
    if (!valid()) throw new Error('登录身份已变化');
    await Sharing.shareAsync(file.uri, {
      mimeType: output.contentType,
      dialogTitle: title,
    });
    lease = true;
    setTimeout(() => {
      clean();
      unsubscribe();
    }, 5 * 60000);
  } finally {
    if (!lease) {
      clean();
      unsubscribe();
    }
  }
}
