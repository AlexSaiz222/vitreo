# apps/web/demo

The public demo's folder (D66, D103). `vite --mode demo` reads its
environment from here (`.env.demo`, versioned), never from the repository's
`.env`, so nothing of the home greenhouse (broker, keys, location) can reach
the demo build. Nothing secret goes in `.env.demo`.

`week.json` is the recorded past (D112; a month since D129): thirty-one
simulated days of the demo's own greenhouse, hub and sky, written by `pnpm
demo:week` (one message per line, so a diff says what changed). The last
seven days reading by reading, the earlier ones as the hub's hourly
summaries; the tank is topped up once a week. Nothing in it comes from the
home hub. Run it again after changing the simulator, the hub or the demo's
sky.
