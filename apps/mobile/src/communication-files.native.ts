import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import { safeFileName } from './assignment-model';
import { prepareAssignmentUpload } from './assignment-upload';
import {
  communicationFilesPath,
  confirmedCommunicationFile,
  type CommunicationFile,
  type CommunicationFileScope,
} from './communication-files-model';
const directory = () => new Directory(Paths.cache, 'zhixue-communication-transfers');
export function clearCommunicationTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {}
}
export async function pickCommunicationFile(
  client: MobileClient,
  scope: CommunicationFileScope,
  maximum: number,
  signal: AbortSignal,
) {
  const epoch = client.sessionEpoch(),
    current = () => client.ownsSession(epoch) && !signal.aborted;
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  let d: Directory | null = null;
  try {
    if (!current()) throw new Error('已取消选择或登录身份已变化');
    const picked = new File(asset.uri);
    if (!picked.exists || picked.size < 1 || picked.size > maximum || picked.size > 50 * 1024 * 1024)
      throw new Error('文件为空或超过机构单文件上限');
    d = new Directory(directory(), randomUUID());
    d.create({ intermediates: true });
    const file = new File(d, safeFileName(asset.name));
    await prepareAssignmentUpload(
      () => picked.copy(file),
      async () => file.size,
      current,
      maximum,
    );
    const body = new FormData();
    body.append('file', file);
    const uploaded = await client.request<CommunicationFile>(communicationFilesPath(scope), body, 'POST', {
      multipart: true,
      signal,
    });
    if (!current()) throw new Error('上传已取消；请核对服务器本人附件列表');
    return confirmedCommunicationFile(uploaded);
  } finally {
    try {
      if (d?.exists) d.delete();
    } catch {}
    if (asset.uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/DocumentPicker/'))
      try {
        const copy = new File(asset.uri);
        if (copy.exists) copy.delete();
      } catch {}
  }
}
export async function openDiscussionFile(client: MobileClient, postId: string, metadata: CommunicationFile) {
  const epoch = client.sessionEpoch();
  confirmedCommunicationFile(metadata);
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件打开工具');
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化');
  const bytes = await client.request<Uint8Array>(
    '/mobile/discussions/' + encodeURIComponent(postId) + '/files/' + encodeURIComponent(metadata.id),
    undefined,
    'GET',
    { binary: true },
  );
  if (!client.ownsSession(epoch)) throw new Error('登录身份已变化');
  if (bytes.byteLength !== metadata.size) throw new Error('附件大小已变化，请刷新后重试');
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
    if (!client.ownsSession(epoch)) throw new Error('登录身份已变化');
    await Sharing.shareAsync(file.uri, { mimeType: metadata.mime, dialogTitle: '打开或保存讨论附件' });
  } finally {
    setTimeout(dispose, 5 * 60000);
  }
}
