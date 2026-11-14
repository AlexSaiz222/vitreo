// The public demo (D66, D103, D112), built, checked and uploaded from this
// computer, as `pnpm release` publishes the home app (D92):
//
//   pnpm demo:build     builds apps/web/demo-dist/ and checks it
//   pnpm demo:release   the same, only from main clean and pushed, then
//                       uploads that folder to Vercel (vitreo-demo)
//
// The check (scripts/demo-check.mjs) reads .env as it runs and looks for
// every secret of it, the home location, a tailnet, a home address and the
// MQTT client in the whole folder and in the recorded week; anything found
// and nothing is uploaded. The repository is never connected to Vercel:
// only the checked folder leaves, with its headers (vercel.json).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { demoProblems, forbiddenFrom, gitEmail, readEnv } from './demo-check.mjs';
import { releaseProblems } from './release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where the demo is built: never dist/, which nginx serves to the phone (D92). */
export const DEMO_DIR = 'apps/web/demo-dist';
const WEEK = 'apps/web/demo/week.json';
/** The demo's pages: the app, and its notebook "Cómo se hizo" at /cuaderno (D113). */
export const PAGES = ['index.html', 'cuaderno.html'];
/** The Vercel project, and so its address: vitreo-demo.vercel.app. */
export const PROJECT = 'vitreo-demo';

/**
 * The headers of every page (docs/09 §2): everything from this site and
 * nothing from anywhere else; no camera, microphone or location. SQLite
 * (sql.js) needs to compile its WebAssembly; the inline boot script (the
 * theme before the first paint) is allowed by its hash only.
 * @param {string[]} scriptHashes
 */
export function vercelConfig(scriptHashes) {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${scriptHashes.map((h) => `'sha256-${h}'`).join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    cleanUrls: true,
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/assets/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ],
  };
}

/** The SHA-256 (base64) of each inline script of a page, for its CSP. */
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) =>
    createHash('sha256').update(m[1], 'utf8').digest('base64'),
  );
}

/** pnpm through Node itself, as release.mjs does (no shell, so no DEP0190). */
const PNPM = process.env.npm_execpath?.match(/pnpm\.c?js$/) ? process.env.npm_execpath : null;

function run(command, args, options = {}) {
  const viaNode = command === 'pnpm' && PNPM !== null;
  // Windows runs vercel.cmd only through a shell: one line, its arguments are plain words.
  const line = !viaNode && process.platform === 'win32';
  const result = spawnSync(
    viaNode ? process.execPath : line ? [command, ...args].join(' ') : command,
    viaNode ? [PNPM, ...args] : line ? [] : args,
    { cwd: ROOT, stdio: 'inherit', shell: line, ...options },
  );
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${String(result.status)})`);
  }
}

const git = (...args) =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() ?? '';

function build() {
  console.log(`\n▸ Building the demo into ${DEMO_DIR}`);
  rmSync(path.join(ROOT, DEMO_DIR), { recursive: true, force: true });
  run('pnpm', [
    '--filter',
    '@vitreo/web',
    'exec',
    'vite',
    'build',
    '--mode',
    'demo',
    '--outDir',
    'demo-dist',
    '--emptyOutDir',
  ]);
  // Every page's inline scripts: the app's and its notebook's (D113).
  const hashes = PAGES.flatMap((page) =>
    inlineScriptHashes(readFileSync(path.join(ROOT, DEMO_DIR, page), 'utf8')),
  );
  writeFileSync(
    path.join(ROOT, DEMO_DIR, 'vercel.json'),
    `${JSON.stringify(vercelConfig(hashes), null, 2)}\n`,
  );

  console.log('\n▸ Checking that nothing of .env, home or the tailnet is in it');
  const env = readEnv(path.join(ROOT, '.env'));
  if (env === null) throw new Error('no .env to check against: the check needs it');
  const problems = demoProblems(path.join(ROOT, DEMO_DIR), forbiddenFrom(env, gitEmail(ROOT)), [
    path.join(ROOT, WEEK),
  ]);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    throw new Error('the demo carries what it must not: nothing is uploaded');
  }
  console.log('  ✓ nothing found');
}

function release() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean);
  const head = git('rev-parse', 'HEAD');
  const fetched = spawnSync('git', ['fetch', 'origin', 'main'], { cwd: ROOT }).status === 0;
  const remote = fetched ? git('rev-parse', 'origin/main') : null;
  const problems = releaseProblems({ branch, dirty, head, remote });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    throw new Error('not released');
  }
  build();
  const dir = path.join(ROOT, DEMO_DIR);
  console.log(`\n▸ Uploading ${DEMO_DIR} to Vercel (${PROJECT})`);
  run('vercel', ['link', '--yes', '--project', PROJECT], { cwd: dir });
  run('vercel', ['deploy', '--prod', '--yes'], { cwd: dir });
  console.log(`\nReleased the demo of ${head.slice(0, 7)}: https://${PROJECT}.vercel.app`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv[2] === 'release') release();
    else build();
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
