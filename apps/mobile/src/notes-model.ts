import { MobileApiError, type MobileClient } from './client';
export type LessonNote = { id: string; body: string; pinned: boolean; revision: number; updatedAt: string };
export type NoteDetail = {
  lesson: { id: string; title: string; courseId: string };
  course: { id: string; title: string; status: string };
  note: LessonNote | null;
};
export type NotesList = {
  items: {
    id: string;
    lessonId: string;
    courseId: string;
    lessonTitle: string;
    courseTitle: string;
    preview: string;
    pinned: boolean;
    revision: number;
    updatedAt: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
};
export function noteBody(body: string) {
  const value = body.trim();
  if (!value || value.length > 10000 || value.includes('\0'))
    throw new Error('请填写 1–10000 个字符的笔记，不能包含空字符');
  return value;
}
export function sameNote(a: LessonNote | null, b: LessonNote | null) {
  return a === null || b === null ? a === b : a.id === b.id && a.revision === b.revision;
}
export type PendingNote =
  | { kind: 'save'; base: LessonNote | null; body: string; pinned: boolean }
  | { kind: 'delete'; base: LessonNote };
export function reconcileNote(
  pending: PendingNote,
  current: LessonNote | null,
): 'applied' | 'unchanged' | 'conflict' {
  if (pending.kind === 'delete' && !current) return 'applied';
  if (
    pending.kind === 'save' &&
    current &&
    current.body === pending.body &&
    current.pinned === pending.pinned &&
    (pending.base
      ? current.id === pending.base.id && current.revision === pending.base.revision + 1
      : current.revision === 1)
  )
    return 'applied';
  return sameNote(pending.base, current) ? 'unchanged' : 'conflict';
}
export function definitiveNoteFailure(e: unknown) {
  return e instanceof MobileApiError && [400, 401, 403, 404, 409, 413, 422, 429].includes(e.status);
}
const path = (id: string, personal = false) =>
  (personal ? '/mobile/personal/lessons/' : '/mobile/lessons/') + encodeURIComponent(id) + '/note';
export const notesApi = {
  read: (client: MobileClient, id: string, personal = false) =>
    client.request<NoteDetail>(path(id, personal)),
  save: (
    client: MobileClient,
    id: string,
    body: string,
    pinned: boolean,
    base: LessonNote | null,
    personal = false,
  ) =>
    client.request<NoteDetail>(
      path(id, personal),
      { body: noteBody(body), pinned, revision: base?.revision || 0, ...(base ? { noteId: base.id } : {}) },
      'PUT',
    ),
  remove: (client: MobileClient, id: string, base: LessonNote, personal = false) =>
    client.request<{ deleted: true }>(
      path(id, personal),
      { noteId: base.id, revision: base.revision },
      'DELETE',
    ),
};
