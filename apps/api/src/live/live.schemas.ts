import { z } from 'zod';

export const liveCreate = z
  .object({
    courseId: z.string().min(1).max(100),
    title: z.string().trim().min(2).max(120),
    scheduledAt: z.string().datetime({ offset: true }),
    maxParticipants: z.number().int().min(2).max(100).default(32),
  })
  .strict();
export const liveRevision = z.object({ revision: z.number().int().min(0).max(2_000_000_000) }).strict();
export const livePresence = z.object({ connectionId: z.string().uuid() }).strict();
export const liveHand = livePresence.extend({ raised: z.boolean() }).strict();
export const liveModeration = liveRevision
  .extend({
    action: z.enum(['approve', 'revoke', 'remove', 'mute-chat', 'unmute-chat']),
  })
  .strict();
export const liveChat = z
  .object({
    connectionId: z.string().uuid(),
    text: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)),
    clientId: z.string().uuid(),
  })
  .strict();
export const liveList = z
  .object({
    courseId: z.string().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const LIVE_PRESENCE_MS = 45_000;
export const LIVE_MEDIA_PREFIX = '/api/live/media';
