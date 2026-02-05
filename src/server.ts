import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { wsHandler } from './adapters/ws-handler';
import { logger } from './observability/logger';

const server = Fastify({ logger: true });

async function start() {
  logger.info('=== realtime-voice start ===');
  logger.info({ DEBUG_VOICE: process.env.DEBUG_VOICE ?? '(unset)' }, 'voice debug logger config');
  await server.register(websocket);

  server.get('/ws/voice', { websocket: true }, (socket, _req) => {
    wsHandler(socket);
  });

  const port = Number(process.env.PORT || 3000);
  await server.listen({ port, host: '0.0.0.0' });
  logger.info('server listening', { port, host: '0.0.0.0' });
}

start().catch((err) => {
  logger.error('failed to start server', err);
  server.log.error(err, 'failed to start server');
  process.exit(1);
});
