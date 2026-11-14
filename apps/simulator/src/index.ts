import { loadConfig } from './config.ts';
import { startControlServer } from './control.ts';
import { SimulatedDevice } from './device.ts';
import { loadRootEnv } from './env.ts';
import { loadParams } from './params.ts';

loadRootEnv();
const config = loadConfig();
const loaded = loadParams(config.paramsFile);
const params =
  config.timeScale === undefined
    ? loaded
    : { ...loaded, timing: { ...loaded.timing, timeScale: config.timeScale } };

const device = new SimulatedDevice(config, params);
device.start();
const control = startControlServer(device, config.controlPort, config.controlHost);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    control.close();
    void device.stop().finally(() => process.exit(0));
  });
}
