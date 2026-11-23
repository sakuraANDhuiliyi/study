import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import { parseProjectBackup, programmingRoot } from './programming-model';
const root = () => new Directory(Paths.cache, 'zhixue-programming-transfers');
export function clearProgrammingTransfers() {
  try {
    const dir = root();
    if (dir.exists) dir.delete();
  } catch {}
}
export async function pickProjectBackup(client: MobileClient) {
  const epoch = client.sessionEpoch();
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/plain', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0],
    file = new File(asset.uri);
  try {
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
    if (!file.exists || file.size > 512 * 1024) throw new Error('备份须为不超过512 KiB的JSON文件。');
    const text = await file.text();
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error('备份不是有效的JSON文件。');
    }
    return parseProjectBackup(value);
  } finally {
    if (asset.uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/DocumentPicker/'))
      try {
        if (file.exists) file.delete();
      } catch {}
  }
}
export async function shareProgrammingFile(
  client: MobileClient,
  id: string,
  kind: 'zip' | 'backup' | 'creative',
) {
  const epoch = client.sessionEpoch();
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件保存工具。');
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
  const path =
    programmingRoot +
    (kind === 'creative' ? '/creative/' : '/projects/') +
    encodeURIComponent(id) +
    (kind === 'backup' ? '/backup' : '/export');
  const bytes = await client.request<Uint8Array>(path, undefined, 'GET', { binary: true });
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
  if (!bytes.byteLength || bytes.byteLength > 1024 * 1024)
    throw new Error('导出文件大小异常，请重新核对项目。');
  const directory = new Directory(root(), randomUUID()),
    file = new File(directory, kind === 'backup' ? 'project-backup.json' : 'project-source.zip');
  const dispose = () => {
    try {
      if (directory.exists) directory.delete();
    } catch {}
  };
  try {
    directory.create({ intermediates: true });
    file.create();
    file.write(bytes);
  } catch (e) {
    dispose();
    throw e;
  }
  try {
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
    await Sharing.shareAsync(file.uri, {
      mimeType: kind === 'backup' ? 'application/json' : 'application/zip',
      dialogTitle: kind === 'backup' ? '保存项目备份' : '保存源码压缩包',
    });
  } finally {
    setTimeout(dispose, 5 * 60000);
  }
}
