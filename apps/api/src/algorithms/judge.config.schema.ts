import { z } from 'zod';

/** Shared by the complete application YAML parser and the judge's environment override parser. */
export const judgeLanguageIdsSchema = z
  .object({
    cpp: z.number().int().positive().max(100_000).default(54),
    python: z.number().int().positive().max(100_000).default(71),
    javascript: z.number().int().positive().max(100_000).default(63),
    java: z.number().int().positive().max(100_000).default(62),
  })
  .strict();

export const judgeConfigurationSchema = z
  .object({
    enabled: z.boolean().default(true),
    baseUrl: z
      .string()
      .trim()
      .max(2048)
      .default('')
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash &&
            (url.protocol === 'https:' ||
              (process.env.NODE_ENV !== 'production' &&
                url.protocol === 'http:' &&
                ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
          );
        } catch {
          return false;
        }
      }),
    apiKey: z
      .string()
      .max(4096)
      .refine((value) => !/[\r\n\0]/.test(value))
      .default(''),
    timeoutMs: z.number().int().min(100).max(60_000).default(45_000),
    pollMs: z.number().int().min(10).max(2000).default(250),
    languageIds: judgeLanguageIdsSchema.default({}),
  })
  .strict();

export type JudgeYamlConfiguration = z.infer<typeof judgeConfigurationSchema>;
