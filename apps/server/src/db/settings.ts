import type { Settings, SettingsPatch } from '@perch/core';
import { eq } from 'drizzle-orm';

import type { Db } from './index';
import { settings } from './schema';

export function getSettings(db: Db, userId: number): Settings {
  const row = db.select().from(settings).where(eq(settings.userId, userId)).get();

  if (!row) throw new Error('settings row missing');

  return {
    timezone: row.timezone,
    char_limit_override: row.charLimitOverride,
  };
}

export function updateSettings(db: Db, userId: number, patch: SettingsPatch): Settings {
  db.update(settings)
    .set({
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.char_limit_override !== undefined
        ? { charLimitOverride: patch.char_limit_override }
        : {}),
    })
    .where(eq(settings.userId, userId))
    .run();

  return getSettings(db, userId);
}
