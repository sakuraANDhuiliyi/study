import { z } from 'zod';
import { loginInput } from '../auth/login.service';
export const mobileLoginInput = loginInput.extend({ deviceName: z.string().trim().min(1).max(60) }).strict();
export const mobileRefreshInput = z
  .object({ refreshToken: z.string().regex(/^mr1_[A-Za-z0-9_-]{64}$/) })
  .strict();
