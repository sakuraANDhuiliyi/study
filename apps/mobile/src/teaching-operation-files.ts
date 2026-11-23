import { Directory, File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import { safeFileName } from './assignment-model';
import { prepareAssignmentUpload } from './assignment-upload';
import { teachingRoot, type TeachingFile } from './teaching-model';
const directory = () => new Directory(Paths.cache, 'zhixue-teaching-operation-transfers');
export function clearTeachingOperationTransfers() {
  try {
    const dir = directory();
    if (dir.exists) dir.delete();
  } catch {}
}
export async function uploadTeachingFile(
  client: MobileClient,
  course: string,
  maximum: number,
  alive: () => boolean,
) {
  const epoch = client.sessionEpoch(),
    valid = () => alive() && client.ownsSession(epoch);
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: '*/*',
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  let dir: Directory | undefined;
  try {
    if (!valid()) throw new Error('身份或页面已变化');
    const picked = new File(asset.uri);
    if (!picked.exists || picked.size > maximum || picked.size > 50 * 1024 * 1024)
      throw new Error('所选课件超过机构上传上限');
    dir = new Directory(directory(), randomUUID());
    dir.create({ intermediates: true });
    const file = new File(dir, safeFileName(asset.name));
    await prepareAssignmentUpload(
      () => picked.copy(file),
      async () => file.size,
      valid,
      maximum,
    );
    const body = new FormData();
    body.append('file', file);
    return await client.request<TeachingFile>(
      teachingRoot + '/courses/' + encodeURIComponent(course) + '/files',
      body,
      'POST',
      { multipart: true },
    );
  } finally {
    try {
      if (dir?.exists) dir.delete();
    } catch {}
    if (asset.uri.startsWith(Paths.cache.uri.replace(/\/$/, '') + '/DocumentPicker/'))
      try {
        const copy = new File(asset.uri);
        if (copy.exists) copy.delete();
      } catch {}
  }
}
export async function shareTeachingCourseFile(
  client: MobileClient,
  course: string,
  metadata: TeachingFile,
  alive: () => boolean,
) {
  const epoch = client.sessionEpoch(),
    valid = () => alive() && client.ownsSession(epoch);
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件保存工具');
  if (!valid()) throw new Error('身份或页面已变化');
  const output = await client.download(
    teachingRoot + '/courses/' + encodeURIComponent(course) + '/files/' + encodeURIComponent(metadata.id),
    { maxBytes: 50 * 1024 * 1024 },
  );
  if (!valid()) throw new Error('身份或页面已变化');
  if (output.bytes.byteLength !== metadata.size) throw new Error('课件大小不一致，请刷新后重新下载');
  const dir = new Directory(directory(), randomUUID()),
    file = new File(dir, safeFileName(metadata.originalName));
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
    file.write(output.bytes);
    if (!valid()) throw new Error('身份或页面已变化');
    await Sharing.shareAsync(file.uri, { mimeType: metadata.mime, dialogTitle: '保存或分享课程课件' });
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
