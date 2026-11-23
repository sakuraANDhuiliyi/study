import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import { aiStudyRoot } from './ai-study-model';
const directory = () => new Directory(Paths.cache, 'zhixue-ai-study-transfers');
export function clearAiStudyTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {}
}
export async function shareAiStudyFile(
  client: MobileClient,
  id: string,
  action: { format: 'md' | 'json' } | { sourceId: string; maxBytes: number },
  alive: () => boolean,
) {
  const epoch = client.sessionEpoch(),
    valid = () => alive() && client.ownsSession(epoch);
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件保存或打开工具。');
  if (!valid()) throw new Error('登录身份已变化，已取消下载。');
  const root = aiStudyRoot + '/reports/' + encodeURIComponent(id);
  const output =
    'format' in action
      ? await client.download(root + '/export?format=' + action.format, { maxBytes: 10 * 1024 * 1024 })
      : await client.download(root + '/sources/' + encodeURIComponent(action.sourceId) + '/download', {
          method: 'POST',
          body: {},
          maxBytes: action.maxBytes,
        });
  if (!valid()) throw new Error('页面或登录身份已变化，已取消下载。');
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
    if (!valid()) throw new Error('登录身份已变化，已取消下载。');
    await Sharing.shareAsync(file.uri, {
      mimeType: output.contentType,
      dialogTitle: '保存或打开错题复盘资料',
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
