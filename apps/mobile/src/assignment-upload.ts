/** Await the OS copy and check identity and the copied file size before upload. */
export async function prepareAssignmentUpload(
  copy: () => Promise<void>,
  size: () => Promise<number>,
  current: () => boolean,
  maximum: number,
) {
  await copy();
  if (!current()) throw new Error('登录身份已变化，已取消文件上传。');
  const bytes = await size();
  if (!current()) throw new Error('登录身份已变化，已取消文件上传。');
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximum || bytes > 50 * 1024 * 1024)
    throw new Error('文件为空或超过机构单文件上传上限。');
}
