// The accelerated week (D104), printed: the numbers of the week report.
//
//   pnpm sim:week
//
// Seven days of the simulated device with the week run's rules, in seconds,
// always the same (seed 2026). docs/informes/2026-10-22-semana-de-prueba.md.
import {
  ACCELERATED_WEEK_START,
  acceleratedWeek,
  summarizeWeek,
  weekRunConfig,
} from '@vitreo/sim-core';

const started = performance.now();
const week = acceleratedWeek();
const summary = summarizeWeek(week, weekRunConfig(ACCELERATED_WEEK_START));
console.log(JSON.stringify(summary, null, 2));
console.info(
  `\n${summary.days.toString()} days, ${week.telemetry.length.toString()} readings and ${week.events.length.toString()} events in ${Math.round(performance.now() - started).toString()} ms`,
);
