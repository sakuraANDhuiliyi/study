import { z } from 'zod';
import { combinedNoteQuery } from '../notes/standalone.schemas';
import { noteQuery } from '../notes/notes.schemas';
const page = (max: number, fallback: number) =>
  z
    .union([z.string(), z.number()])
    .pipe(z.coerce.number<string | number>().int().min(1).max(max))
    .default(fallback);
export const mobilePersonalNoteQuery = combinedNoteQuery
  .extend({
    source: z.enum(['all', 'lesson', 'standalone']).default('all'),
    page: page(100000, 1),
    pageSize: page(20, 10),
  })
  .strict();
export const mobilePersonalLessonNoteQuery = noteQuery
  .extend({ page: page(100000, 1), pageSize: page(20, 10) })
  .strict();
