import { z } from 'zod';

/** Languages persisted by Harness's `locale.preference` settings namespace. */
export type ChannelCommandLocale = 'zh' | 'en';

const settingsReaderSchema = z.custom<{ get(namespace: string): unknown }>(
  (value) => typeof value === 'object' && value !== null &&
    typeof Reflect.get(value, 'get') === 'function',
  { message: 'expected a Harness settings reader' },
);

const localeSettingsSchema = z.object({
  preference: z.enum(['zh', 'en']).optional(),
}).passthrough();

/**
 * Read the public Harness locale namespace through an optional settings seam.
 * Browser-only navigator fallback is unavailable to IM channels, so an absent
 * or invalid explicit preference preserves the channel's historical zh copy.
 */
export function commandLocaleFromSettings(settings: unknown): ChannelCommandLocale {
  const reader = settingsReaderSchema.safeParse(settings);
  if (!reader.success) return 'zh';
  try {
    // SettingsProvider.get relies on its receiver; call the validated method
    // against the original service rather than zod's parsed object.
    const section = reader.data.get.call(settings, 'locale');
    const parsed = localeSettingsSchema.safeParse(section);
    return parsed.success ? (parsed.data.preference ?? 'zh') : 'zh';
  } catch {
    return 'zh';
  }
}
