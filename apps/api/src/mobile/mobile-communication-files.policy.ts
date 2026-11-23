import { z } from 'zod';
export const communicationFileId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const communicationAttachmentIds = z
  .array(communicationFileId)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, '附件不能重复');
const page = (fallback: number, max: number) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
    .pipe(z.number().int().min(1).max(max))
    .default(fallback);
export const communicationFilesQuery = z.object({ page: page(1, 100000), pageSize: page(10, 20) }).strict();
export const communicationFileEmpty = z.object({}).strict();
export function mobileCommunicationFilesRouteAllowed(path: string, method: string) {
  const collection =
    /^\/api\/mobile\/(?:discussions\/courses|messages\/conversations)\/[A-Za-z0-9_-]{1,100}\/files\/?$/;
  const item =
    /^\/api\/mobile\/(?:discussions\/courses|messages\/conversations)\/[A-Za-z0-9_-]{1,100}\/files\/[A-Za-z0-9_-]{1,100}\/?$/;
  return (
    ((method === 'GET' || method === 'POST') && collection.test(path)) ||
    (method === 'DELETE' && item.test(path)) ||
    (method === 'GET' &&
      /^\/api\/mobile\/discussions\/[A-Za-z0-9_-]{1,100}\/files\/[A-Za-z0-9_-]{1,100}\/?$/.test(path))
  );
}
