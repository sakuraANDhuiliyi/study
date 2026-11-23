import { z } from 'zod';
export const expoPushToken = z
  .string()
  .max(180)
  .regex(/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,150}\]$/);
export const mobilePushBindInput = z.object({ token: expoPushToken, projectId: z.string().uuid() }).strict();
export const mobilePushEmpty = z.object({}).strict();
export function mobilePushRouteAllowed(path: string, method: string) {
  return (
    (method === 'GET' && /^\/api\/mobile\/push\/status\/?$/.test(path)) ||
    (['POST', 'DELETE'].includes(method) && /^\/api\/mobile\/push\/device\/?$/.test(path))
  );
}
