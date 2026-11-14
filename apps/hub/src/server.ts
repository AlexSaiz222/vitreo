import { API_PREFIX, MAX_PHOTO_BYTES } from '@vitreo/shared';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { ApiReply, hubRoutes, JPEG_UPLOAD } from './routes.ts';
import type { ApiResult, HubContext } from './routes.ts';

export type { HubContext } from './routes.ts';

/** Sends what a route answered: a JSON value with a 200, or its ApiReply. */
function send(reply: FastifyReply, result: ApiResult): unknown {
  if (!(result instanceof ApiReply)) return result;
  reply.code(result.status);
  if (result.type) reply.type(result.type);
  for (const [name, value] of Object.entries(result.headers)) reply.header(name, value);
  const body = result.body;
  return reply.send(
    body instanceof Uint8Array && !Buffer.isBuffer(body)
      ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
      : body,
  );
}

/**
 * The hub's API (A4, D87), under /api/v1: the routes of routes.ts, served
 * with Fastify. Only reachable from this computer and, through nginx and
 * Tailscale Serve, the tailnet (D74): the tailnet is the boundary, as with
 * the broker. Writes are PUT and PATCH only, which a browser on another site
 * cannot send without a CORS preflight (refused).
 */
export function buildServer(
  context: HubContext,
  options: { logLevel?: string } = {},
): FastifyInstance {
  // No line per request: the health check alone would be one every 30 s.
  const server = Fastify({
    logger: { level: options.logLevel ?? 'info' },
    disableRequestLogging: true,
  });

  server.register(
    (api, _options, done) => {
      for (const route of hubRoutes(context)) {
        // Photos arrive as raw JPEG bytes (the phone has already resized them).
        if (route.method === JPEG_UPLOAD.method && route.path === JPEG_UPLOAD.path) {
          api.addContentTypeParser(
            'image/jpeg',
            { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES },
            (_request, body, parsed) => {
              parsed(null, body);
            },
          );
        }
        api.route({
          method: route.method,
          url: route.path,
          handler: (request: FastifyRequest, reply: FastifyReply) => {
            const result = route.handle({
              params: request.params as Record<string, string>,
              query: request.query,
              body: request.body,
              ip: request.ip,
            });
            return result instanceof Promise
              ? result.then((value) => send(reply, value))
              : send(reply, result);
          },
        });
      }
      done();
    },
    { prefix: API_PREFIX },
  );

  return server;
}
