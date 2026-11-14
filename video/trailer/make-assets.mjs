// What the trailer plays, gathered in assets/ (not in git: all of it is made
// from the repository): the app's own typefaces and the soundtrack. The
// footage (footage.mp4, phone.mp4, notebook.mp4) and what the app sounded
// like through it (app-flight.wav, app-phone.wav) are recorded there by
// `pnpm video:trailer`: run it first.
//
//   npm run assets
/* global console -- a Node script */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const here = import.meta.dirname;
const repo = path.join(here, '..', '..');
const assets = path.join(here, 'assets');
mkdirSync(assets, { recursive: true });
for (const [from, to] of [
  ['apps/web/public/fonts/young-serif-400.woff2', 'young-serif-400.woff2'],
  ['apps/web/public/fonts/schibsted-grotesk.woff2', 'schibsted-grotesk.woff2'],
]) {
  copyFileSync(path.join(repo, from), path.join(assets, to));
}
await import('./make-soundtrack.mjs');

// The soundtrack: the app's own sounds (its ambience, the touches, the
// devices) at the level the app plays them, and the music under them, about
// 5 LU over the greenhouse's ambience so the birds, the rain and every press
// are heard (measured with ebur128: the app's clip −28 LUFS, the music −13
// before this gain). Then a web video's loudness (−16 LUFS, peaks under
// −1.5 dB). The moments are index.html's: the flight starts at 2.5 s and
// lasts 30; the phone, at 32.5.
const MUSIC_GAIN_DB = -10.5;
const FLIGHT = { at: 2.5, seconds: 30.5 };
const PHONE = { at: 32.5, seconds: 5.5 };
for (const file of ['app-flight.wav', 'app-phone.wav']) {
  if (!existsSync(path.join(assets, file)))
    throw new Error(`assets/${file} is missing: run "pnpm video:trailer" first`);
}
const ffmpeg = createRequire(path.join(repo, 'package.json'))('ffmpeg-static');
const ms = (s) => String(Math.round(s * 1000));
const clip = (input, { at, seconds }, out) =>
  `[${input}]atrim=0:${seconds},afade=t=in:d=0.5,afade=t=out:st=${seconds - 0.7}:d=0.7,` +
  `adelay=${ms(at)}:all=1[${out}]`;
const mixed = spawnSync(
  ffmpeg,
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...['music.wav', 'app-flight.wav', 'app-phone.wav'].flatMap((f) => [
      '-i',
      path.join(assets, f),
    ]),
    '-filter_complex',
    [
      `[0]aresample=48000,volume=${MUSIC_GAIN_DB}dB[m]`,
      clip(1, FLIGHT, 'a'),
      clip(2, PHONE, 'b'),
      '[m][a][b]amix=inputs=3:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]',
    ].join(';'),
    '-map',
    '[out]',
    path.join(assets, 'soundtrack.wav'),
  ],
  { stdio: 'inherit' },
);
if (mixed.status !== 0) throw new Error('ffmpeg failed: the soundtrack');
console.log('assets/soundtrack.wav · music under the app');
