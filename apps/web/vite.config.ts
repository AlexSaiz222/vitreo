import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Connect, Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/** Day background (tokens.css --bg): splash screen and browser chrome. */
const BACKGROUND = '#faf9f6';

/** Which build this is, for Ajustes › Acerca de (A3): the commit and the day. */
function buildLabel(): string {
  let commit = 'sin git';
  try {
    commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout (an exported copy): the date still says something.
  }
  return `${commit} · ${new Date().toISOString().slice(0, 10)}`;
}

/**
 * The hub's API is served at /api on the same origin (A4, D87): nginx in
 * production, this proxy in development. The e2e tests point it at their own
 * hub (HUB_PROXY_TARGET).
 */
const HUB = process.env['HUB_PROXY_TARGET'] ?? 'http://127.0.0.1:8787';

/**
 * The demo's notebook, "Cómo se hizo" (D113), is a page of its own,
 * cuaderno.html, at /cuaderno: Vercel serves it there (cleanUrls), and this
 * does the same for `pnpm demo:dev`, `vite preview` and the e2e tests.
 */
function notebookRoute(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url === '/cuaderno' || req.url?.startsWith('/cuaderno?') === true) {
      req.url = req.url.replace('/cuaderno', '/cuaderno.html');
    }
    next();
  };
  return {
    name: 'vitreo-notebook-route',
    configureServer: (server) => {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(rewrite);
    },
  };
}

/** What a link to the demo shows when shared (D126): only in the demo's pages. */
function socialCard(): Plugin {
  const SITE = 'https://vitreo-demo.vercel.app';
  const meta = (property: string, content: string) => ({
    tag: 'meta',
    attrs: { property, content },
    injectTo: 'head' as const,
  });
  return {
    name: 'vitreo-social-card',
    transformIndexHtml(_html, context) {
      const notebook = context.path.includes('cuaderno');
      const title = notebook
        ? 'Cómo se hizo · Vitreo'
        : 'Vitreo · un invernadero y su gemelo digital';
      const description = notebook
        ? 'El cuaderno de un gemelo digital: decisiones, pruebas y lo que salió mal.'
        : 'Un invernadero pequeño en 3D que se comporta como el de verdad. Demo con datos simulados, en tu navegador.';
      return [
        meta('og:type', 'website'),
        meta('og:site_name', 'Vitreo'),
        meta('og:locale', 'es_ES'),
        meta('og:title', title),
        meta('og:description', description),
        meta('og:url', notebook ? `${SITE}/cuaderno` : SITE),
        meta('og:image', `${SITE}/og.jpg`),
        meta('og:image:width', '1200'),
        meta('og:image:height', '630'),
        meta('og:image:alt', 'Maqueta 3D de un pequeño invernadero con seis macetas.'),
        {
          tag: 'meta',
          attrs: { name: 'twitter:card', content: 'summary_large_image' },
          injectTo: 'head' as const,
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  /**
   * The public demo (D66, D103): `vite --mode demo`. It reads its
   * environment from demo/.env.demo (versioned, harmless), never the root
   * .env, and has no proxy to any hub: nothing of the home greenhouse can
   * reach it.
   */
  const demo = mode === 'demo';
  return {
    define: { __APP_BUILD__: JSON.stringify(buildLabel()) },
    plugins: [
      react(),
      ...(demo ? [notebookRoute(), socialCard()] : []),
      // Installable PWA (docs/05). The service worker caches the app shell so it
      // opens offline; live data still needs the broker, and says so when absent.
      VitePWA({
        // Our own service worker (src/sw/sw.ts): the shell cache as before,
        // plus web push and opening the app from a notification (A7, D91).
        strategies: 'injectManifest',
        srcDir: 'src/sw',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'Vitreo',
          short_name: 'Vitreo',
          description: 'Gemelo digital de un pequeño invernadero doméstico.',
          lang: 'es',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: BACKGROUND,
          theme_color: BACKGROUND,
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,glb,webp,json}'],
          // The demo's notebook (D113) is read online: its page and captures
          // are not downloaded with the app.
          globIgnores: ['**/node_modules/**/*', 'cuaderno.html', 'assets/cuaderno-*'],
          // The 3D chunk is large; it must still be cached for offline use.
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
      }),
    ],
    // One .env at the repository root is shared by every app; not the demo's.
    envDir: demo ? 'demo' : '../..',
    build: {
      // Never dist/: nginx serves that folder to the phone, and only
      // `pnpm release` (on main, clean and pushed) writes it (D92).
      outDir: 'build',
      // The demo has a second page, its notebook (D113); the home app, none.
      ...(demo
        ? {
            rollupOptions: {
              input: {
                main: fileURLToPath(new URL('index.html', import.meta.url)),
                cuaderno: fileURLToPath(new URL('cuaderno.html', import.meta.url)),
              },
            },
          }
        : {}),
    },
    // The demo's worker loads its hub (sql.js) as a chunk of its own, later:
    // module workers can split, classic ones cannot.
    worker: { format: 'es' },
    server: {
      port: demo ? 5190 : 5173,
      strictPort: true,
      ...(demo ? {} : { proxy: { '/api': HUB } }),
    },
    preview: {
      port: demo ? 4190 : 4173,
      strictPort: true,
      ...(demo ? {} : { proxy: { '/api': HUB } }),
    },
    test: {
      name: 'web',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
