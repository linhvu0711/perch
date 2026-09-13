import { z } from 'zod';

import { CliError } from './output';

export const cliEnvSchema = z.object({
  PERCH_TOKEN: z.string().optional(),
  PERCH_SERVER_URL: z.url({ error: 'must be a URL' }).optional(),
  PERCH_CONFIG_PATH: z.string().optional(),
  VISUAL: z.string().optional(),
  EDITOR: z.string().optional(),
});

export type CliEnv = z.infer<typeof cliEnvSchema>;

export function parseCliEnv(env: Record<string, string | undefined>): CliEnv {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') clean[key] = value;
  }
  const result = cliEnvSchema.safeParse(clean);
  if (!result.success) {
    const issue = result.error.issues[0];
    const detail = issue ? `${issue.path.join('.')} ${issue.message}` : 'invalid environment';
    throw new CliError('usage', detail, 2);
  }
  return result.data;
}
