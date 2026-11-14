// Publishes Vitreo to the phone (D92): the only way to do it.
//
//   pnpm release
//
// It refuses unless this is `main`, the working tree is clean and `main` is
// pushed (what the phone gets is what is on GitHub). Then it restarts the
// broker if its permissions (infra/mosquitto/acl) changed, rebuilds the
// hub and the daily simulator, waits until they answer, and builds the PWA
// into apps/web/dist/, the folder nginx serves (infra/docker-compose.yml). No other script writes
// there: a plain `vite build` goes to apps/web/build/, `pnpm pwa:check` to
// dist-check/ (checked by scripts/publishing.test.mjs).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The folder nginx serves to the phone. */
export const SERVED_DIR = 'apps/web/dist';
const COMPOSE = ['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml'];
const HUB_HEALTH = 'http://127.0.0.1:8787/api/v1/health';
const SIMULATOR_STATE = 'http://127.0.0.1:8788/state';
const APP = 'http://127.0.0.1:8080/';

/**
 * Why this checkout may not be published, in words; empty if it may.
 * @param {{ branch: string, dirty: string[], head: string, remote: string | null }} state
 * @returns {string[]}
 */
export function releaseProblems({ branch, dirty, head, remote }) {
  const problems = [];
  if (branch !== 'main') problems.push(`not on main (on "${branch}"): only main is published`);
  if (dirty.length > 0) {
    problems.push(
      `the working tree is not clean (${dirty.length.toString()} change(s)): commit or stash them`,
    );
  }
  if (remote === null) problems.push('origin/main is unknown: fetch failed or there is no remote');
  else if (head !== remote)
    problems.push('main is not pushed (or is behind origin/main): push first');
  return problems;
}

/**
 * Whether the broker runs with other permissions than the repository's
 * (it copies infra/mosquitto/acl when it starts, so a change needs a restart).
 * @param {string | null} running the ACL inside the container, or null if unknown
 * @param {string} wanted infra/mosquitto/acl
 */
export function aclChanged(running, wanted) {
  const lines = (text) => text.replace(/\r\n/g, '\n').trim();
  return running === null || lines(running) !== lines(wanted);
}

/** The broker answers MQTT on its port (a CONNACK to a CONNECT without credentials). */
function mqttAnswers(port) {
  const connect = Buffer.from([
    0x10, 0x0c, 0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c, 0x00, 0x00,
  ]);
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000, () => done(false));
    socket.on('connect', () => socket.write(connect));
    socket.once('data', (data) => done(data[0] === 0x20));
    socket.on('error', () => done(false));
  });
}

/**
 * pnpm through Node itself (`pnpm release` says where its script is), so
 * Windows needs no shell for `pnpm.cmd`: a shell with separate arguments is
 * what Node warns about (DEP0190). Outside pnpm, the shell as before.
 */
const PNPM = process.env.npm_execpath?.match(/pnpm\.c?js$/) ? process.env.npm_execpath : null;

function run(command, args, options = {}) {
  const viaNode = command === 'pnpm' && PNPM !== null;
  const result = spawnSync(viaNode ? process.execPath : command, viaNode ? [PNPM, ...args] : args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: !viaNode && process.platform === 'win32' && command === 'pnpm',
    ...options,
  });
  return { status: result.status ?? 1, out: (result.stdout ?? '').trim() };
}

const git = (...args) => run('git', args);

function step(title) {
  console.log(`\n▸ ${title}`);
}

async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function main() {
  step('Checking this is releasable');
  const fetched = git('fetch', '--quiet', 'origin', 'main').status === 0;
  const state = {
    branch: git('rev-parse', '--abbrev-ref', 'HEAD').out,
    dirty: git('status', '--porcelain').out.split('\n').filter(Boolean),
    head: git('rev-parse', 'HEAD').out,
    remote: fetched ? git('rev-parse', 'origin/main').out : null,
  };
  const problems = releaseProblems(state);
  if (problems.length > 0) {
    console.error('Not released:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`  main at ${state.head.slice(0, 7)}, clean and pushed`);

  // The repair task (every 30 minutes, pnpm status --repair) leaves the
  // containers alone while this rebuilds them.
  const lock = path.join(ROOT, 'data', 'release.lock');
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, `${new Date().toISOString()} ${state.head.slice(0, 7)}
`);
  process.on('exit', () => {
    rmSync(lock, { force: true });
  });

  // A10: the hub publishes `weather`. The phone and the greenhouse reconnect
  // on their own; persistent sessions keep what was queued (D87).
  step("Checking the broker's permissions");
  const acl = run('docker', [...COMPOSE, 'exec', '-T', 'mosquitto', 'cat', '/mosquitto/auth/acl']);
  const wanted = readFileSync(path.join(ROOT, 'infra/mosquitto/acl'), 'utf8');
  if (!aclChanged(acl.status === 0 ? acl.out : null, wanted)) {
    console.log('  unchanged');
  } else {
    const restarted = run('docker', [...COMPOSE, 'restart', 'mosquitto'], { stdio: 'inherit' });
    if (restarted.status !== 0) process.exit(restarted.status);
    const mqttPort = Number(process.env.MQTT_PORT ?? 1883);
    let answers = false;
    for (let i = 0; i < 30 && !answers; i++) {
      answers = await mqttAnswers(mqttPort);
      if (!answers) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!answers) {
      console.error('The broker did not answer after restarting: run pnpm status --repair.');
      process.exit(1);
    }
    console.log('  restarted with the new permissions');
  }

  step('Rebuilding the hub');
  const hub = run('docker', [...COMPOSE, 'up', '-d', '--build', 'hub'], { stdio: 'inherit' });
  if (hub.status !== 0) process.exit(hub.status);
  if (!(await waitFor(HUB_HEALTH, 90))) {
    console.error('The hub did not answer within 90 s: the PWA was NOT rebuilt (pnpm hub:logs).');
    process.exit(1);
  }
  console.log('  the hub answers');

  // The daily simulator is a service too (after a reboot it comes back on
  // its own). One started by hand would hold its port and its device id.
  step('Rebuilding the daily simulator');
  const running = run('docker', [...COMPOSE, 'ps', '-q', '--status', 'running', 'simulator']);
  if (running.out === '' && (await waitFor(SIMULATOR_STATE, 1))) {
    console.error(
      'A simulator started by hand is answering on 127.0.0.1:8788: stop it, then run pnpm release again.',
    );
    process.exit(1);
  }
  const simulator = run('docker', [...COMPOSE, 'up', '-d', '--build', 'simulator'], {
    stdio: 'inherit',
  });
  if (simulator.status !== 0) process.exit(simulator.status);
  if (!(await waitFor(SIMULATOR_STATE, 60))) {
    console.error('The simulator did not answer within 60 s: the PWA was NOT rebuilt.');
    process.exit(1);
  }
  console.log('  the simulator answers');

  step(`Building the PWA into ${SERVED_DIR}/ (served by nginx)`);
  const web = run(
    'pnpm',
    ['--filter', '@vitreo/web', 'exec', 'vite', 'build', '--outDir', 'dist', '--emptyOutDir'],
    { stdio: 'inherit' },
  );
  if (web.status !== 0) process.exit(web.status);

  // nginx's own config (infra/web/nginx.conf) is read at start: reload it,
  // checked first, so a change to it ships with the release too.
  step('Reloading nginx');
  const nginx = run(
    'docker',
    [...COMPOSE, 'exec', '-T', 'web', 'sh', '-c', 'nginx -t -q && nginx -s reload'],
    {
      stdio: 'inherit',
    },
  );
  if (nginx.status !== 0) console.log('  WARNING: nginx kept its previous config');

  step('Checking what the phone gets');
  const app = await waitFor(APP, 10);
  console.log(app ? '  the app answers on 127.0.0.1:8080' : '  WARNING: nginx does not answer');
  console.log(`\nReleased ${state.head.slice(0, 7)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
