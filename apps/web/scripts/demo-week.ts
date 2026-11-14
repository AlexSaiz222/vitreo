// The demo's recorded past (D104, D112; a month since D129): `pnpm
// demo:week` runs it, a simulated second at a time, through the demo's own
// engine (the device, the hub's code on sql.js and the simulated sky) and
// writes it to apps/web/demo/week.json. Same seed, same month: run it again
// after a change to the simulator, the hub or the sky, and review the diff.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createPortableHub } from '@vitreo/hub/portable';
import initSqlJs from 'sql.js';

import { recordDemoWeek } from '../src/demo/record.ts';
import { encodeWeek } from '../src/demo/week.ts';
import type { DemoWeekFile } from '../src/demo/week.ts';

const HUB_MIGRATIONS = path.resolve(import.meta.dirname, '../../hub/drizzle');
const OUT = path.resolve(import.meta.dirname, '../demo/week.json');

const ABOUT =
  'Simulated, not observed: thirty-one days of the demo greenhouse (device "demo", Madrid centre), ' +
  'recorded by `pnpm demo:week` with the simulator, the hub and a simulated autumn sky; the last ' +
  'seven reading by reading, and every hour as the hub summarised it. ' +
  'Nothing from the home greenhouse.';

/** One key per line, and one message or memory per line: a diff says what changed. */
function format(file: DemoWeekFile): string {
  const line = (value: unknown) => JSON.stringify(value);
  const block = (entries: [string, string][], indent: string) =>
    entries.map(([key, value]) => `${indent}${line(key)}: ${value}`).join(',\n');
  const { telemetry, hourly, messages, memory, ...head } = file;
  const { soil, ...columns } = telemetry;
  const telemetryText = [
    '{',
    block(
      [
        ...Object.entries(columns).map(([key, value]): [string, string] => [key, line(value)]),
        [
          'soil',
          `{\n${block(
            Object.entries(soil).map(([zone, values]): [string, string] => [zone, line(values)]),
            '      ',
          )}\n    }`,
        ],
      ],
      '    ',
    ),
    '  }',
  ].join('\n');
  const list = (items: unknown[], indent = '  ') =>
    `[\n${items.map((item) => `${indent}  ${line(item)}`).join(',\n')}\n${indent}]`;
  const hourlyText = `{\n${block(
    [
      ['metrics', line(hourly.metrics)],
      ['rows', list(hourly.rows, '    ')],
    ],
    '    ',
  )}\n  }`;
  return `{\n${block(
    [
      ...Object.entries(head).map(([key, value]): [string, string] => [key, line(value)]),
      ['telemetry', telemetryText],
      ['hourly', hourlyText],
      ['messages', list(messages)],
      ['memory', list(memory)],
    ],
    '  ',
  )}\n}\n`;
}

const started = performance.now();
const SQL = await initSqlJs();
const migrations = readdirSync(HUB_MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(path.join(HUB_MIGRATIONS, name), 'utf8'));
const week = await recordDemoWeek((options) =>
  createPortableHub({ ...options, SQL, migrations, log: () => undefined }),
);
const file = encodeWeek(week, ABOUT);
const text = format(file);
JSON.parse(text);
writeFileSync(OUT, text);
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `demo past: ${file.telemetry.dt.length.toString()} readings, ` +
    `${file.hourly.rows.length.toString()} hourly summaries, ` +
    `${file.messages.length.toString()} other messages, ${file.memory.length.toString()} memories, ` +
    `${(text.length / 1024).toFixed(0)} KiB, in ${seconds} s → ${path.relative(process.cwd(), OUT)}`,
);
