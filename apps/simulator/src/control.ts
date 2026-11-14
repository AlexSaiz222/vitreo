import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

import { fraction, zoneId } from '@vitreo/shared';
import { z } from 'zod';

import type { SimulatedDevice } from './device.ts';

/**
 * Development-only HTTP API to force scenarios (docs/06-gemelo-digital.md).
 * Listens on 127.0.0.1 only. It is not part of the device contract.
 *
 *   GET  /state
 *   POST /scenario  { "scenario": "heatwave" | "cold_snap" | "humid" | "tank_empty" | "disconnect", "active": true }
 *   POST /scenario  { "scenario": "sensor_failure", "active": true, "sensor": "soil", "zone": "basil_01" }
 *   POST /soil      { "zone": "basil_01", "moisture": 0.2 }
 *   POST /tank      { "level": 1 }
 *   POST /air       { "temp": 36 }   (the air at once: heat or frost protection, A10)
 */
export const scenarioRequest = z.union([
  z.strictObject({
    scenario: z.enum(['heatwave', 'cold_snap', 'humid', 'tank_empty', 'disconnect']),
    active: z.boolean(),
  }),
  z.strictObject({
    scenario: z.literal('sensor_failure'),
    active: z.boolean(),
    sensor: z.enum(['air', 'light', 'tank']),
  }),
  z.strictObject({
    scenario: z.literal('sensor_failure'),
    active: z.boolean(),
    sensor: z.literal('soil'),
    zone: zoneId,
  }),
]);

const soilRequest = z.strictObject({ zone: zoneId, moisture: fraction });
const tankRequest = z.strictObject({ level: fraction });
const airRequest = z.strictObject({ temp: z.number().min(-20).max(60) });

export function startControlServer(
  device: SimulatedDevice,
  port: number,
  host = '127.0.0.1',
): Server {
  const server = createServer((request, response) => {
    void handle(device, request, response);
  });
  // Test clients keep connections open between steps that can take longer
  // than Node's default 5 s; closing them first made reused sockets fail
  // (ECONNRESET). Development-only API on 127.0.0.1 (in its container,
  // 0.0.0.0 behind a port published on 127.0.0.1 only).
  server.keepAliveTimeout = 60_000;
  server.listen(port, host, () => {
    console.info(`[simulator] control API on http://${host}:${port.toString()}`);
  });
  return server;
}

async function handle(
  device: SimulatedDevice,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  };

  try {
    if (request.method === 'GET' && request.url === '/state') {
      reply(200, device.snapshot());
      return;
    }
    if (request.method !== 'POST') {
      reply(404, { error: 'not found' });
      return;
    }

    const body: unknown = JSON.parse((await readBody(request)) || '{}');
    switch (request.url) {
      case '/scenario': {
        const req = scenarioRequest.parse(body);
        if (req.scenario === 'sensor_failure') {
          const target =
            req.sensor === 'soil'
              ? { sensor: 'soil' as const, zone: req.zone }
              : { sensor: req.sensor };
          device.setScenario({ scenario: req.scenario, active: req.active, target });
        } else {
          device.setScenario(req);
        }
        break;
      }
      case '/soil': {
        const req = soilRequest.parse(body);
        if (!device.setSoilMoisture(req.zone, req.moisture)) {
          reply(404, { error: `unknown zone ${req.zone}` });
          return;
        }
        break;
      }
      case '/tank':
        device.setTankLevel(tankRequest.parse(body).level);
        break;
      case '/air':
        device.setAirTemperature(airRequest.parse(body).temp);
        break;
      case '/reset':
        device.reset();
        break;
      case '/pump-budget':
        device.useUpPumpBudget();
        break;
      default:
        reply(404, { error: 'not found' });
        return;
    }
    reply(200, device.snapshot());
  } catch (error) {
    reply(400, { error: error instanceof Error ? error.message : String(error) });
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      data += chunk;
      if (data.length > 10_000) request.destroy(new Error('body too large'));
    });
    request.on('end', () => {
      resolve(data);
    });
    request.on('error', reject);
  });
}
