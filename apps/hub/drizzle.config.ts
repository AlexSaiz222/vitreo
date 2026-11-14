import { defineConfig } from 'drizzle-kit';

// Migrations are generated (`pnpm --filter @vitreo/hub db:generate`), committed,
// and applied by the hub when it starts (src/db/open.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
