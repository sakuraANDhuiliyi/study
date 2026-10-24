import { z } from 'zod';
/** Keep PATCH fields absent instead of applying the create schema's defaults.
 * The outer optional stops undefined before preprocessing reaches an inner default.
 * Present values still run the unchanged field validator and transforms.
 */
export function sparsePartial<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const fields = Object.fromEntries(
    Object.entries(schema.shape).map(([key, value]) => [
      key,
      z.preprocess((input) => input, value).optional(),
    ]),
  );
  return schema.partial().extend(fields) as unknown as z.ZodObject<{ [K in keyof T]: z.ZodOptional<T[K]> }>;
}
