import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { randomUUID } from 'expo-crypto';
import type { MobileClient } from './client';
import { academicRoot } from './academics-model';
export type AcademicExportInput = {
  format: 'csv' | 'md';
  moduleId?: string;
  status: 'all' | 'DRAFT' | 'COMPLETED';
  limit: number;
};
const directory = () => new Directory(Paths.cache, 'zhixue-academic-exports');
export function clearAcademicTransfers() {
  try {
    const d = directory();
    if (d.exists) d.delete();
  } catch {}
}
export async function exportAcademicFile(
  client: MobileClient,
  input: AcademicExportInput,
  alive: () => boolean,
) {
  const epoch = client.sessionEpoch(),
    valid = () => alive() && client.ownsSession(epoch);
  if (!(await Sharing.isAvailableAsync())) throw new Error('当前设备没有可用的文件打开或保存工具。');
  if (!valid()) throw new Error('页面或登录身份已变化，已取消导出。');
  const bytes = await client.request<Uint8Array>(academicRoot + '/records/export', input, 'POST', {
    binary: true,
  });
  if (!valid()) throw new Error('页面或登录身份已变化，已取消导出。');
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024)
    throw new Error('导出文件大小无效，请缩小范围后重试。');
  const d = new Directory(directory(), randomUUID()),
    file = new File(d, 'academic-records.' + input.format);
  const clean = () => {
    try {
      if (d.exists) d.delete();
    } catch {}
  };
  let lease = false;
  const unsubscribe = client.onSessionInvalidated(clean);
  try {
    d.create({ intermediates: true });
    file.create();
    file.write(bytes);
    if (!valid()) throw new Error('登录身份已变化，已取消导出。');
    await Sharing.shareAsync(file.uri, {
      mimeType: input.format === 'csv' ? 'text/csv' : 'text/markdown',
      dialogTitle: '保存或分享本人的学习记录',
    });
    lease = true;
    // Explicitly selected external apps may need a brief read lease. Logout removes our private copy.
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
