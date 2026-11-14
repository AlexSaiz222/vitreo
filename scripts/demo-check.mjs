// What may never reach the public demo (D103, docs/09 "Demo pública" §6),
// checked on the built folder before anything is uploaded: `pnpm demo:build`
// ends with it and `pnpm demo:release` stops if it finds anything.
//
// The values come from .env when it runs, so this file holds none. It says
// what it found and where (the name of the key, the file), never the value.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Keys whose values are secret, whatever their length. */
const SECRET_KEY = /PASSWORD|SECRET|TOKEN|_KEY$|VAPID|MQTT_URL|MQTT_USERNAME/;
/** Shorter values are placeholders or words ("web", "sim"), not secrets. */
const MIN_LENGTH = 8;
/** Closer than this to home, a coordinate pair gives the place away. */
const NEAR_KM = 2;
/** A latitude and a longitude this many characters apart read as a pair. */
const PAIR_WINDOW = 200;

/** .env as key → value; null without one. */
export function readEnv(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const at = line.indexOf('=');
        const value = line
          .slice(at + 1)
          .trim()
          .replace(/^"|"$/g, '');
        return [line.slice(0, at), value];
      }),
  );
}

function km(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return 6371 * Math.hypot(x, y);
}

/** Every file under `dir`, as paths relative to it. */
function filesIn(dir) {
  const out = [];
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const full = path.join(at, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * What a text gives away: the keys whose values it holds, the home place,
 * a tailnet, a home network address, the MQTT client.
 * @param {string} text
 * @param {{ secrets: [string, string][], home: { lat: number, lng: number } | null, email: string | null }} forbidden
 */
export function leaksIn(text, { secrets, home, email }) {
  const found = [];
  for (const [name, value] of secrets) if (text.includes(value)) found.push(name);
  if (email && text.toLowerCase().includes(email.toLowerCase())) found.push('the git email');
  if (/\.ts\.net\b/i.test(text) || /\btail[0-9a-f]{6}\b/i.test(text)) found.push('a tailnet');
  // A whole address, not four numbers inside a longer dotted run (a hex table).
  const octet = String.raw`(?:25[0-5]|2[0-4]\d|1?\d?\d)`;
  const lan = new RegExp(
    String.raw`(?<![\w.])(?:192\.168|10\.${octet}|172\.(?:1[6-9]|2\d|3[01]))\.${octet}\.${octet}(?![\w.])`,
  );
  if (lan.test(text)) {
    found.push('a home network address');
  }
  // The client library (mqtt.js), not the contract's topic names.
  if (/\bMqttClient\b|mqttjs_/.test(text)) found.push('the MQTT client');
  if (home) {
    const numbers = [...text.matchAll(/-?\d+\.\d{2,}/g)].map((m) => ({
      at: m.index,
      value: Number(m[0]),
    }));
    const lats = numbers.filter((n) => Math.abs(n.value - home.lat) < 0.05);
    // A longitude may be written without its sign ("3.70 W").
    const lngs = numbers.filter((n) => Math.abs(Math.abs(n.value) - Math.abs(home.lng)) < 0.05);
    const near = lats.some((a) =>
      lngs.some(
        (b) =>
          Math.abs(a.at - b.at) < PAIR_WINDOW &&
          km(home.lat, home.lng, a.value, Math.sign(home.lng) * Math.abs(b.value)) < NEAR_KM,
      ),
    );
    if (near) found.push('the home location');
  }
  return found;
}

/** What may never appear, from .env (and git's email). */
export function forbiddenFrom(env, email = null) {
  const secrets = Object.entries(env ?? {}).filter(
    ([name, value]) => SECRET_KEY.test(name) && value.length >= MIN_LENGTH,
  );
  const lat = Number(env?.['VITE_LOCATION_LAT']);
  const lng = Number(env?.['VITE_LOCATION_LNG']);
  const home = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  return { secrets, home, email };
}

/**
 * The problems of a built demo, in words without the values: anything of
 * .env in it, a sourcemap, a missing week.
 * @param {string} dir the built folder
 * @param {ReturnType<typeof forbiddenFrom>} forbidden
 * @param {string[]} [extra] more files to check (the recorded week's source)
 */
export function demoProblems(dir, forbidden, extra = []) {
  const problems = [];
  const files = filesIn(dir);
  if (!files.some((file) => path.basename(file) === 'index.html')) {
    problems.push('no index.html: the build did not finish');
  }
  if (!files.some((file) => /week-.*\.json$/.test(path.basename(file)))) {
    problems.push('no recorded week (week-*.json) in the build');
  }
  for (const file of [...files, ...extra]) {
    const name = path.relative(dir, file).replace(/\\/g, '/');
    if (file.endsWith('.map')) {
      problems.push(`${name}: a sourcemap (the demo ships none)`);
      continue;
    }
    const text = readFileSync(file).toString('latin1');
    for (const what of leaksIn(text, forbidden)) problems.push(`${name}: ${what}`);
  }
  return problems;
}

/** git's email for this checkout, or null. */
export function gitEmail(cwd) {
  try {
    return execFileSync('git', ['config', 'user.email'], { cwd, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}
