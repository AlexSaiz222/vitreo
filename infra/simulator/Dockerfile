# The daily simulator (apps/simulator) as a service: it comes back on its own
# after a reboot, like the hub. Rebuilt only by `pnpm release` (D92). The e2e
# tests never use it: they start their own (device `e2e`, port 8789).
FROM node:24-bookworm-slim

ENV CI=true
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sim-core/package.json packages/sim-core/
COPY apps/simulator/package.json apps/simulator/
# The root `prepare` installs git hooks: nothing to do in an image.
RUN npm pkg delete scripts.prepare   && pnpm install --frozen-lockfile --prod --filter @vitreo/simulator...

COPY packages/shared packages/shared
COPY packages/sim-core packages/sim-core
COPY apps/simulator apps/simulator

# Its greenhouse over restarts (D100), in a volume the node user can write.
RUN mkdir -p /var/lib/vitreo-sim && chown node:node /var/lib/vitreo-sim
USER node
WORKDIR /app/apps/simulator
ENV SIMULATOR_CONTROL_HOST=0.0.0.0 SIMULATOR_CONTROL_PORT=8788
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s   CMD node -e "fetch('http://127.0.0.1:8788/state').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]
