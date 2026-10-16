import { ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';

// Media credentials are separate from AI/Judge configuration. They are never returned by status APIs.
export const liveConfigurationSchema = z
  .object({
    enabled: z.enum(['true', 'false']).default('false'),
    serverUrl: z
      .string()
      .url()
      .max(500)
      .default('http://127.0.0.1:7880')
      .refine((value) => {
        const u = new URL(value);
        return (
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === '/' &&
          (u.protocol === 'https:' ||
            (u.protocol === 'http:' && ['127.0.0.1', 'localhost', 'livekit'].includes(u.hostname)))
        );
      }),
    apiKey: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z0-9_-]*$/)
      .default(''),
    apiSecret: z
      .string()
      .max(512)
      .regex(/^[a-zA-Z0-9_-]*$/)
      .default(''),
  })
  .strict();

export function readLiveConfiguration(env = process.env) {
  const parsed = liveConfigurationSchema.safeParse({
    enabled: env.LIVEKIT_ENABLED,
    serverUrl: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  });
  if (!parsed.success) throw new ServiceUnavailableException('直播配置无效，请管理员检查直播服务设置');
  const c = parsed.data;
  if (c.enabled !== 'true' || c.apiKey.length < 6 || c.apiSecret.length < 32)
    throw new ServiceUnavailableException('直播尚未启用，请管理员配置直播服务');
  return c;
}
