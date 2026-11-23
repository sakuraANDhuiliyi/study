import type { MobileClient } from './client';
export const schoolDirectoryRoot = '/mobile/school-directory';
export type SchoolImportRow = {
  username: string;
  name: string;
  password: string;
  roles: string[];
  studentNo?: string;
  majorId?: string;
};
export type SchoolImportPreview = {
  valid: boolean;
  committed: boolean;
  total: number;
  errors: { row: number; message: string }[];
  preview?: Omit<SchoolImportRow, 'password'>[];
};
export type DirectoryUser = { id: string; name: string; username: string; roles: string[]; active: boolean };
export type DirectoryBinding = {
  id: string;
  name: string;
  courseId: string;
  course?: { id: string; title: string; status: string };
};
/** Strict bounded CSV parsing; passwords are never trimmed, displayed or written back to disk. */
export function parseSchoolImportCsv(source: string): SchoolImportRow[] {
  if (source.length > 512 * 1024 || source.includes('\0')) throw new Error('导入文件过大或包含无效字符');
  const text = source.replace(/^\uFEFF/, ''),
    rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field);
    field = '';
    closed = false;
    if (row.length > 6) throw new Error('CSV列数过多');
  };
  const end = () => {
    cell();
    if (row.some((x) => x !== '')) rows.push(row);
    row = [];
    if (rows.length > 101) throw new Error('手机端每次最多导入100个用户');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ',') cell();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      end();
    } else if (c === '"') {
      if (field || closed) throw new Error('CSV引号位置无效');
      quoted = true;
    } else {
      if (closed) throw new Error('CSV引号闭合后须为分隔符');
      field += c;
    }
    if (field.length > 4096) throw new Error('CSV单元格过长');
  }
  if (quoted) throw new Error('CSV引号未闭合');
  if (field || row.length || closed) end();
  const headers = rows.shift()?.map((s) => s.trim()) || [],
    allowed = ['username', 'name', 'password', 'studentNo', 'roles', 'majorId'];
  if (
    new Set(headers).size !== headers.length ||
    headers.some((h) => !allowed.includes(h)) ||
    ['username', 'name', 'password', 'roles'].some((h) => !headers.includes(h))
  )
    throw new Error('请使用导入模板列名，至少包含username/name/password/roles');
  if (!rows.length) throw new Error('导入文件没有用户数据');
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`第${index + 2}行列数与表头不一致`);
    const item = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    return {
      username: item.username.trim(),
      name: item.name.trim(),
      password: item.password,
      roles: item.roles.split('|').map((r) => r.trim()),
      ...(item.studentNo?.trim() ? { studentNo: item.studentNo.trim() } : {}),
      ...(item.majorId?.trim() ? { majorId: item.majorId.trim() } : {}),
    };
  });
}
export const schoolDirectoryApi = {
  preview: (c: MobileClient, rows: SchoolImportRow[]) =>
    c.request<SchoolImportPreview>(schoolDirectoryRoot + '/users/import', { rows, commit: false }, 'POST'),
  commit: (c: MobileClient, rows: SchoolImportRow[]) =>
    c.request<SchoolImportPreview>(schoolDirectoryRoot + '/users/import', { rows, commit: true }, 'POST'),
  roles: (c: MobileClient, id: string, roles: string[]) =>
    c.request<DirectoryUser>(
      schoolDirectoryRoot + '/users/' + encodeURIComponent(id) + '/roles',
      { roles: [...new Set(roles)] },
      'PATCH',
    ),
};
