import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { demoProblems, forbiddenFrom, leaksIn } from './demo-check.mjs';
import { inlineScriptHashes, vercelConfig } from './demo.mjs';

/**
 * The demo's check (D103 §6): it must fail on a secret planted on purpose,
 * say where without saying what, and pass a clean build. The values here
 * are made up for the test.
 */
const ENV = {
  AEMET_API_KEY: 'planted-aemet-key-0123456789',
  HUB_VAPID_PRIVATE_KEY: 'planted-vapid-private-abcdef',
  MQTT_WEB_PASSWORD: 'planted-password-xyz',
  VITE_MQTT_URL: 'wss://planted.example:8443',
  VITE_DEVICE_ID: 'sim',
  // A made-up place, well away from the demo's Madrid centre.
  VITE_LOCATION_LAT: '41.65',
  VITE_LOCATION_LNG: '-0.88',
};
const forbidden = forbiddenFrom(ENV, 'someone@example.com');

let dir = '';
function build(files) {
  dir = mkdtempSync(path.join(tmpdir(), 'vitreo-demo-check-'));
  mkdirSync(path.join(dir, 'assets'));
  const all = {
    'index.html': '<!doctype html><title>Vitreo</title>',
    'assets/week-abc.json': '{"v":1}',
    'assets/index-abc.js': 'const where={lat:40.42,lng:-3.7};',
    ...files,
  };
  for (const [name, text] of Object.entries(all)) writeFileSync(path.join(dir, name), text);
  return dir;
}
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the demo carries nothing of .env, home or the tailnet', () => {
  it('passes a clean build (Madrid centre is the demo’s own place)', () => {
    expect(demoProblems(build({}), forbidden)).toEqual([]);
  });

  it('fails on a planted secret, naming the key and the file, never the value', () => {
    const problems = demoProblems(
      build({ 'assets/chunk.js': `fetch("x",{h:"${ENV.AEMET_API_KEY}"})` }),
      forbidden,
    );
    expect(problems).toEqual(['assets/chunk.js: AEMET_API_KEY']);
    expect(problems.join()).not.toContain(ENV.AEMET_API_KEY);
  });

  it('fails on the home place, or a point near it, written as a pair', () => {
    expect(leaksIn('{"lat":41.66,"lng":-0.87}', forbidden)).toEqual(['the home location']);
    // Far apart in the file: not a pair.
    expect(leaksIn(`41.66 ${'x'.repeat(500)} -0.87`, forbidden)).toEqual([]);
  });

  it('fails on a tailnet, a home address, the MQTT client, the git email', () => {
    expect(leaksIn('https://vitreo.tail0abc12.ts.net', forbidden)).toEqual(['a tailnet']);
    expect(leaksIn('ws://192.168.1.20:9002', forbidden)).toEqual(['a home network address']);
    expect(leaksIn('class MqttClient extends', forbidden)).toEqual(['the MQTT client']);
    expect(leaksIn('by Someone@Example.com', forbidden)).toEqual(['the git email']);
    // A table of hex bytes is not an address.
    expect(leaksIn('0f.10.11.12.13.14', forbidden)).toEqual([]);
  });

  it('fails on a sourcemap, and on a build without its week', () => {
    expect(demoProblems(build({ 'assets/index-abc.js.map': '{}' }), forbidden)).toEqual([
      'assets/index-abc.js.map: a sourcemap (the demo ships none)',
    ]);
    rmSync(path.join(dir, 'assets/index-abc.js.map'));
    rmSync(path.join(dir, 'assets/week-abc.json'));
    expect(demoProblems(dir, forbidden)).toEqual(['no recorded week (week-*.json) in the build']);
  });

  it('short values and other keys are not secrets', () => {
    expect(forbidden.secrets.map(([name]) => name)).toEqual([
      'AEMET_API_KEY',
      'HUB_VAPID_PRIVATE_KEY',
      'MQTT_WEB_PASSWORD',
      'VITE_MQTT_URL',
    ]);
  });
});

describe('the demo’s headers (docs/09 §2)', () => {
  it('allow only this site, and the boot script by its hash', () => {
    const html = '<script>var a = 1;</script><script type="module" src="/x.js"></script>';
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    const headers = vercelConfig(hashes).headers[0]?.headers ?? [];
    const csp = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain(`'sha256-${hashes[0] ?? ''}'`);
    expect(csp).not.toMatch(/https?:/);
    expect(headers.find((h) => h.key === 'Permissions-Policy')?.value).toContain('geolocation=()');
  });
});
