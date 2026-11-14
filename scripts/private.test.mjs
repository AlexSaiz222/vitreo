import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * What lives only in `.env` never reaches a tracked file (D79): the home
 * location, not even near it (a test fixture once sat 200 m away), and the
 * keys and passwords. Reads this checkout's `.env`; without one (a fresh
 * clone) there is nothing to compare with.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv() {
  try {
    const text = readFileSync(path.join(ROOT, '.env'), 'utf8');
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => {
          const at = line.indexOf('=');
          return [
            line.slice(0, at),
            line
              .slice(at + 1)
              .trim()
              .replace(/^"|"$/g, ''),
          ];
        }),
    );
  } catch {
    return null;
  }
}

/** Tracked files containing `text`, as git sees them (binaries left out). */
function trackedWith(text) {
  try {
    return execFileSync('git', ['grep', '-l', '-I', '-F', '-e', text], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

const env = readEnv();
const SECRETS = [
  'MQTT_DEVICE_PASSWORD',
  'MQTT_HUB_PASSWORD',
  'MQTT_WEB_PASSWORD',
  'HUB_VAPID_PUBLIC_KEY',
  'HUB_VAPID_PRIVATE_KEY',
  'AEMET_API_KEY',
];
/** Closer than this to home, a coordinate pair gives the place away. */
const NEAR_KM = 2;

function km(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return 6371 * Math.hypot(x, y);
}

describe.skipIf(env === null)('nothing from .env in the repository', () => {
  it('no key or password', () => {
    for (const name of SECRETS) {
      const value = env?.[name] ?? '';
      // Only a real value: the examples in .env.example are short placeholders.
      if (value.length < 12) continue;
      expect(trackedWith(value), name).toEqual([]);
    }
  });

  it('no home location, nor a point near it', () => {
    const lat = Number(env?.['VITE_LOCATION_LAT']);
    const lng = Number(env?.['VITE_LOCATION_LNG']);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const lines = (() => {
      try {
        return execFileSync('git', ['grep', '-n', '-I', '-E', '[0-9]+\\.[0-9]{2,}'], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }).split('\n');
      } catch {
        return [];
      }
    })();
    const near = [];
    for (const line of lines) {
      const numbers = [...line.matchAll(/-?\d+\.\d{2,}/g)].map((m) => Number(m[0]));
      const lats = numbers.filter((n) => Math.abs(n - lat) < 0.05);
      // A longitude may be written without its sign ("3.70 W").
      const lngs = numbers.filter((n) => Math.abs(Math.abs(n) - Math.abs(lng)) < 0.05);
      if (
        lats.some((a) => lngs.some((b) => km(lat, lng, a, Math.sign(lng) * Math.abs(b)) < NEAR_KM))
      ) {
        // The file and line, never the numbers.
        near.push(line.split(':').slice(0, 2).join(':'));
      }
    }
    expect(near).toEqual([]);
  });
});
