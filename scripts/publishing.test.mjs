import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { aclChanged, releaseProblems, SERVED_DIR } from './release.mjs';

/**
 * Publishing (D92): `pnpm release` is the only way to reach the phone. It
 * refuses an unreviewed or unpushed checkout, and nothing else may write to
 * the folder nginx serves or rebuild the hub the phone talks to.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

const packageFiles = [
  'package.json',
  ...['apps', 'packages'].flatMap((dir) =>
    readdirSync(path.join(ROOT, dir)).map((name) => `${dir}/${name}/package.json`),
  ),
].filter((file) => {
  try {
    read(file);
    return true;
  } catch {
    return false;
  }
});
const scripts = packageFiles.flatMap((file) =>
  Object.entries(JSON.parse(read(file)).scripts ?? {}).map(([name, command]) => ({
    where: `${file} › ${name}`,
    command,
  })),
);

const ready = { branch: 'main', dirty: [], head: 'abc', remote: 'abc' };

describe('pnpm release refuses what is not reviewed and pushed', () => {
  it('releases main, clean and pushed', () => {
    expect(releaseProblems(ready)).toEqual([]);
  });

  it('refuses another branch', () => {
    expect(releaseProblems({ ...ready, branch: 'feat/phase-a8-journal' })).toEqual([
      expect.stringMatching(/not on main/),
    ]);
  });

  it('refuses uncommitted changes', () => {
    expect(releaseProblems({ ...ready, dirty: [' M apps/web/src/App.tsx'] })).toEqual([
      expect.stringMatching(/not clean/),
    ]);
  });

  it('refuses main that is not pushed, or when origin cannot be checked', () => {
    expect(releaseProblems({ ...ready, remote: 'def' })).toEqual([
      expect.stringMatching(/not pushed/),
    ]);
    expect(releaseProblems({ ...ready, remote: null })).toEqual([expect.stringMatching(/unknown/)]);
  });
});

describe('the release brings the broker’s permissions along (A10)', () => {
  it('restarts the broker only when its ACL differs from the repository’s', () => {
    const acl = read('infra/mosquitto/acl');
    expect(aclChanged(acl.replace(/\n/g, '\r\n'), acl)).toBe(false);
    expect(aclChanged(acl.replace('topic write vitreo/+/weather\n', ''), acl)).toBe(true);
    expect(aclChanged(null, acl)).toBe(true);
  });

  it('lets the hub publish the weather, and nobody else', () => {
    const acl = read('infra/mosquitto/acl');
    expect(acl.match(/topic write vitreo\/\+\/weather/g)).toHaveLength(1);
    expect(acl.split('user web')[1]).not.toContain('weather');
  });
});

describe('nothing else publishes', () => {
  it('nginx serves the folder only the release writes', () => {
    expect(read('infra/docker-compose.yml')).toContain(`../${SERVED_DIR}:/usr/share/nginx/html`);
    expect(read('scripts/release.mjs')).toContain("'--outDir', 'dist'");
  });

  it('a plain web build never writes there', () => {
    expect(read('apps/web/vite.config.ts')).toMatch(/outDir:\s*'build'/);
  });

  it('no other script writes to dist/ or rebuilds the hub', () => {
    const offenders = scripts.filter(
      ({ command }) =>
        /--outDir[ =]dist(?![-\w])/.test(command) ||
        /--build\b/.test(command) ||
        /\bup -d\b(?!.*--no-build)(?!\s+mosquitto)/.test(command),
    );
    expect(offenders.map((s) => s.where)).toEqual([]);
  });

  it('the release rebuilds the hub and the daily simulator, nothing else does', () => {
    const release = read('scripts/release.mjs');
    expect(release).toContain("'up', '-d', '--build', 'hub'");
    expect(release).toContain("'up', '-d', '--build', 'simulator'");
  });

  it('the release is a root script', () => {
    expect(JSON.parse(read('package.json')).scripts.release).toBe('node scripts/release.mjs');
  });
});

describe('after a reboot everything comes back on its own', () => {
  /** Each service in infra/docker-compose.yml with its lines, by name. */
  const services = () => {
    const lines = read('infra/docker-compose.yml').split(/\r?\n/);
    const found = [];
    let inServices = false;
    for (const line of lines) {
      if (/^\S/.test(line)) inServices = line === 'services:';
      else if (inServices && /^ {2}\w+:$/.test(line))
        found.push({ name: line.trim().slice(0, -1), lines: [] });
      else if (inServices) found.at(-1)?.lines.push(line);
    }
    return found;
  };

  it('runs the broker, the app, the hub and the daily simulator as services', () => {
    expect(services().map((s) => s.name)).toEqual(['mosquitto', 'web', 'hub', 'simulator']);
  });

  it('restarts every service unless stopped by hand', () => {
    for (const { name, lines } of services()) {
      expect(lines, name).toContain('    restart: unless-stopped');
    }
  });

  it('binds every port to this computer only (D74)', () => {
    for (const { name, lines } of services()) {
      // Port mappings are the only quoted list items in the file.
      const ports = lines.filter((line) => /^ {6}- '/.test(line));
      for (const port of ports) expect(port, name).toMatch(/^ {6}- '127\.0\.0\.1:/);
      expect(ports.length, name).toBeGreaterThan(0);
    }
  });
});
