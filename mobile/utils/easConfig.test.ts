import { describe, expect, it } from 'vitest';
import eas from '../eas.json';

/**
 * EXPO_PUBLIC_* values are read at build time, not runtime.
 *
 * A local `expo run:ios` picks them up from mobile/.env, but .env is gitignored,
 * so an EAS build never sees it. With no env on the build profile the app ships
 * with apiConfigured() false: sign-in falls back to demo mode and the assistant
 * tab refuses to send, reporting itself unavailable in this build. That is what
 * reached a real device.
 */
const REQUIRED = [
  'EXPO_PUBLIC_PLANNER_API_URL',
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

const profiles = Object.entries(
  eas.build as unknown as Record<string, { env?: Record<string, string> }>,
);

describe('every build profile can reach the backend', () => {
  it('defines at least one profile', () => {
    expect(profiles.length).toBeGreaterThan(0);
  });

  it.each(profiles)('%s carries the whole public config', (_name, profile) => {
    for (const key of REQUIRED) {
      expect(profile.env?.[key], `${key} missing`).toBeTruthy();
    }
  });

  it.each(profiles)('%s points at a real https backend', (_name, profile) => {
    expect(profile.env?.EXPO_PUBLIC_PLANNER_API_URL).toMatch(/^https:\/\/\S+$/);
  });

  it('keeps every profile pointing at the same backend', () => {
    const urls = new Set(profiles.map(([, p]) => p.env?.EXPO_PUBLIC_PLANNER_API_URL));
    expect(urls.size).toBe(1);
  });
});
