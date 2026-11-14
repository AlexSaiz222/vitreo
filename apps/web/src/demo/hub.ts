// The public demo's hub (D66, D103, step 2): the hub's own code, on sql.js
// (SQLite in WebAssembly) in the demo's worker. Its own chunk, with the
// WebAssembly fetched only when the worker starts it: the page never waits
// for it. The database lives in the worker's memory and goes with the tab.
import { createPortableHub } from '@vitreo/hub/portable';
import type { PortableHub, PortableHubOptions } from '@vitreo/hub/portable';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

/** The hub's migrations (apps/hub/drizzle), in order, as the hub applies them. */
const MIGRATIONS = Object.entries(
  import.meta.glob<string>('../../../hub/drizzle/*.sql', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

export async function startDemoHub(
  options: Omit<PortableHubOptions, 'SQL' | 'migrations'>,
): Promise<PortableHub> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return createPortableHub({ ...options, SQL, migrations: MIGRATIONS });
}
