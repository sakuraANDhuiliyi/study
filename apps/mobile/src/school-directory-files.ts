import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import { parseSchoolImportCsv, schoolDirectoryRoot } from './school-directory-model';
const directory = () => new Directory(Paths.cache, 'zhixue-school-directory-transfers');
export function clearSchoolDirectoryTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {}
}
export async function pickSchoolImport(client: MobileClient, alive: () => boolean) {
  const epoch = client.sessionEpoch();
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/plain', 'application/csv'],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  try {
    if (!alive() || !client.ownsSession(epoch)) throw new Error('身份或页面已变化');
    const file = new File(asset.uri);
    if (!file.exists || file.size > 512 * 1024) throw new Error('CSV须小于512KiB');
    const text = await file.text();
    if (!alive() || !client.ownsSession(epoch)) throw new Error('身份或页面已变化');
    return parseSchoolImportCsv(text);
  } finally {
    if (asset.uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/DocumentPicker/'))
      try {
        const f = new File(asset.uri);
        if (f.exists) f.delete();
      } catch {}
  }
}
export async function shareSchoolDirectoryCsv(
  client: MobileClient,
  kind: 'template' | 'export',
  alive: () => boolean,
) {
  const epoch = client.sessionEpoch(),
    valid = () => alive() && client.ownsSession(epoch);
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件保存工具');
  if (!valid()) throw new Error('身份或页面已变化');
  const out = await client.download(schoolDirectoryRoot + '/users/' + kind, { maxBytes: 8 * 1024 * 1024 });
  if (!valid()) throw new Error('身份或页面已变化');
  const dir = new Directory(directory(), randomUUID()),
    file = new File(dir, kind === 'template' ? 'user-import-template.csv' : 'users.csv');
  let lease = false;
  const clean = () => {
    try {
      if (dir.exists) dir.delete();
    } catch {}
  };
  const stop = client.onSessionInvalidated(clean);
  try {
    dir.create({ intermediates: true });
    file.create();
    file.write(out.bytes);
    if (!valid()) throw new Error('身份或页面已变化');
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: kind === 'template' ? '保存用户导入模板' : '保存机构用户清单',
    });
    lease = true;
    setTimeout(() => {
      clean();
      stop();
    }, 5 * 60000);
  } finally {
    if (!lease) {
      clean();
      stop();
    }
  }
}
