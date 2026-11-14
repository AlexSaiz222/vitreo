import { readFileSync } from 'node:fs';

import { DEFAULT_PARAMS, withOverrides } from '@vitreo/sim-core';
import type { SimParams } from '@vitreo/sim-core';

/** Default parameters with whole sections replaced from a JSON file (SIMULATOR_PARAMS). */
export function loadParams(path?: string): SimParams {
  if (!path) return DEFAULT_PARAMS;
  return withOverrides(JSON.parse(readFileSync(path, 'utf8')));
}
