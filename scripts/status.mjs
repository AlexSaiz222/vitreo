// Is everything up? The check after a reboot (docs/05, D94):
//
//   pnpm status            what is up, and what to do about what is not
//   pnpm status --repair   the same, after waiting for Docker; restarts the
//                          containers whose port does not answer
//
// Docker, the four services, a real reply on every published port, the hub
// with fresh data, the app and the phone's HTTPS address through Tailscale.
//
// Why --repair: after Docker Desktop starts, its port proxy sometimes
// accepts connections on a published port and returns nothing ("empty
// reply"), although the container is healthy inside. Restarting that one
// container fixes it. The sign-in task (pnpm boot:install) runs --repair a
// minute after you sign in, and appends what it did to data/status.log.
//
// It also starts Docker Desktop if it is not running. That is the only way
// Docker starts: its own AutoStart stays off on purpose (docs/05). After a
// Windows Update restart on 2026-10-15 nothing started it, and nothing came
// back for 33 h. It finishes well inside the task's 15 minutes and, if
// anything is still down, says so in a Windows notification, not only in
// the log.
//
// The task also runs it every 30 minutes while you are signed in, so Docker
// Desktop quitting (or a sign-in run that died, as on 2026-10-19) costs half
// an hour, not days. A run that finds everything up and mends nothing leaves
// only data/status-last.json (when it ran, what it found), which plain
// `pnpm status` reports; the log keeps what was done or wrong. The same
// problem is notified again after 3 hours, or at once if it changes. While
// `pnpm release` rebuilds the containers (data/release.lock), it waits.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // Defaults below.
}
const env = process.env;
const COMPOSE = ['compose', '--env-file', '.env', '-f', 'infra/docker-compose.yml'];
const REPAIR = process.argv.includes('--repair');
const LOG = path.join(ROOT, 'data', 'status.log');
/** The last repair run: when, what it found, and the last notification. */
const LAST = path.join(ROOT, 'data', 'status-last.json');
/** Written by `pnpm release` while it rebuilds the containers. */
const RELEASE_LOCK = path.join(ROOT, 'data', 'release.lock');
/** Older than this, the hub's last reading means data is not arriving. */
const FRESH_S = 120;
/** The task repeats every 30 minutes: a last run older than this means it does not. */
const TASK_STALE_MIN = 45;
/** The same problem is notified again after this long. */
const RENOTIFY_MS = 3 * 3600_000;

// A Docker CLI call can hang while Docker Desktop is half up: never wait on it
// for more than a minute.
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() };
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Held back until the run does something (then written at once, so a run
// cut short still leaves it) or ends with a problem: a run that only finds
// everything up is not logged.
const logged = [];
let acted = false;
function log(line) {
  if (!REPAIR) return;
  logged.push(`${new Date().toISOString()} ${line}\n`);
  if (acted) flushLog();
}
function flushLog() {
  if (logged.length === 0) return;
  mkdirSync(path.dirname(LOG), { recursive: true });
  appendFileSync(LOG, logged.splice(0).join(''));
}

function writeLast(state) {
  mkdirSync(path.dirname(LAST), { recursive: true });
  writeFileSync(LAST, `${JSON.stringify(state, null, 2)}\n`);
}

function readLast() {
  try {
    return JSON.parse(readFileSync(LAST, 'utf8'));
  } catch {
    return null;
  }
}

/** A release that started less than 30 minutes ago and has not finished. */
function releaseRunning() {
  try {
    return Date.now() - statSync(RELEASE_LOCK).mtimeMs < 30 * 60_000;
  } catch {
    return false;
  }
}

async function get(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

/** Sends `request` to a local port; true if the first reply passes `check`. */
function talk(port, request, check) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(4000, () => {
      done(false);
    });
    socket.on('connect', () => socket.write(request));
    socket.once('data', (data) => {
      done(check(data));
    });
    socket.on('error', () => {
      done(false);
    });
    socket.on('close', () => {
      done(false);
    });
  });
}

// MQTT 3.1.1 CONNECT without credentials: the broker answers CONNACK
// ("not authorised"), which proves the port reaches it.
const MQTT_CONNECT = Buffer.from([
  0x10, 0x0c, 0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c, 0x00, 0x00,
]);
const WS_UPGRADE = [
  'GET / HTTP/1.1',
  'Host: 127.0.0.1',
  'Upgrade: websocket',
  'Connection: Upgrade',
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
  'Sec-WebSocket-Version: 13',
  'Sec-WebSocket-Protocol: mqtt',
  '',
  '',
].join('\r\n');

const port = (name, fallback) => Number(env[name] ?? fallback);
/** Every published port, with a probe that needs a real reply from the container. */
const PROBES = {
  mosquitto: [
    {
      what: 'MQTT',
      port: port('MQTT_PORT', 1883),
      probe: (p) => talk(p, MQTT_CONNECT, (data) => data[0] === 0x20),
    },
    {
      what: 'MQTT over WebSocket',
      port: port('MQTT_WS_PORT', 9002),
      probe: (p) => talk(p, WS_UPGRADE, (data) => data.toString().startsWith('HTTP/1.1 101')),
    },
  ],
  web: [
    {
      what: 'the app',
      port: port('WEB_PORT', 8080),
      probe: async (p) => (await get(`http://127.0.0.1:${p.toString()}/`)) !== null,
    },
  ],
  hub: [
    {
      what: 'the API',
      port: port('HUB_PORT', 8787),
      probe: async (p) => (await get(`http://127.0.0.1:${p.toString()}/api/v1/health`)) !== null,
    },
  ],
  simulator: [
    {
      what: 'the control API',
      port: port('SIMULATOR_CONTROL_PORT', 8788),
      probe: async (p) => (await get(`http://127.0.0.1:${p.toString()}/state`)) !== null,
    },
  ],
};
const SERVICES = Object.keys(PROBES);

async function deadPorts(service) {
  const dead = [];
  for (const { what, port: number, probe } of PROBES[service]) {
    if (!(await probe(number))) dead.push(`${what} (${number.toString()})`);
  }
  return dead;
}

function containers() {
  const listed = run('docker', [...COMPOSE, 'ps', '--all', '--format', 'json']);
  return listed.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Whether Docker Desktop's own process is alive. Waking from sleep (Modern
 * Standby pauses it), it is there but the engine does not answer for a
 * while: that is Docker recovering, not Docker down, and nothing should
 * start it again or say it is not running.
 */
function dockerDesktopAlive() {
  if (process.platform !== 'win32') return false;
  const listed = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Docker Desktop.exe', '/NH'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  return (listed.stdout ?? '').includes('Docker Desktop.exe');
}

/**
 * Waits `ms` and says whether the PC slept meanwhile: a 5 s wait that took
 * over a minute of wall clock means it was suspended (the run itself was
 * frozen), so whatever it had judged before is out of date.
 */
async function waitAwake(ms) {
  const before = Date.now();
  await wait(ms);
  return Date.now() - before < ms + 60_000;
}

/** Docker Desktop, started as if from the Start menu (it does not wait for it). */
function startDockerDesktop() {
  if (process.platform !== 'win32') return;
  const exe =
    env['DOCKER_DESKTOP'] ??
    path.join(env['ProgramFiles'] ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
  acted = true;
  log('repair: Docker is not running; starting Docker Desktop');
  try {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  } catch (error) {
    log(`repair: could not start ${exe}: ${String(error)}`);
  }
}

/** A Windows notification, so a problem after sign-in is not only in the log. True if shown. */
function notify(text) {
  if (process.platform !== 'win32') return false;
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '$toast = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
    "$lines = $toast.GetElementsByTagName('text')",
    "$lines.Item(0).AppendChild($toast.CreateTextNode('Vitreo')) | Out-Null",
    '$lines.Item(1).AppendChild($toast.CreateTextNode($env:VITREO_NOTICE)) | Out-Null',
    // PowerShell's own app id: a toast needs one that Windows knows.
    "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($toast))',
  ].join('; ');
  const shown = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    env: { ...env, VITREO_NOTICE: text },
    timeout: 30_000,
  });
  log(shown.status === 0 ? 'notified' : 'could not show the notification');
  return shown.status === 0;
}

let failures = 0;
const problems = [];
function report(ok, what, fix) {
  if (!ok) {
    failures++;
    problems.push(what);
  }
  console.log(`${ok ? '✓' : '✗'} ${what}${ok || !fix ? '' : `\n    → ${fix}`}`);
  if (!ok) log(`✗ ${what}`);
}

// ── With --repair (after sign-in): wait for Docker, then mend dead ports.
// The sign-in task stops it at 15 minutes: the report must come before that.
let deadline = Date.now() + 10 * 60_000;
const inTime = () => Date.now() < deadline;
const previous = readLast();
const STARTED = new Date().toISOString();
if (REPAIR && releaseRunning()) {
  // The release stops and recreates containers: their ports are meant to be
  // dead for a moment. The next run (30 minutes) checks.
  console.log('A release is running (data/release.lock): not checked.');
  process.exit(0);
}
if (REPAIR) {
  // Marked before anything else: a run that is cut short shows up as one
  // that started and never finished.
  writeLast({ ...previous, started: STARTED });
  log('repair: start');
  if (!run('docker', ['info']).ok) {
    if (dockerDesktopAlive()) log('repair: Docker Desktop is up but not answering yet; waiting');
    else startDockerDesktop();
  }
  // Up to 6 minutes awake. Back from sleep, the wait starts again (and the
  // deadline with it): Docker gets its full time to come back.
  for (let i = 0; i < 72 && !run('docker', ['info']).ok; i++) {
    if (!(await waitAwake(5000))) {
      log('repair: the PC slept during this check; waiting for Docker again');
      i = 0;
      deadline = Date.now() + 10 * 60_000;
    }
  }
}
// Without Docker there is nothing to mend: straight to the report.
if (REPAIR && run('docker', ['info']).ok) {
  for (let i = 0; i < 24; i++) {
    const all = containers();
    if (SERVICES.every((s) => all.find((c) => c.Service === s)?.State === 'running')) break;
    await wait(5000);
  }
  // Let the services open their ports before judging them.
  await wait(15_000);
  for (const service of SERVICES) {
    for (let attempt = 1; attempt <= 2 && inTime(); attempt++) {
      const dead = await deadPorts(service);
      if (dead.length === 0) break;
      acted = true;
      log(
        `repair: ${service}: no reply on ${dead.join(', ')}; restarting it (${attempt.toString()})`,
      );
      run('docker', [...COMPOSE, 'restart', service]);
      for (let i = 0; i < 12 && (await deadPorts(service)).length > 0; i++) await wait(5000);
    }
  }
}

const docker = run('docker', ['info', '--format', '{{.ServerVersion}}']);
report(
  docker.ok,
  docker.ok
    ? `Docker ${docker.out}`
    : dockerDesktopAlive()
      ? 'Docker Desktop is running but its engine does not answer'
      : 'Docker is not running',
  'open Docker Desktop (the sign-in task starts it; its own AutoStart stays off, docs/05)',
);

if (docker.ok) {
  const all = containers();
  for (const service of SERVICES) {
    const container = all.find((c) => c.Service === service);
    const state = container
      ? `${container.State}${container.Health ? `, ${container.Health}` : ''}`
      : 'missing';
    const running = container?.State === 'running' && container.Health !== 'unhealthy';
    const dead = running ? await deadPorts(service) : [];
    report(
      running && dead.length === 0,
      dead.length > 0
        ? `${service}: ${state}, but no reply on ${dead.join(', ')}`
        : `${service}: ${state}`,
      !container
        ? 'pnpm release builds it'
        : dead.length > 0
          ? 'pnpm status --repair (restarts it)'
          : `pnpm infra:up (logs: docker compose … logs ${service})`,
    );
  }
}

const health = await get('http://127.0.0.1:8787/api/v1/health');
const hub = health ? await health.json() : null;
const age = hub?.lastTelemetry ? Math.round(Date.now() / 1000 - hub.lastTelemetry) : null;
report(
  hub !== null && hub.mqtt && age !== null && age < FRESH_S,
  hub === null
    ? 'the hub does not answer'
    : `hub: device ${hub.device}, broker ${hub.mqtt ? 'connected' : 'NOT connected'}, last reading ${age === null ? 'never' : `${age.toString()} s ago`}`,
  'pnpm hub:logs; if the simulator is down, data stops too',
);

// The newest nightly backup (D77, A8): from yesterday or today, and whole:
// every journal photo it refers to is in data/hub/backups/photos, so a
// restore would bring it back.
const storage = hub ? await get('http://127.0.0.1:8787/api/v1/storage') : null;
const backup = storage ? (await storage.json()).backup : undefined;
if (hub) {
  const localDate = (ms) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: env.HUB_TZ ?? 'Europe/Madrid' }).format(ms);
  const recent = backup?.day != null && backup.day >= localDate(Date.now() - 86_400_000);
  const photos = backup ? `${backup.photos.toString()} photo(s)` : '';
  report(
    recent && backup.missing === 0,
    !backup
      ? 'the hub does not say how its backups are'
      : backup.day === null
        ? 'no nightly backup yet'
        : backup.missing > 0
          ? `the last nightly backup (${backup.day}) is missing ${backup.missing.toString()} of ${photos}: a restore would not bring them back`
          : recent
            ? `last nightly backup: ${backup.day}, ${photos}, all in data/hub/backups/photos`
            : `the last nightly backup is from ${backup.day}`,
    'pnpm hub:backup makes one now; pnpm hub:logs says why the nightly one failed',
  );
}

const tailscale = run('tailscale', ['status', '--json']);
const self = tailscale.ok ? JSON.parse(tailscale.out) : null;
const host = self?.Self?.DNSName?.replace(/\.$/, '');
report(
  self?.BackendState === 'Running',
  self ? `Tailscale ${self.BackendState}` : 'Tailscale is not available',
  'open Tailscale and sign in; keep "Run unattended" on',
);
if (host) {
  report(
    (await get(`https://${host}/`)) !== null,
    `the phone's address answers: https://${host}`,
    'tailscale serve status (docs/05, Acceso desde el móvil)',
  );
}

// The task's own heartbeat: it runs every 30 minutes while you are signed in.
if (!REPAIR) {
  const ago = (iso) => Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const minutes = previous?.at ? ago(previous.at) : null;
  // A run takes at most 15 minutes (the task's limit).
  const cut =
    previous?.started &&
    (!previous.at || previous.started > previous.at) &&
    ago(previous.started) > 15;
  report(
    !cut && minutes !== null && minutes <= TASK_STALE_MIN,
    cut
      ? `the repair task's last run started ${ago(previous.started).toString()} min ago and never finished`
      : minutes === null
        ? 'the repair task has never checked'
        : `the repair task checked ${minutes.toString()} min ago${previous.problems.length > 0 ? ` and found: ${previous.problems.join('; ')}` : ' (all up)'}`,
    'pnpm boot:install (re)creates it; Task Scheduler › "Vitreo after sign-in" says why it stopped',
  );
}

console.log(failures === 0 ? '\nAll up.' : `\n${failures.toString()} problem(s).`);
if (REPAIR) {
  let notice = previous?.notice ?? null;
  if (failures > 0) {
    log(`${failures.toString()} problem(s) left`);
    const text = `${problems[0] ?? 'Something is down'}${failures > 1 ? ` (and ${(failures - 1).toString()} more)` : ''}. The greenhouse is not being recorded: run pnpm status.`;
    const same = notice?.problems?.join('\n') === problems.join('\n');
    if (!same || Date.now() - Date.parse(notice.at) >= RENOTIFY_MS) {
      // One that could not be shown is tried again on the next run.
      if (notify(text)) notice = { at: new Date().toISOString(), problems };
    }
  } else {
    notice = null;
    if (acted) log('all up');
  }
  if (acted || failures > 0) flushLog();
  writeLast({ started: STARTED, at: new Date().toISOString(), problems, notice });
}
process.exit(failures === 0 ? 0 : 1);
