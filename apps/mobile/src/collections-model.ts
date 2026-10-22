import type { Question } from './assignment-model';
import type { MobileClient } from './client';
export type CollectionRow = {
  id: string;
  courseId: string;
  questionId: string;
  available: boolean;
  favorite: boolean;
  favoriteId: string | null;
  mastered: boolean | null;
  token: string | null;
  wrongCount: number | null;
  question: Question | null;
};
export type CollectionList = { items: CollectionRow[]; total: number; page: number; pageSize: number };
export const collectionsApi = {
  master: (c: MobileClient, row: CollectionRow) =>
    c.request(
      '/mobile/collections/mistakes/' + encodeURIComponent(row.id),
      { mastered: !row.mastered, expected: row.token },
      'PUT',
    ),
  favorite: (c: MobileClient, row: CollectionRow) =>
    c.request(
      '/mobile/collections/favorites/' + encodeURIComponent(row.questionId),
      { favorite: !row.favorite, expected: row.favoriteId },
      'PUT',
    ),
};
