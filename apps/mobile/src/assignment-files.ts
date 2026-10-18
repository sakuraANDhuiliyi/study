import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import { safeFileName, type AssignmentFile } from './assignment-model';
import { prepareAssignmentUpload } from './assignment-upload';
const directory = () => new Directory(Paths.cache, 'zhixue-assignment-transfers');
export function clearAssignmentTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {
    /* OS cache cleanup will retry on next login. */
  }
}
function transferFile(name: string) {
  const d = new Directory(directory(), randomUUID());
  d.create({ intermediates: true });
  return new File(d, safeFileName(name));
}
export async function pickAssignmentFile(client: MobileClient, id: string, maximum: number) {
  const epoch = client.sessionEpoch();
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  let file: File | null = null;
  try {
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化，请重新选择文件。');
    const picked = new File(asset.uri);
    if (!picked.exists || picked.size > maximum || picked.size > 50 * 1024 * 1024)
      throw new Error('所选文件超过机构单文件上传上限。');
    file = transferFile(asset.name);
    await prepareAssignmentUpload(
      () => picked.copy(file!),
      async () => file!.size,
      () => client.ownsSession(epoch),
      maximum,
    );
    const body = new FormData();
    // Expo 56 fetch accepts FileSystem's Blob-compatible File, not legacy {uri} parts.
    body.append('file', file);
    return await client.uploadAssignmentFile<AssignmentFile>(id, body);
  } finally {
    try {
      if (file?.parentDirectory.exists) file.parentDirectory.delete();
    } catch {}
    // Only the cache copy created by this picker call is eligible for deletion.
    if (asset.uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/DocumentPicker/'))
      try {
        const copy = new File(asset.uri);
        if (copy.exists) copy.delete();
      } catch {}
  }
}
export async function downloadAssignmentFile(client: MobileClient, id: string, metadata: AssignmentFile) {
  const epoch = client.sessionEpoch();
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件打开或保存工具。');
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化，已取消文件打开。');
  const bytes = await client.downloadAssignmentFile(id, metadata.id);
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化，已取消文件打开。');
  if (bytes.byteLength !== metadata.size) throw new Error('文件大小与记录不一致，请刷新作业后重新下载。');
  const file = transferFile(metadata.name);
  file.create();
  file.write(bytes);
  try {
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化。');
    await Sharing.shareAsync(file.uri, { mimeType: metadata.mime, dialogTitle: '打开或保存作业附件' });
  } finally {
    // Leave a short read lease for the explicitly selected external application.
    // Logout clears this private cache immediately; exported copies belong to that application.
    setTimeout(() => {
      try {
        if (file.parentDirectory.exists) file.parentDirectory.delete();
      } catch {}
    }, 5 * 60000);
  }
}
