# The hub (apps/hub) as a service (A4, D87). Built from the repository root:
# `pnpm infra:up` or `pnpm hub:up`. The same image runs on a Raspberry Pi
# (linux/arm64) later: better-sqlite3 ships prebuilt binaries for both.
FROM node:24-bookworm-slim

ENV CI=true
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/hub/package.json apps/hub/
# The root `prepare` installs git hooks: nothing to do in an image.
RUN npm pkg delete scripts.prepare   && pnpm install --frozen-lockfile --prod --filter @vitreo/hub...

COPY packages/shared packages/shared
COPY apps/hub apps/hub

# The live database lives here, in a named volume (never a Windows folder);
# backups/ and archive/ go to /out, a folder Windows can see (data/hub/).
RUN mkdir -p /var/lib/vitreo /out && chown node:node /var/lib/vitreo /out
USER node
WORKDIR /app/apps/hub
ENV HUB_MODE=service HUB_HOST=0.0.0.0 HUB_PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]
