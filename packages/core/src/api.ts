import { z } from 'zod';

import { CHAR_LIMIT_MAX } from './charLimit';
import { isValidTimeZone } from './timezone';

export const timezoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimeZone, { message: 'Unknown time zone' });

export const charLimitOverrideSchema = z
  .number()
  .int()
  .min(1)
  .max(CHAR_LIMIT_MAX)
  .nullable();

export const settingsSchema = z.object({
  timezone: timezoneSchema,
  char_limit_override: charLimitOverrideSchema,
});

export const settingsPatchSchema = settingsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Nothing to update',
  });

export const loginBodySchema = z.object({
  token: z.string().min(1),
});

export const meSchema = z.object({
  user: z.object({ id: z.number().int() }),
});

export const statusSchema = z.object({
  timezone: z.string(),
});

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type Me = z.infer<typeof meSchema>;
export type Status = z.infer<typeof statusSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
