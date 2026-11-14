// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-check/**',
      '**/demo-dist/**',
      'apps/web/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'firmware/**',
      // gltfjsx scaffolds (pnpm models:jsx): a reference, not app code.
      'assets/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: [
      'apps/hub/**',
      'apps/simulator/**',
      'apps/web/scripts/**',
      'assets/scripts/**',
      'infra/**',
      'scripts/**',
      'packages/**',
      '.claude/hooks/**',
      '*.{js,ts}',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // The 3D scene only reads from the store; it never talks to MQTT (CLAUDE.md).
    files: ['apps/web/src/scene/**/*.{ts,tsx}', 'apps/web/src/shaders/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'mqtt',
              message: 'The scene reads from the store; MQTT lives in data/mqttClient.ts.',
            },
          ],
          patterns: [
            {
              regex: String.raw`/data/(mqttClient|commands|router)(\.ts)?$`,
              message:
                'The scene reads from the store (data/greenhouse.ts, data/selectors.ts), never from the MQTT layer.',
            },
          ],
        },
      ],
    },
  },
  {
    // The hub's logic also runs in the public demo's Web Worker (D66, D103):
    // only the node-only modules may use Node, better-sqlite3, mqtt.js,
    // Fastify or web-push. Types are fine: they are gone once compiled.
    files: [
      'apps/hub/src/{routes,journalCore,pushCore,portable,history,ingest,alerts,configOwner}.ts',
      'apps/hub/src/db/{store,types,schema}.ts',
      'apps/hub/src/weather/{rules,service,aemet}.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: String.raw`^(node:|better-sqlite3|mqtt|fastify|web-push|drizzle-orm/better-sqlite3)`,
              allowTypeImports: true,
              message: 'Portable hub module (it runs in the demo too): no Node-only imports.',
            },
            {
              regex: String.raw`/(db/open|journal|push|mqtt|archive|backup|server|config|env|index)\.ts$`,
              allowTypeImports: true,
              message: 'Portable hub module: import only portable modules (or just their types).',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
