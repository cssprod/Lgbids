import type { z } from 'zod';
import {
  automationSchema,
  emailSettingsSchema,
  profileSchema,
  regionSchema,
  type AutomationSettings,
  type EmailSettings,
  type Profile,
  type RegionSettings,
} from '../shared/schemas.js';
import type { SettingsService, Store } from './contracts.js';
import { defaultRegion } from './matching/geo.js';

/**
 * Typed access to the settings table. Stored values go back through the zod
 * schemas on every read, so a field added in a later version gets its default.
 */

const KEYS = { profile: 'profile', automation: 'automation', email: 'email', region: 'region' } as const;

/** SMTP settings that can come from the environment, so a server can be configured without the UI. */
const EMAIL_ENV: { field: keyof EmailSettings; name: string }[] = [
  { field: 'host', name: 'SMTP_HOST' },
  { field: 'port', name: 'SMTP_PORT' },
  { field: 'secure', name: 'SMTP_SECURE' },
  { field: 'user', name: 'SMTP_USER' },
  { field: 'pass', name: 'SMTP_PASS' },
  { field: 'fromName', name: 'SMTP_FROM_NAME' },
  { field: 'fromEmail', name: 'SMTP_FROM_EMAIL' },
];

/** Changing any of these means the saved "connection verified" stamp no longer applies. */
const CONNECTION_FIELDS = ['host', 'port', 'user', 'pass', 'secure'] as const;

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function envPort(env: NodeJS.ProcessEnv): number | undefined {
  const value = envValue(env, 'SMTP_PORT');
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/** Names of the EmailSettings fields that the environment currently supplies. */
export function emailFromEnvironment(env: NodeJS.ProcessEnv): string[] {
  return EMAIL_ENV.filter(({ field, name }) => (field === 'port' ? envPort(env) !== undefined : envValue(env, name) !== undefined)).map(
    ({ field }) => field,
  );
}

function overlayEnvironment(settings: EmailSettings, env: NodeJS.ProcessEnv): EmailSettings {
  const result = { ...settings };
  const host = envValue(env, 'SMTP_HOST');
  if (host !== undefined) result.host = host;
  const port = envPort(env);
  if (port !== undefined) result.port = port;
  const secure = envValue(env, 'SMTP_SECURE');
  if (secure !== undefined) result.secure = secure === '1' || secure.toLowerCase() === 'true';
  const user = envValue(env, 'SMTP_USER');
  if (user !== undefined) result.user = user;
  // The password is used as given: surrounding spaces could be part of it.
  const pass = env.SMTP_PASS;
  if (pass !== undefined && pass !== '') result.pass = pass;
  const fromName = envValue(env, 'SMTP_FROM_NAME');
  if (fromName !== undefined) result.fromName = fromName;
  const fromEmail = envValue(env, 'SMTP_FROM_EMAIL');
  if (fromEmail !== undefined) result.fromEmail = fromEmail;
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createSettings(store: Store, env: NodeJS.ProcessEnv = process.env, now: () => Date = () => new Date()): SettingsService {
  /** Read a stored value; anything unreadable falls back to the defaults rather than breaking the app. */
  function read<S extends z.ZodType>(key: string, schema: S): z.output<S> {
    const stored = store.getSetting(key);
    const parsed = schema.safeParse(isRecord(stored) ? stored : {});
    return parsed.success ? parsed.data : schema.parse({});
  }

  function storedEmail(): EmailSettings {
    return read(KEYS.email, emailSettingsSchema);
  }

  function region(): RegionSettings {
    const stored = store.getSetting(KEYS.region);
    if (!isRecord(stored)) return defaultRegion();
    const parsed = regionSchema.safeParse(stored);
    if (!parsed.success) return defaultRegion();
    const value = parsed.data;
    // An empty region would rule every notice out, which is never what anyone means.
    if (value.places.length === 0 && value.excludePlaces.length === 0 && value.organizations.length === 0) return defaultRegion();
    return value;
  }

  /** Scores and matches depend on these settings, so everything is worked out again. */
  function recompute(clearStates: boolean): void {
    if (clearStates) store.clearSourceStates();
    store.markAllForAnalysis();
  }

  return {
    getProfile(): Profile {
      return read(KEYS.profile, profileSchema);
    },

    setProfile(value) {
      const profile = profileSchema.parse(value);
      store.setSetting(KEYS.profile, profile, now());
      recompute(false);
      return profile;
    },

    getAutomation(): AutomationSettings {
      return read(KEYS.automation, automationSchema);
    },

    setAutomation(value) {
      const automation = automationSchema.parse(value);
      store.setSetting(KEYS.automation, automation, now());
      recompute(true);
      return automation;
    },

    getEmail() {
      return overlayEnvironment(storedEmail(), env);
    },

    setEmail(value) {
      const incoming = emailSettingsSchema.parse(value);
      const existing = storedEmail();
      const next: EmailSettings = { ...incoming };
      if (next.pass === '') next.pass = existing.pass;
      const connectionChanged = CONNECTION_FIELDS.some((field) => next[field] !== existing[field]);
      if (connectionChanged) next.verifiedAt = null;
      // A form that leaves verifiedAt out must not wipe the stamp from the last successful test.
      else if (!(isRecord(value) && 'verifiedAt' in value)) next.verifiedAt = existing.verifiedAt;
      store.setSetting(KEYS.email, next, now());
      return overlayEnvironment(next, env);
    },

    getRegion() {
      return region();
    },

    setRegion(value) {
      const parsed = regionSchema.parse(value);
      store.setSetting(KEYS.region, parsed, now());
      recompute(true);
      return region();
    },

    resetRegion() {
      store.setSetting(KEYS.region, undefined, now());
      recompute(true);
      return defaultRegion();
    },
  };
}
