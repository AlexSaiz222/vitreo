import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema.ts';

/**
 * The hub's database as its logic sees it: any synchronous SQLite through
 * Drizzle. In the hub, better-sqlite3 (db/open.ts); in the public demo, the
 * same code on sql.js in a Web Worker (D66, D103). Nothing here may need
 * more than that: no `$client`, no run result.
 */
export type HubDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>;
