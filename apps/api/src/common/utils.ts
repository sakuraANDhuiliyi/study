import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';
export const paging = (q: Record<string, unknown>) => {
  const page = Math.max(1, Math.min(100000, Number(q.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(q.pageSize) || 20));
  return {
    page: Math.floor(page),
    pageSize: Math.floor(pageSize),
    skip: (Math.floor(page) - 1) * Math.floor(pageSize),
  };
};
export const clean = (text: string) =>
  sanitizeHtml(text, {
    allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h2', 'h3', 'a'],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['http', 'https'],
    disallowedTagsMode: 'discard',
  });
export const dateString = z.string().datetime({ offset: true });
// Images are never fetched by the server. Private image URLs are restricted to
// the authenticated attachment preview endpoint and separately authorized by lessons.
export const cleanRichText = (text: string, allowPrivateImages = false) =>
  sanitizeHtml(text, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'h2',
      'h3',
      'a',
      'img',
    ],
    allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https'],
    exclusiveFilter: (frame) =>
      frame.tag === 'img' &&
      !(
        /^https:\/\/[^\s<>]+$/i.test(frame.attribs.src || '') ||
        (allowPrivateImages && /^\/api\/attachments\/[a-zA-Z0-9_-]+\/preview$/.test(frame.attribs.src || ''))
      ),
    disallowedTagsMode: 'discard',
  });
export const username = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.@-]+$/);
export const password = z.string().min(12).max(128);
export const safeUser = {
  id: true,
  organizationId: true,
  accountMode: true,
  majorId: true,
  username: true,
  name: true,
  studentNo: true,
  active: true,
  createdAt: true,
  roles: { select: { roleId: true } },
} as const;
export const csvCell = (value: unknown) =>
  '"' +
  String(value ?? '')
    .replace(/^(?:\s*[=+\-@]|[\t\r\n])/, (x) => "'" + x)
    .replaceAll('"', '""') +
  '"';
